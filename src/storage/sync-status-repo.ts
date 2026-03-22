import type BetterSqlite3 from 'better-sqlite3';
import type { ISyncStatusRepository, SyncStatusRecord } from './types.js';
import { SyncStatus } from './types.js';

interface SyncStatusRow {
  blob_id: string;
  status: string;
  last_attempt: string | null;
  error_message: string | null;
}

function rowToRecord(row: SyncStatusRow): SyncStatusRecord {
  return {
    blobId: row.blob_id,
    status: row.status as SyncStatus,
    lastAttempt: row.last_attempt ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

export class SyncStatusRepository implements ISyncStatusRepository {
  private readonly setStmt: BetterSqlite3.Statement;
  private readonly getStmt: BetterSqlite3.Statement;
  private readonly getPendingStmt: BetterSqlite3.Statement;
  private readonly getByStatusStmt: BetterSqlite3.Statement;

  constructor(db: BetterSqlite3.Database) {
    this.setStmt = db.prepare(`
      INSERT OR REPLACE INTO sync_status (blob_id, status, last_attempt, error_message)
      VALUES (?, ?, datetime('now'), ?)
    `);

    this.getStmt = db.prepare('SELECT * FROM sync_status WHERE blob_id = ?');

    this.getPendingStmt = db.prepare(
      `SELECT * FROM sync_status WHERE status IN ('${SyncStatus.LocalOnly}', '${SyncStatus.SyncFailed}')`,
    );

    this.getByStatusStmt = db.prepare('SELECT * FROM sync_status WHERE status = ?');
  }

  set(blobId: string, status: SyncStatus, errorMessage?: string): void {
    this.setStmt.run(blobId, status, errorMessage ?? null);
  }

  get(blobId: string): SyncStatusRecord | null {
    const row = this.getStmt.get(blobId) as SyncStatusRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  getPending(): SyncStatusRecord[] {
    const rows = this.getPendingStmt.all() as SyncStatusRow[];
    return rows.map(rowToRecord);
  }

  getByStatus(status: SyncStatus): SyncStatusRecord[] {
    const rows = this.getByStatusStmt.all(status) as SyncStatusRow[];
    return rows.map(rowToRecord);
  }
}
