import type { ISyncQueueRepository, SyncQueueItem } from '../storage/types.js';
import type { ISyncHttpClient } from './types.js';

/** Default batch size for claiming queue items. */
const DEFAULT_BATCH_SIZE = 10;

/** Seconds before a 'processing' item is considered stale (crash recovery). */
const STALE_THRESHOLD_SECONDS = 300;

export interface QueueProcessResult {
  uploaded: number;
  deleted: number;
  failed: number;
  /** True if processing was stopped early (e.g. quota exceeded). */
  quotaExceeded: boolean;
}

/**
 * Processes the SQLite-backed sync queue (uploads and deletes).
 *
 * Multi-process safe: uses claimBatch() for atomic item claiming,
 * so concurrent processes never double-process an item.
 */
export class SyncQueueProcessor {
  private readonly queue: ISyncQueueRepository;
  private readonly client: ISyncHttpClient;

  constructor(queue: ISyncQueueRepository, client: ISyncHttpClient) {
    this.queue = queue;
    this.client = client;
  }

  /**
   * Process pending items from the sync queue.
   *
   * 1. Releases stale 'processing' items (crash recovery).
   * 2. Claims a batch of pending items atomically.
   * 3. Processes each item (upload or delete).
   * 4. Marks items as completed, failed, or permanently failed.
   *
   * On 409 (already exists / already deleted): treated as success.
   * On 413 (quota exceeded): stops processing entirely.
   * On other failure: increments retry count with exponential backoff.
   * After max retries: marks as permanently failed.
   */
  async processQueue(batchSize: number = DEFAULT_BATCH_SIZE): Promise<QueueProcessResult> {
    // Crash recovery: release items stuck in 'processing' from dead processes
    this.queue.releaseStale(STALE_THRESHOLD_SECONDS);

    const items = this.queue.claimBatch(batchSize);
    let uploaded = 0;
    let deleted = 0;
    let failed = 0;
    let quotaExceeded = false;

    for (const item of items) {
      try {
        const response = item.operation === 'upload'
          ? await this.processUpload(item)
          : await this.processDelete(item);

        if (response.ok || response.status === 201) {
          this.queue.complete(item.id);
          if (item.operation === 'upload') uploaded++;
          else deleted++;
        } else if (response.status === 409) {
          // Already exists (upload) or already deleted — idempotent success
          this.queue.complete(item.id);
          if (item.operation === 'upload') uploaded++;
          else deleted++;
        } else if (response.status === 413) {
          // Quota exceeded — stop processing, release this item back
          this.queue.fail(item.id, 'Quota exceeded (HTTP 413)');
          quotaExceeded = true;
          break;
        } else {
          this.failItem(item, `HTTP ${response.status}`);
          failed++;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.failItem(item, message);
        failed++;
      }
    }

    return { uploaded, deleted, failed, quotaExceeded };
  }

  private async processUpload(item: SyncQueueItem): Promise<Response> {
    if (!item.data) {
      throw new Error(`Upload item ${item.blobId} has no data`);
    }
    return this.client.put(`/v1/blobs/${item.blobId}`, item.data);
  }

  private async processDelete(item: SyncQueueItem): Promise<Response> {
    return this.client.delete(`/v1/blobs/${item.blobId}`);
  }

  private failItem(item: SyncQueueItem, error: string): void {
    if (item.retryCount + 1 >= item.maxRetries) {
      this.queue.permanentFail(item.id, error);
    } else {
      this.queue.fail(item.id, error);
    }
  }
}
