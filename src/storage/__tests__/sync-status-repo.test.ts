import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initializeSchema } from '../schema.js';
import { SyncStatusRepository } from '../sync-status-repo.js';
import { SyncStatus } from '../types.js';

describe('SyncStatusRepository', () => {
  let tmpDir: string;
  let db: BetterSqlite3.Database;
  let repo: SyncStatusRepository;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaoskb-sync-test-'));
    db = new BetterSqlite3(path.join(tmpDir, 'test.db'));
    initializeSchema(db);
    repo = new SyncStatusRepository(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('set and get', () => {
    it('should set and retrieve a sync status', () => {
      repo.set('blob1', SyncStatus.LocalOnly);
      const result = repo.get('blob1');

      expect(result).not.toBeNull();
      expect(result!.blobId).toBe('blob1');
      expect(result!.status).toBe(SyncStatus.LocalOnly);
      expect(result!.lastAttempt).toBeDefined();
      expect(result!.errorMessage).toBeUndefined();
    });

    it('should store an error message', () => {
      repo.set('blob1', SyncStatus.SyncFailed, 'Network error');
      const result = repo.get('blob1');

      expect(result!.status).toBe(SyncStatus.SyncFailed);
      expect(result!.errorMessage).toBe('Network error');
    });

    it('should return null for non-existent blob', () => {
      expect(repo.get('nonexistent')).toBeNull();
    });

    it('should upsert (update existing record)', () => {
      repo.set('blob1', SyncStatus.LocalOnly);
      repo.set('blob1', SyncStatus.Synced);

      const result = repo.get('blob1');
      expect(result!.status).toBe(SyncStatus.Synced);

      // Verify only one row exists
      const count = db.prepare('SELECT COUNT(*) as cnt FROM sync_status WHERE blob_id = ?').get('blob1') as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('should clear error message on upsert without error', () => {
      repo.set('blob1', SyncStatus.SyncFailed, 'some error');
      repo.set('blob1', SyncStatus.Synced);

      const result = repo.get('blob1');
      expect(result!.errorMessage).toBeUndefined();
    });
  });

  describe('getPending', () => {
    it('should return local_only and sync_failed records', () => {
      repo.set('blob1', SyncStatus.LocalOnly);
      repo.set('blob2', SyncStatus.Synced);
      repo.set('blob3', SyncStatus.SyncFailed, 'error');
      repo.set('blob4', SyncStatus.PendingDelete);

      const pending = repo.getPending();
      expect(pending).toHaveLength(2);

      const ids = pending.map((p) => p.blobId).sort();
      expect(ids).toEqual(['blob1', 'blob3']);
    });

    it('should return empty array when nothing is pending', () => {
      repo.set('blob1', SyncStatus.Synced);
      expect(repo.getPending()).toEqual([]);
    });
  });

  describe('getByStatus', () => {
    beforeEach(() => {
      repo.set('blob1', SyncStatus.LocalOnly);
      repo.set('blob2', SyncStatus.Synced);
      repo.set('blob3', SyncStatus.SyncFailed, 'error');
      repo.set('blob4', SyncStatus.Synced);
    });

    it('should return records with the specified status', () => {
      const synced = repo.getByStatus(SyncStatus.Synced);
      expect(synced).toHaveLength(2);
      expect(synced.map((s) => s.blobId).sort()).toEqual(['blob2', 'blob4']);
    });

    it('should return empty array for status with no records', () => {
      const pending = repo.getByStatus(SyncStatus.PendingDelete);
      expect(pending).toEqual([]);
    });
  });
});
