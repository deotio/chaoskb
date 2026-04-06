import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { SyncSequenceRepository } from '../sync-sequence-repo.js';
import { initializeSchema } from '../schema.js';

describe('SyncSequenceRepository', () => {
  let db: BetterSqlite3.Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chaoskb-seq-test-'));
    db = new BetterSqlite3(join(tempDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeSchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true });
  });

  it('should start at 0', () => {
    const repo = new SyncSequenceRepository(db);
    expect(repo.peek()).toBe(0);
  });

  it('should increment monotonically', () => {
    const repo = new SyncSequenceRepository(db);
    expect(repo.next()).toBe(1);
    expect(repo.next()).toBe(2);
    expect(repo.next()).toBe(3);
  });

  it('should peek without incrementing', () => {
    const repo = new SyncSequenceRepository(db);
    repo.next();
    repo.next();
    expect(repo.peek()).toBe(2);
    expect(repo.peek()).toBe(2);
  });

  it('should persist across repository instances', () => {
    const repo1 = new SyncSequenceRepository(db);
    repo1.next(); // 1
    repo1.next(); // 2
    repo1.next(); // 3

    const repo2 = new SyncSequenceRepository(db);
    expect(repo2.peek()).toBe(3);
    expect(repo2.next()).toBe(4);
  });

  it('should produce unique values from two instances on same DB', () => {
    const repo1 = new SyncSequenceRepository(db);
    const repo2 = new SyncSequenceRepository(db);

    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(i % 2 === 0 ? repo1.next() : repo2.next());
    }

    // All 50 values should be unique
    expect(values.size).toBe(50);
    // Values should be 1..50
    expect(Math.max(...values)).toBe(50);
    expect(Math.min(...values)).toBe(1);
  });
});
