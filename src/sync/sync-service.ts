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
import { SyncQueueProcessor } from './queue-processor.js';
import { incrementalSync } from './incremental-sync.js';
import { fullSync } from './full-sync.js';
import { verifyCanary } from './canary.js';
import { verifyBlobCount } from './verification.js';

/**
 * Main sync service that orchestrates all sync operations.
 *
 * Uses SQLite-backed queue and state (via IDatabase) instead of flat files.
 * Multi-process safe: concurrent VS Code instances share the same SQLite DB.
 */
export class SyncService implements ISyncService {
  private readonly httpClient: SyncHttpClient;
  private readonly queueProcessor: SyncQueueProcessor;
  private readonly storage: IDatabase;
  private readonly encryptionService: IEncryptionService;
  private readonly keys: DerivedKeySet;

  constructor(
    config: SyncConfig,
    storage: IDatabase,
    encryptionService: IEncryptionService,
    keys: DerivedKeySet,
  ) {
    const signer = new SSHSigner(config.sshKeyPath);
    this.httpClient = new SyncHttpClient(config, signer, storage.syncSequence);
    this.queueProcessor = new SyncQueueProcessor(storage.syncQueue, this.httpClient);
    this.storage = storage;
    this.encryptionService = encryptionService;
    this.keys = keys;
  }

  /**
   * Run incremental sync — download changes since last successful sync.
   */
  async incrementalSync(): Promise<SyncResult> {
    const lastSync = this.storage.syncState.get('lastSyncTimestamp');
    const result = await incrementalSync(
      this.httpClient,
      this.storage,
      lastSync,
    );

    if (result.success) {
      this.storage.syncState.set('lastSyncTimestamp', new Date().toISOString());
    }

    // Process any pending uploads/deletes after downloading
    await this.queueProcessor.processQueue();

    return result;
  }

  /**
   * Run full sync — download all blobs from the server.
   */
  async fullSync(): Promise<SyncResult> {
    const state = this.loadState();
    const result = await fullSync(this.httpClient, this.storage, state);
    this.saveState(state);
    return result;
  }

  /**
   * Enqueue a blob for upload to the server.
   */
  async upload(blobId: string, data: Uint8Array): Promise<void> {
    this.storage.syncQueue.enqueue(blobId, 'upload', data);
    // Attempt immediate processing
    await this.queueProcessor.processQueue();
  }

  /**
   * Enqueue a blob for deletion from the server.
   */
  async deleteBlob(blobId: string): Promise<void> {
    this.storage.syncQueue.enqueue(blobId, 'delete');
    // Attempt immediate processing
    await this.queueProcessor.processQueue();
  }

  /**
   * Process pending items in the sync queue.
   * Called by the MCP server after tool calls that enqueue items.
   */
  async drainQueue(): Promise<void> {
    await this.queueProcessor.processQueue();
  }

  /**
   * Get current quota usage from the server.
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

  /**
   * Check for unacknowledged notifications from the server.
   */
  async checkNotifications(): Promise<string[]> {
    try {
      const response = await this.httpClient.get('/v1/notifications');
      if (!response.ok) return [];

      const data = (await response.json()) as {
        notifications: Array<{
          id: string;
          type: string;
          deviceInfo?: {
            hostname?: string;
            platform?: string;
            osVersion?: string;
            arch?: string;
            deviceModel?: string | null;
            location?: string | null;
          };
          timestamp: string;
        }>;
      };

      if (data.notifications.length === 0) return [];

      return data.notifications.map((n) => {
        const time = new Date(n.timestamp).toLocaleString();
        const typeLabel = n.type === 'device_linked' ? 'New device linked'
          : n.type === 'device_revoked' ? 'Device revoked'
          : n.type === 'key_rotated' ? 'Key rotated'
          : n.type;

        const parts = [typeLabel];
        if (n.deviceInfo?.hostname) parts.push(`host: ${n.deviceInfo.hostname}`);
        if (n.deviceInfo?.deviceModel) parts.push(`device: ${n.deviceInfo.deviceModel}`);
        if (n.deviceInfo?.location) parts.push(`location: ${n.deviceInfo.location}`);
        parts.push(time);

        return parts.join(' — ');
      });
    } catch {
      return [];
    }
  }

  /**
   * Load full sync state from SQLite key-value store.
   */
  private loadState(): SyncState {
    const fullSyncInProgress = this.storage.syncState.get('fullSyncInProgress') === 'true';
    const fullSyncCursor = this.storage.syncState.get('fullSyncCursor');
    const lastSyncTimestamp = this.storage.syncState.get('lastSyncTimestamp');
    return {
      fullSyncInProgress,
      fullSyncCursor,
      lastSyncTimestamp,
    };
  }

  /**
   * Save full sync state to SQLite key-value store.
   */
  private saveState(state: SyncState): void {
    this.storage.syncState.set('fullSyncInProgress', String(state.fullSyncInProgress));
    if (state.fullSyncCursor) {
      this.storage.syncState.set('fullSyncCursor', state.fullSyncCursor);
    } else {
      this.storage.syncState.delete('fullSyncCursor');
    }
    if (state.lastSyncTimestamp) {
      this.storage.syncState.set('lastSyncTimestamp', state.lastSyncTimestamp);
    }
  }
}
