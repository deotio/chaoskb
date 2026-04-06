import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { SyncQueueRepository } from '../sync-queue-repo.js';
import { initializeSchema } from '../schema.js';

describe('SyncQueueRepository', () => {
  let db: BetterSqlite3.Database;
  let tempDir: string;
  let repo: SyncQueueRepository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chaoskb-queue-test-'));
    db = new BetterSqlite3(join(tempDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeSchema(db);
    repo = new SyncQueueRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true });
  });

  describe('enqueue', () => {
    it('should enqueue an upload with data', () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      repo.enqueue('b_test1', 'upload', data);
      expect(repo.pendingCount()).toBe(1);
    });

    it('should enqueue a delete without data', () => {
      repo.enqueue('b_test1', 'delete');
      expect(repo.pendingCount()).toBe(1);
    });

    it('should replace existing pending entry for same blob+operation', () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);
      repo.enqueue('b_test1', 'upload', data1);
      repo.enqueue('b_test1', 'upload', data2);
      expect(repo.pendingCount()).toBe(1);

      const items = repo.claimBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].data).toEqual(data2);
    });

    it('should allow same blob with different operations', () => {
      repo.enqueue('b_test1', 'upload', new Uint8Array([1]));
      repo.enqueue('b_test1', 'delete');
      expect(repo.pendingCount()).toBe(2);
    });
  });

  describe('claimBatch', () => {
    it('should claim pending items', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      repo.enqueue('b_2', 'upload', new Uint8Array([2]));

      const items = repo.claimBatch(10);
      expect(items).toHaveLength(2);
      expect(items[0].status).toBe('processing');
      expect(items[1].status).toBe('processing');
    });

    it('should not reclaim already processing items', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      repo.enqueue('b_2', 'upload', new Uint8Array([2]));

      const batch1 = repo.claimBatch(10);
      expect(batch1).toHaveLength(2);

      const batch2 = repo.claimBatch(10);
      expect(batch2).toHaveLength(0);
    });

    it('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        repo.enqueue(`b_${i}`, 'upload', new Uint8Array([i]));
      }

      const items = repo.claimBatch(2);
      expect(items).toHaveLength(2);
    });

    it('should return items in FIFO order', () => {
      repo.enqueue('b_first', 'upload', new Uint8Array([1]));
      repo.enqueue('b_second', 'upload', new Uint8Array([2]));

      const items = repo.claimBatch(10);
      expect(items[0].blobId).toBe('b_first');
      expect(items[1].blobId).toBe('b_second');
    });

    it('should produce disjoint sets from two claimBatch calls (simulates multi-process)', () => {
      for (let i = 0; i < 10; i++) {
        repo.enqueue(`b_${i}`, 'upload', new Uint8Array([i]));
      }

      // Two separate repositories on the same DB (simulates two processes)
      const repo2 = new SyncQueueRepository(db);

      const batch1 = repo.claimBatch(5);
      const batch2 = repo2.claimBatch(5);

      expect(batch1).toHaveLength(5);
      expect(batch2).toHaveLength(5);

      const ids1 = new Set(batch1.map(i => i.blobId));
      const ids2 = new Set(batch2.map(i => i.blobId));

      // No overlap
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });
  });

  describe('complete', () => {
    it('should remove item from queue', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      const [item] = repo.claimBatch(1);
      repo.complete(item.id);
      expect(repo.pendingCount()).toBe(0);
    });
  });

  describe('fail', () => {
    it('should increment retry count and set back to pending', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      const [item] = repo.claimBatch(1);

      repo.fail(item.id, 'network timeout');

      // Item should be pending again but with backoff
      // It won't be claimable immediately because next_attempt is in the future
      const immediate = repo.claimBatch(10);
      expect(immediate).toHaveLength(0);
      expect(repo.pendingCount()).toBe(1);
    });

    it('should store the error message', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      const [item] = repo.claimBatch(1);
      repo.fail(item.id, 'HTTP 500');

      // Bypass backoff by updating next_attempt
      db.prepare("UPDATE sync_queue SET next_attempt = datetime('now', '-1 seconds') WHERE id = ?").run(item.id);

      const [retried] = repo.claimBatch(1);
      expect(retried.errorMessage).toBe('HTTP 500');
      expect(retried.retryCount).toBe(1);
    });
  });

  describe('permanentFail', () => {
    it('should mark item as permanently failed', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      const [item] = repo.claimBatch(1);
      repo.permanentFail(item.id, 'max retries exceeded');

      // Should not be claimable
      const items = repo.claimBatch(10);
      expect(items).toHaveLength(0);

      // Should not count as pending
      expect(repo.pendingCount()).toBe(0);
    });
  });

  describe('releaseStale', () => {
    it('should release processing items older than threshold', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      const [item] = repo.claimBatch(1);

      // Simulate stale item by backdating last_attempt
      db.prepare("UPDATE sync_queue SET last_attempt = datetime('now', '-600 seconds') WHERE id = ?")
        .run(item.id);

      const released = repo.releaseStale(300);
      expect(released).toBe(1);

      // Should be claimable again
      const items = repo.claimBatch(10);
      expect(items).toHaveLength(1);
      expect(items[0].blobId).toBe('b_1');
    });

    it('should not release recent processing items', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      repo.claimBatch(1);

      const released = repo.releaseStale(300);
      expect(released).toBe(0);
    });
  });

  describe('pendingCount', () => {
    it('should count pending and processing items', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      repo.enqueue('b_2', 'upload', new Uint8Array([2]));
      repo.enqueue('b_3', 'upload', new Uint8Array([3]));
      expect(repo.pendingCount()).toBe(3);

      repo.claimBatch(1); // One is now processing
      expect(repo.pendingCount()).toBe(3); // Still counts processing
    });

    it('should not count completed or failed items', () => {
      repo.enqueue('b_1', 'upload', new Uint8Array([1]));
      repo.enqueue('b_2', 'upload', new Uint8Array([2]));

      const items = repo.claimBatch(2);
      repo.complete(items[0].id);
      repo.permanentFail(items[1].id, 'failed');

      expect(repo.pendingCount()).toBe(0);
    });
  });
});
