import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

import type {
  ISyncService,
  SyncConfig,
  SyncState,
  SyncResult,
  QuotaInfo,
} from './types.js';
import type { IDatabase } from '../storage/types.js';
import type { IEncryptionService, DerivedKeySet } from '../crypto/types.js';
import { SSHSigner } from './ssh-signer.js';
import { SyncHttpClient } from './http-client.js';
import { UploadQueue } from './upload-queue.js';
import { incrementalSync } from './incremental-sync.js';
import { fullSync } from './full-sync.js';
import { verifyCanary } from './canary.js';
import { verifyBlobCount } from './verification.js';

const CHAOSKB_DIR = join(homedir(), '.chaoskb');
const SYNC_STATE_PATH = join(CHAOSKB_DIR, 'sync-state.json');
const UPLOAD_QUEUE_PATH = join(CHAOSKB_DIR, 'upload-queue.json');

/**
 * Main sync service that orchestrates all sync operations.
 *
 * Manages SSH signing, HTTP communication, upload queueing,
 * and sync state persistence.
 */
export class SyncService implements ISyncService {
  private readonly httpClient: SyncHttpClient;
  private readonly uploadQueue: UploadQueue;
  private readonly storage: IDatabase;
  private readonly encryptionService: IEncryptionService;
  private readonly keys: DerivedKeySet;
  private state: SyncState;

  constructor(
    config: SyncConfig,
    storage: IDatabase,
    encryptionService: IEncryptionService,
    keys: DerivedKeySet,
  ) {
    const signer = new SSHSigner(config.sshKeyPath);
    this.httpClient = new SyncHttpClient(config, signer);
    this.uploadQueue = new UploadQueue(this.httpClient, UPLOAD_QUEUE_PATH);
    this.storage = storage;
    this.encryptionService = encryptionService;
    this.keys = keys;
    this.state = this.loadState();
  }

  /**
   * Run incremental sync — download changes since last successful sync.
   */
  async incrementalSync(): Promise<SyncResult> {
    const result = await incrementalSync(
      this.httpClient,
      this.storage,
      this.state.lastSyncTimestamp,
    );

    if (result.success) {
      this.state.lastSyncTimestamp = new Date().toISOString();
      this.saveState();
    }

    // Process any pending uploads after downloading
    await this.uploadQueue.processQueue();

    return result;
  }

  /**
   * Run full sync — download all blobs from the server.
   */
  async fullSync(): Promise<SyncResult> {
    const result = await fullSync(this.httpClient, this.storage, this.state);
    this.saveState();
    return result;
  }

  /**
   * Enqueue a blob for upload to the server.
   */
  async upload(blobId: string, data: Uint8Array): Promise<void> {
    await this.uploadQueue.enqueue(blobId, data);
    // Attempt immediate upload
    await this.uploadQueue.processQueue();
  }

  /**
   * Get current quota usage from the server.
   *
   * Fetches quota info from the blob count endpoint, which includes
   * quota headers in its response.
   */
  async getQuota(): Promise<QuotaInfo> {
    const response = await this.httpClient.get('/v1/blobs/count');
    if (!response.ok) {
      throw new Error(`Failed to get quota: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { count: number; quota?: QuotaInfo };
    if (data.quota) {
      return data.quota;
    }

    // Fallback: no quota info available
    return { used: 0, limit: 0, percentage: 0 };
  }

  /**
   * Write and verify a canary blob to confirm encryption keys work.
   */
  async verifyCanary(): Promise<boolean> {
    return verifyCanary(this.httpClient, this.encryptionService, this.keys);
  }

  /**
   * Verify that the local blob count matches the server.
   */
  async verifyCount(localCount: number): Promise<boolean> {
    const result = await verifyBlobCount(this.httpClient, localCount);
    return result.match;
  }

  private loadState(): SyncState {
    try {
      if (existsSync(SYNC_STATE_PATH)) {
        const raw = readFileSync(SYNC_STATE_PATH, 'utf-8');
        return JSON.parse(raw) as SyncState;
      }
    } catch {
      // Corrupted state file — start fresh
    }
    return { fullSyncInProgress: false };
  }

  private saveState(): void {
    const dir = dirname(SYNC_STATE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(SYNC_STATE_PATH, JSON.stringify(this.state, null, 2), 'utf-8');
  }
}
