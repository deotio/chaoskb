import type BetterSqlite3 from 'better-sqlite3';
import type { ISyncStateRepository } from './types.js';

/**
 * SQLite-backed key-value store for sync state.
 * Replaces ~/.chaoskb/sync-state.json with multi-process safe storage.
 */
export class SyncStateRepository implements ISyncStateRepository {
  private readonly getStmt: BetterSqlite3.Statement;
  private readonly setStmt: BetterSqlite3.Statement;
  private readonly deleteStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.getStmt = db.prepare('SELECT value FROM sync_state WHERE key = ?');
    this.setStmt = db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)');
    this.deleteStmt = db.prepare('DELETE FROM sync_state WHERE key = ?');
  }

  get(key: string): string | undefined {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.setStmt.run(key, value);
  }

  delete(key: string): void {
    this.deleteStmt.run(key);
  }
}
