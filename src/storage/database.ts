import BetterSqlite3 from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DatabaseConfig } from './types.js';
import { initializeSchema } from './schema.js';

export class Database {
  private readonly _db: BetterSqlite3.Database;

  constructor(config: DatabaseConfig) {
    const dbDir = path.dirname(config.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    }

    const isNew = !fs.existsSync(config.path);

    this._db = new BetterSqlite3(config.path);

    if (isNew) {
      fs.chmodSync(config.path, 0o600);
    }

    // Configure database pragmas
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('busy_timeout = 5000');

    // Initialize schema
    initializeSchema(this._db);
  }

  get db(): BetterSqlite3.Database {
    return this._db;
  }

  close(): void {
    this._db.close();
  }

  transaction<T>(fn: () => T): T {
    return this._db.transaction(fn)();
  }
}
