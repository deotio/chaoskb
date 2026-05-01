import type BetterSqlite3 from 'better-sqlite3';
import type { ISyncQueueRepository, SyncQueueItem } from './types.js';

interface SyncQueueRow {
  id: number;
  blob_id: string;
  operation: string;
  data: Buffer | null;
  retry_count: number;
  max_retries: number;
  last_attempt: string | null;
  next_attempt: string | null;
  error_message: string | null;
  status: string;
  created_at: string;
}

function rowToItem(row: SyncQueueRow): SyncQueueItem {
  return {
    id: row.id,
    blobId: row.blob_id,
    operation: row.operation as 'upload' | 'delete',
    data: row.data ? new Uint8Array(row.data) : null,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    lastAttempt: row.last_attempt ?? undefined,
    nextAttempt: row.next_attempt ?? undefined,
    errorMessage: row.error_message ?? undefined,
    status: row.status as SyncQueueItem['status'],
    createdAt: row.created_at,
  };
}

/**
 * SQLite-backed sync queue for uploads and deletes.
 *
 * Multi-process safe: uses atomic UPDATE...RETURNING for claim,
 * so concurrent processes never double-process an item.
 */
export class SyncQueueRepository implements ISyncQueueRepository {
  private readonly db: BetterSqlite3.Database;
  private readonly enqueueStmt: BetterSqlite3.Statement;
  private readonly deleteExistingPendingStmt: BetterSqlite3.Statement;
  private readonly claimStmt: BetterSqlite3.Statement;
  private readonly completeStmt: BetterSqlite3.Statement;
  private readonly failStmt: BetterSqlite3.Statement;
  private readonly permanentFailStmt: BetterSqlite3.Statement;
  private readonly releaseStaleStmt: BetterSqlite3.Statement;
  private readonly pendingCountStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;

    this.enqueueStmt = db.prepare(`
      INSERT INTO sync_queue (blob_id, operation, data, status)
      VALUES (?, ?, ?, 'pending')
    `);

    this.deleteExistingPendingStmt = db.prepare(`
      DELETE FROM sync_queue
      WHERE blob_id = ? AND operation = ? AND status = 'pending'
    `);

    this.claimStmt = db.prepare(`
      UPDATE sync_queue
      SET status = 'processing', last_attempt = datetime('now')
      WHERE id IN (
        SELECT id FROM sync_queue
        WHERE status = 'pending'
          AND (next_attempt IS NULL OR next_attempt <= datetime('now'))
        ORDER BY created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    this.completeStmt = db.prepare('DELETE FROM sync_queue WHERE id = ?');

    this.failStmt = db.prepare(`
      UPDATE sync_queue
      SET status = 'pending',
          retry_count = retry_count + 1,
          error_message = ?,
          next_attempt = datetime('now', '+' || (1 << MIN(retry_count, 10)) || ' seconds')
      WHERE id = ?
    `);

    this.permanentFailStmt = db.prepare(`
      UPDATE sync_queue
      SET status = 'failed', error_message = ?
      WHERE id = ?
    `);

    this.releaseStaleStmt = db.prepare(`
      UPDATE sync_queue
      SET status = 'pending', next_attempt = NULL
      WHERE status = 'processing'
        AND last_attempt < datetime('now', '-' || ? || ' seconds')
    `);

    this.pendingCountStmt = db.prepare(`
      SELECT COUNT(*) as count FROM sync_queue
      WHERE status IN ('pending', 'processing')
    `);
  }

  enqueue(blobId: string, operation: 'upload' | 'delete', data?: Uint8Array): void {
    this.db.transaction(() => {
      this.deleteExistingPendingStmt.run(blobId, operation);
      this.enqueueStmt.run(blobId, operation, data ? Buffer.from(data) : null);
    })();
  }

  claimBatch(limit: number): SyncQueueItem[] {
    const rows = this.claimStmt.all(limit) as SyncQueueRow[];
    return rows.map(rowToItem);
  }

  complete(id: number): void {
    this.completeStmt.run(id);
  }

  fail(id: number, error: string): void {
    this.failStmt.run(error, id);
  }

  permanentFail(id: number, error: string): void {
    this.permanentFailStmt.run(error, id);
  }

  releaseStale(olderThanSeconds: number): number {
    const result = this.releaseStaleStmt.run(olderThanSeconds);
    return result.changes;
  }

  pendingCount(): number {
    const row = this.pendingCountStmt.get() as { count: number };
    return row.count;
  }
}
