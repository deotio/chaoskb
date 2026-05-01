import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initializeSchema } from '../schema.js';
import { ChunkRepository } from '../chunk-repo.js';

describe('ChunkRepository', () => {
  let tmpDir: string;
  let db: BetterSqlite3.Database;
  let repo: ChunkRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaoskb-chunk-test-'));
    db = new BetterSqlite3(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    repo = new ChunkRepository(db);

    // Insert a source for foreign key references
    db.prepare('INSERT INTO sources (id, url) VALUES (?, ?)').run('src1', 'https://example.com');
    db.prepare('INSERT INTO sources (id, url) VALUES (?, ?)').run('src2', 'https://other.com');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('insertMany', () => {
    it('should insert chunks and return them with generated IDs', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const chunks = repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'Hello world',
          embedding,
          tokenCount: 2,
          model: 'test-model',
        },
        {
          sourceId: 'src1',
          chunkIndex: 1,
          content: 'Second chunk',
          embedding: new Float32Array([0.5, 0.6, 0.7, 0.8]),
          tokenCount: 2,
          model: 'test-model',
        },
      ]);

      expect(chunks).toHaveLength(2);
      expect(chunks[0].id).toBeDefined();
      expect(chunks[0].id).not.toBe(chunks[1].id);
      expect(chunks[0].content).toBe('Hello world');
      expect(chunks[1].chunkIndex).toBe(1);
    });

    it('should store and retrieve embeddings correctly (Float32Array round-trip)', () => {
      const original = new Float32Array([1.5, -2.3, 0.0, 4.7, -0.001]);

      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'test',
          embedding: original,
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const retrieved = repo.getBySourceId('src1');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].embedding).toBeInstanceOf(Float32Array);
      expect(retrieved[0].embedding.length).toBe(original.length);

      for (let i = 0; i < original.length; i++) {
        expect(retrieved[0].embedding[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('should handle null/empty embeddings', () => {
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'no embedding',
          embedding: new Float32Array(0),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const retrieved = repo.getBySourceId('src1');
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].embedding.length).toBe(0);
    });

    it('should insert in a transaction (all or nothing)', () => {
      // First insert a chunk at index 0
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'first',
          embedding: new Float32Array([1]),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      // Try to insert two chunks where the second conflicts
      expect(() => {
        repo.insertMany([
          {
            sourceId: 'src1',
            chunkIndex: 1,
            content: 'second',
            embedding: new Float32Array([2]),
            tokenCount: 1,
            model: 'model',
          },
          {
            sourceId: 'src1',
            chunkIndex: 0, // duplicate
            content: 'conflict',
            embedding: new Float32Array([3]),
            tokenCount: 1,
            model: 'model',
          },
        ]);
      }).toThrow();

      // The first chunk in the batch should also be rolled back
      const chunks = repo.getBySourceId('src1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0].content).toBe('first');
    });
  });

  describe('getBySourceId', () => {
    it('should return empty array for non-existent source', () => {
      expect(repo.getBySourceId('nonexistent')).toEqual([]);
    });

    it('should return chunks ordered by chunk_index', () => {
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 2,
          content: 'third',
          embedding: new Float32Array([3]),
          tokenCount: 1,
          model: 'model',
        },
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'first',
          embedding: new Float32Array([1]),
          tokenCount: 1,
          model: 'model',
        },
        {
          sourceId: 'src1',
          chunkIndex: 1,
          content: 'second',
          embedding: new Float32Array([2]),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const chunks = repo.getBySourceId('src1');
      expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
      expect(chunks.map((c) => c.content)).toEqual(['first', 'second', 'third']);
    });

    it('should only return chunks for the specified source', () => {
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'src1 chunk',
          embedding: new Float32Array([1]),
          tokenCount: 1,
          model: 'model',
        },
        {
          sourceId: 'src2',
          chunkIndex: 0,
          content: 'src2 chunk',
          embedding: new Float32Array([2]),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const src1Chunks = repo.getBySourceId('src1');
      expect(src1Chunks).toHaveLength(1);
      expect(src1Chunks[0].content).toBe('src1 chunk');
    });
  });

  describe('deleteBySourceId', () => {
    it('should delete all chunks for a source and return count', () => {
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'a',
          embedding: new Float32Array([1]),
          tokenCount: 1,
          model: 'model',
        },
        {
          sourceId: 'src1',
          chunkIndex: 1,
          content: 'b',
          embedding: new Float32Array([2]),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const count = repo.deleteBySourceId('src1');
      expect(count).toBe(2);
      expect(repo.getBySourceId('src1')).toEqual([]);
    });

    it('should return 0 for non-existent source', () => {
      expect(repo.deleteBySourceId('nonexistent')).toBe(0);
    });

    it('should not affect other sources', () => {
      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'a',
          embedding: new Float32Array([1]),
          tokenCount: 1,
          model: 'model',
        },
        {
          sourceId: 'src2',
          chunkIndex: 0,
          content: 'b',
          embedding: new Float32Array([2]),
          tokenCount: 1,
          model: 'model',
        },
      ]);

      repo.deleteBySourceId('src1');
      expect(repo.getBySourceId('src2')).toHaveLength(1);
    });
  });

  describe('Float32Array round-trip with sliced arrays', () => {
    it('should handle Float32Array created from a shared ArrayBuffer', () => {
      // Create a larger buffer and take a slice
      const bigBuffer = new ArrayBuffer(32); // 8 floats
      const fullArray = new Float32Array(bigBuffer);
      fullArray.set([0, 0, 1.0, 2.0, 3.0, 0, 0, 0]);

      // Create a view into the middle of the buffer
      const slice = new Float32Array(bigBuffer, 8, 3); // offset=8 bytes, length=3
      expect(slice[0]).toBeCloseTo(1.0);
      expect(slice[1]).toBeCloseTo(2.0);
      expect(slice[2]).toBeCloseTo(3.0);

      repo.insertMany([
        {
          sourceId: 'src1',
          chunkIndex: 0,
          content: 'test',
          embedding: slice,
          tokenCount: 1,
          model: 'model',
        },
      ]);

      const retrieved = repo.getBySourceId('src1');
      expect(retrieved[0].embedding.length).toBe(3);
      expect(retrieved[0].embedding[0]).toBeCloseTo(1.0);
      expect(retrieved[0].embedding[1]).toBeCloseTo(2.0);
      expect(retrieved[0].embedding[2]).toBeCloseTo(3.0);
    });
  });
});
