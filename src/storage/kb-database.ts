import type {
  IDatabase,
  ISourceRepository,
  IChunkRepository,
  ISyncStatusRepository,
  IEmbeddingIndex,
  DatabaseConfig,
} from './types.js';
import { Database } from './database.js';
import { SourceRepository } from './source-repo.js';
import { ChunkRepository } from './chunk-repo.js';
import { SyncStatusRepository } from './sync-status-repo.js';
import { EmbeddingIndex } from './embedding-index.js';

export class KBDatabase implements IDatabase {
  private readonly database: Database;

  readonly sources: ISourceRepository;
  readonly chunks: IChunkRepository;
  readonly syncStatus: ISyncStatusRepository;
  readonly embeddingIndex: IEmbeddingIndex;

  constructor(config: DatabaseConfig) {
    this.database = new Database(config);
    const db = this.database.db;

    this.sources = new SourceRepository(db);
    this.chunks = new ChunkRepository(db);
    this.syncStatus = new SyncStatusRepository(db);
    this.embeddingIndex = new EmbeddingIndex(db);
  }

  close(): void {
    this.database.close();
  }
}
