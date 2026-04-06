import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { SyncStateRepository } from '../sync-state-repo.js';
import { initializeSchema } from '../schema.js';

describe('SyncStateRepository', () => {
  let db: BetterSqlite3.Database;
  let tempDir: string;
  let repo: SyncStateRepository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'chaoskb-state-test-'));
    db = new BetterSqlite3(join(tempDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    initializeSchema(db);
    repo = new SyncStateRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true });
  });

  it('should return undefined for missing key', () => {
    expect(repo.get('nonexistent')).toBeUndefined();
  });

  it('should set and get a value', () => {
    repo.set('lastSync', '2026-04-06T00:00:00Z');
    expect(repo.get('lastSync')).toBe('2026-04-06T00:00:00Z');
  });

  it('should overwrite existing value', () => {
    repo.set('cursor', 'abc');
    repo.set('cursor', 'def');
    expect(repo.get('cursor')).toBe('def');
  });

  it('should delete a key', () => {
    repo.set('key1', 'value1');
    repo.delete('key1');
    expect(repo.get('key1')).toBeUndefined();
  });

  it('should handle delete of nonexistent key', () => {
    expect(() => repo.delete('missing')).not.toThrow();
  });

  it('should store multiple keys independently', () => {
    repo.set('a', '1');
    repo.set('b', '2');
    repo.set('c', '3');
    expect(repo.get('a')).toBe('1');
    expect(repo.get('b')).toBe('2');
    expect(repo.get('c')).toBe('3');
  });
});
