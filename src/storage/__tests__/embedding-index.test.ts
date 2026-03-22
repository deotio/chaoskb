import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initializeSchema } from '../schema.js';
import { EmbeddingIndex } from '../embedding-index.js';

describe('EmbeddingIndex', () => {
  let tmpDir: string;
  let db: BetterSqlite3.Database;
  let index: EmbeddingIndex;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaoskb-embed-test-'));
    db = new BetterSqlite3(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    index = new EmbeddingIndex(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function insertSourceWithChunks(
    sourceId: string,
    embeddings: Float32Array[],
  ): void {
    db.prepare('INSERT INTO sources (id, url) VALUES (?, ?)').run(sourceId, `http://${sourceId}`);
    for (let i = 0; i < embeddings.length; i++) {
      const buf = Buffer.from(
        embeddings[i].buffer,
        embeddings[i].byteOffset,
        embeddings[i].byteLength,
      );
      db.prepare(
        'INSERT INTO chunks (id, source_id, chunk_index, content, embedding, token_count, model) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(`${sourceId}-c${i}`, sourceId, i, `chunk ${i}`, buf, 1, 'test');
    }
  }

  describe('load', () => {
    it('should load embeddings from the database', () => {
      insertSourceWithChunks('src1', [
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
      ]);
      insertSourceWithChunks('src2', [new Float32Array([0, 0, 1])]);

      index.load();
      expect(index.size).toBe(3);
    });

    it('should handle empty database', () => {
      index.load();
      expect(index.size).toBe(0);
    });

    it('should clear existing data on reload', () => {
      insertSourceWithChunks('src1', [new Float32Array([1, 0, 0])]);
      index.load();
      expect(index.size).toBe(1);

      // Delete from DB and reload
      db.prepare('DELETE FROM chunks').run();
      index.load();
      expect(index.size).toBe(0);
    });
  });

  describe('add', () => {
    it('should add embeddings to the index', () => {
      index.add('src1', [
        { chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) },
        { chunkIndex: 1, embedding: new Float32Array([0, 1, 0]) },
      ]);

      expect(index.size).toBe(2);
    });

    it('should overwrite existing embeddings for the same chunk', () => {
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) }]);
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([0, 1, 0]) }]);

      expect(index.size).toBe(1);
    });

    it('should handle adding to existing source', () => {
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) }]);
      index.add('src1', [{ chunkIndex: 1, embedding: new Float32Array([0, 1, 0]) }]);

      expect(index.size).toBe(2);
    });
  });

  describe('remove', () => {
    it('should remove all embeddings for a source', () => {
      index.add('src1', [
        { chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) },
        { chunkIndex: 1, embedding: new Float32Array([0, 1, 0]) },
      ]);
      index.add('src2', [{ chunkIndex: 0, embedding: new Float32Array([0, 0, 1]) }]);

      index.remove('src1');
      expect(index.size).toBe(1);
    });

    it('should handle removing non-existent source', () => {
      index.remove('nonexistent');
      expect(index.size).toBe(0);
    });
  });

  describe('search', () => {
    it('should return results sorted by cosine similarity', () => {
      // Setup: three embeddings along different axes
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) }]);
      index.add('src2', [{ chunkIndex: 0, embedding: new Float32Array([0, 1, 0]) }]);
      index.add('src3', [{ chunkIndex: 0, embedding: new Float32Array([0.9, 0.1, 0]) }]);

      // Query along x-axis — src1 and src3 should be most similar
      const results = index.search(new Float32Array([1, 0, 0]), 3);

      expect(results).toHaveLength(3);
      expect(results[0].sourceId).toBe('src1');
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[1].sourceId).toBe('src3');
      expect(results[2].sourceId).toBe('src2');
      expect(results[2].score).toBeCloseTo(0.0, 5);
    });

    it('should respect topK limit', () => {
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) }]);
      index.add('src2', [{ chunkIndex: 0, embedding: new Float32Array([0, 1, 0]) }]);
      index.add('src3', [{ chunkIndex: 0, embedding: new Float32Array([0, 0, 1]) }]);

      const results = index.search(new Float32Array([1, 0, 0]), 1);
      expect(results).toHaveLength(1);
      expect(results[0].sourceId).toBe('src1');
    });

    it('should return correct chunkIndex', () => {
      index.add('src1', [
        { chunkIndex: 0, embedding: new Float32Array([1, 0, 0]) },
        { chunkIndex: 1, embedding: new Float32Array([0, 1, 0]) },
      ]);

      const results = index.search(new Float32Array([0, 1, 0]), 1);
      expect(results[0].sourceId).toBe('src1');
      expect(results[0].chunkIndex).toBe(1);
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it('should return empty array when index is empty', () => {
      const results = index.search(new Float32Array([1, 0, 0]), 5);
      expect(results).toEqual([]);
    });

    it('should handle identical embeddings', () => {
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([1, 1, 1]) }]);
      index.add('src2', [{ chunkIndex: 0, embedding: new Float32Array([1, 1, 1]) }]);

      const results = index.search(new Float32Array([1, 1, 1]), 2);
      expect(results).toHaveLength(2);
      expect(results[0].score).toBeCloseTo(1.0, 5);
      expect(results[1].score).toBeCloseTo(1.0, 5);
    });

    it('should handle zero vectors gracefully', () => {
      index.add('src1', [{ chunkIndex: 0, embedding: new Float32Array([0, 0, 0]) }]);

      const results = index.search(new Float32Array([1, 0, 0]), 1);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0);
    });
  });

  describe('size', () => {
    it('should track size correctly across operations', () => {
      expect(index.size).toBe(0);

      index.add('src1', [
        { chunkIndex: 0, embedding: new Float32Array([1, 0]) },
        { chunkIndex: 1, embedding: new Float32Array([0, 1]) },
      ]);
      expect(index.size).toBe(2);

      index.add('src2', [{ chunkIndex: 0, embedding: new Float32Array([1, 1]) }]);
      expect(index.size).toBe(3);

      index.remove('src1');
      expect(index.size).toBe(1);

      index.remove('src2');
      expect(index.size).toBe(0);
    });
  });
});
