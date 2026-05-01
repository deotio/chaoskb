import type {
  IDatabase,
  ISourceRepository,
  IChunkRepository,
  ISyncStatusRepository,
  ISyncQueueRepository,
  ISyncSequenceRepository,
  ISyncStateRepository,
  IEmbeddingIndex,
  DatabaseConfig,
} from './types.js';
import { SyncStatus } from './types.js';
import { Database } from './database.js';
import { SourceRepository } from './source-repo.js';
import { ChunkRepository } from './chunk-repo.js';
import { SyncStatusRepository } from './sync-status-repo.js';
import { SyncQueueRepository } from './sync-queue-repo.js';
import { SyncSequenceRepository } from './sync-sequence-repo.js';
import { SyncStateRepository } from './sync-state-repo.js';
import { EmbeddingIndex } from './embedding-index.js';

export class KBDatabase implements IDatabase {
  private readonly database: Database;

  readonly sources: ISourceRepository;
  readonly chunks: IChunkRepository;
  readonly syncStatus: ISyncStatusRepository;
  readonly syncQueue: ISyncQueueRepository;
  readonly syncSequence: ISyncSequenceRepository;
  readonly syncState: ISyncStateRepository;
  readonly embeddingIndex: IEmbeddingIndex;

  constructor(config: DatabaseConfig) {
    this.database = new Database(config);
    const db = this.database.db;

    this.sources = new SourceRepository(db);
    this.chunks = new ChunkRepository(db);
    this.syncStatus = new SyncStatusRepository(db);
    this.syncQueue = new SyncQueueRepository(db);
    this.syncSequence = new SyncSequenceRepository(db);
    this.syncState = new SyncStateRepository(db);
    this.embeddingIndex = new EmbeddingIndex(db);
  }

  storeAndEnqueueUpload(blobId: string, encryptedBytes: Uint8Array): void {
    this.syncQueue.enqueue(blobId, 'upload', encryptedBytes);
    this.syncStatus.set(blobId, SyncStatus.LocalOnly);
  }

  enqueueDelete(blobId: string): void {
    this.syncQueue.enqueue(blobId, 'delete');
    this.syncStatus.set(blobId, SyncStatus.PendingDelete);
  }

  close(): void {
    this.database.close();
  }
}
