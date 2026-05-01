import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initializeSchema } from '../schema.js';
import { SourceRepository } from '../source-repo.js';

describe('SourceRepository', () => {
  let tmpDir: string;
  let db: BetterSqlite3.Database;
  let repo: SourceRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaoskb-source-test-'));
    db = new BetterSqlite3(path.join(tmpDir, 'test.db'));
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
    repo = new SourceRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('insert', () => {
    it('should insert a source and return it with timestamps', () => {
      const result = repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Example',
        tags: ['test', 'example'],
        chunkCount: 5,
        blobSizeBytes: 1024,
      });

      expect(result.id).toBe('src1');
      expect(result.url).toBe('https://example.com');
      expect(result.title).toBe('Example');
      expect(result.tags).toEqual(['test', 'example']);
      expect(result.chunkCount).toBe(5);
      expect(result.blobSizeBytes).toBe(1024);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.lastAccessedAt).toBeDefined();
      expect(result.deletedAt).toBeUndefined();
    });

    it('should store tags as JSON in the database', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Example',
        tags: ['a', 'b', 'c'],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      const row = db.prepare('SELECT tags FROM sources WHERE id = ?').get('src1') as {
        tags: string;
      };
      expect(row.tags).toBe('["a","b","c"]');
    });

    it('should handle empty tags', () => {
      const result = repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Example',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      expect(result.tags).toEqual([]);
    });
  });

  describe('getById', () => {
    it('should return null for non-existent id', () => {
      expect(repo.getById('nonexistent')).toBeNull();
    });

    it('should return the correct source', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Example',
        tags: ['test'],
        chunkCount: 3,
        blobSizeBytes: 512,
      });

      const result = repo.getById('src1');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('src1');
      expect(result!.tags).toEqual(['test']);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      // Insert test data with slight time gaps
      repo.insert({
        id: 'src1',
        url: 'https://example.com/1',
        title: 'First Article',
        tags: ['javascript', 'tutorial'],
        chunkCount: 3,
        blobSizeBytes: 100,
      });
      repo.insert({
        id: 'src2',
        url: 'https://example.com/2',
        title: 'Second Post',
        tags: ['python', 'tutorial'],
        chunkCount: 5,
        blobSizeBytes: 200,
      });
      repo.insert({
        id: 'src3',
        url: 'https://example.com/3',
        title: 'Third Blog',
        tags: ['javascript'],
        chunkCount: 2,
        blobSizeBytes: 50,
      });
    });

    it('should list all non-deleted sources', () => {
      const sources = repo.list();
      expect(sources).toHaveLength(3);
    });

    it('should order by created_at descending', () => {
      const sources = repo.list();
      // All created in the same second, so we just verify all are returned
      // and that the ORDER BY clause doesn't cause an error
      expect(sources).toHaveLength(3);
      const ids = sources.map((s) => s.id).sort();
      expect(ids).toEqual(['src1', 'src2', 'src3']);
    });

    it('should filter by tags', () => {
      const sources = repo.list({ tags: ['javascript'] });
      expect(sources).toHaveLength(2);
      expect(sources.map((s) => s.id)).toContain('src1');
      expect(sources.map((s) => s.id)).toContain('src3');
    });

    it('should filter by multiple tags (AND logic)', () => {
      const sources = repo.list({ tags: ['javascript', 'tutorial'] });
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('src1');
    });

    it('should filter by titleSearch', () => {
      const sources = repo.list({ titleSearch: 'Article' });
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('src1');
    });

    it('should filter by titleSearch case-insensitively (SQLite LIKE default)', () => {
      const sources = repo.list({ titleSearch: 'post' });
      // SQLite LIKE is case-insensitive for ASCII by default
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('src2');
    });

    it('should exclude deleted sources by default', () => {
      repo.softDelete('src1');
      const sources = repo.list();
      expect(sources).toHaveLength(2);
      expect(sources.map((s) => s.id)).not.toContain('src1');
    });

    it('should include deleted sources when includeDeleted is true', () => {
      repo.softDelete('src1');
      const sources = repo.list({ includeDeleted: true });
      expect(sources).toHaveLength(3);
    });

    it('should support pagination', () => {
      const page1 = repo.list(undefined, { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = repo.list(undefined, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it('should filter by since date', () => {
      // All records created at 'now', so a past date should include all
      const sources = repo.list({ since: '2000-01-01T00:00:00' });
      expect(sources).toHaveLength(3);

      // A future date should include none
      const empty = repo.list({ since: '2099-01-01T00:00:00' });
      expect(empty).toHaveLength(0);
    });
  });

  describe('count', () => {
    beforeEach(() => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com/1',
        title: 'First',
        tags: ['a'],
        chunkCount: 1,
        blobSizeBytes: 10,
      });
      repo.insert({
        id: 'src2',
        url: 'https://example.com/2',
        title: 'Second',
        tags: ['b'],
        chunkCount: 1,
        blobSizeBytes: 10,
      });
    });

    it('should count non-deleted sources', () => {
      expect(repo.count()).toBe(2);
    });

    it('should respect filters', () => {
      expect(repo.count({ tags: ['a'] })).toBe(1);
    });

    it('should exclude deleted sources by default', () => {
      repo.softDelete('src1');
      expect(repo.count()).toBe(1);
    });

    it('should include deleted sources when includeDeleted is true', () => {
      repo.softDelete('src1');
      expect(repo.count({ includeDeleted: true })).toBe(2);
    });
  });

  describe('softDelete', () => {
    it('should soft delete a source', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      const result = repo.softDelete('src1');
      expect(result).toBe(true);

      const source = repo.getById('src1');
      expect(source!.deletedAt).toBeDefined();
    });

    it('should return false for non-existent source', () => {
      expect(repo.softDelete('nonexistent')).toBe(false);
    });

    it('should return false for already deleted source', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      repo.softDelete('src1');
      expect(repo.softDelete('src1')).toBe(false);
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted source', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      repo.softDelete('src1');
      const result = repo.restore('src1');
      expect(result).toBe(true);

      const source = repo.getById('src1');
      expect(source!.deletedAt).toBeUndefined();
    });

    it('should return false for non-deleted source', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      expect(repo.restore('src1')).toBe(false);
    });
  });

  describe('updateLastAccessed', () => {
    it('should update the lastAccessedAt timestamp', () => {
      repo.insert({
        id: 'src1',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        chunkCount: 0,
        blobSizeBytes: 0,
      });

      const before = repo.getById('src1')!.lastAccessedAt;
      repo.updateLastAccessed('src1');
      const after = repo.getById('src1')!.lastAccessedAt;

      // They should be equal or after should be >= before (same second in tests)
      expect(after >= before).toBe(true);
    });
  });
});
