import type BetterSqlite3 from 'better-sqlite3';
import type { ISyncSequenceRepository } from './types.js';

/**
 * SQLite-backed atomic sequence counter.
 *
 * Uses UPDATE...RETURNING for atomic increment. SQLite's write
 * serialization (WAL mode + busy_timeout) ensures that concurrent
 * processes never produce duplicate sequence numbers.
 */
export class SyncSequenceRepository implements ISyncSequenceRepository {
  private readonly nextStmt: BetterSqlite3.Statement;
  private readonly peekStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.nextStmt = db.prepare(
      'UPDATE sync_sequence SET value = value + 1 WHERE id = 1 RETURNING value',
    );
    this.peekStmt = db.prepare('SELECT value FROM sync_sequence WHERE id = 1');
  }

  next(): number {
    const row = this.nextStmt.get() as { value: number };
    return row.value;
  }

  peek(): number {
    const row = this.peekStmt.get() as { value: number };
    return row.value;
  }
}
