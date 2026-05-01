import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ISyncHttpClient, UploadQueueItem } from './types.js';

/** Maximum number of retries before marking an item as permanently failed. */
const MAX_RETRIES = 5;

/** Serializable form of UploadQueueItem for JSON persistence. */
interface SerializedQueueItem {
  blobId: string;
  /** Base64-encoded blob data */
  data: string;
  retryCount: number;
  lastAttempt?: string;
  error?: string;
}

/**
 * Persistent upload queue for async blob uploads.
 *
 * Items are serialized to a JSON file on disk so uploads survive
 * process restarts. Each mutation (enqueue, dequeue, retry increment)
 * persists the queue immediately.
 */
export class UploadQueue {
  private readonly client: ISyncHttpClient;
  private readonly queuePath: string;
  private items: UploadQueueItem[];

  constructor(client: ISyncHttpClient, queuePath: string) {
    this.client = client;
    this.queuePath = queuePath;
    this.items = [];
    this.loadFromDisk();
  }

  /**
   * Add a blob to the upload queue and persist to disk.
   */
  async enqueue(blobId: string, data: Uint8Array): Promise<void> {
    // Replace existing entry for the same blobId
    this.items = this.items.filter((item) => item.blobId !== blobId);
    this.items.push({
      blobId,
      data: new Uint8Array(data),
      retryCount: 0,
    });
    this.saveToDisk();
  }

  /**
   * Process all queued uploads. Returns counts of successes and failures.
   *
   * - On 409 (already exists): remove from queue (idempotent success).
   * - On 413 (quota exceeded): stop processing entirely.
   * - On other failure: increment retry count; mark sync_failed after MAX_RETRIES.
   */
  async processQueue(): Promise<{ uploaded: number; failed: number }> {
    let uploaded = 0;
    let failed = 0;
    const remaining: UploadQueueItem[] = [];

    for (const item of this.items) {
      if (item.retryCount >= MAX_RETRIES) {
        // Already exceeded max retries — mark as failed and skip
        failed++;
        remaining.push({ ...item, error: 'Max retries exceeded' });
        continue;
      }

      try {
        const response = await this.client.put(`/v1/blobs/${item.blobId}`, item.data);

        if (response.ok || response.status === 201) {
          // Success — do not keep in queue
          uploaded++;
        } else if (response.status === 409) {
          // Already exists — idempotent success
          uploaded++;
        } else if (response.status === 413) {
          // Quota exceeded — stop processing, keep this and remaining items
          remaining.push(item);
          // Push all unprocessed items
          const currentIndex = this.items.indexOf(item);
          for (let i = currentIndex + 1; i < this.items.length; i++) {
            remaining.push(this.items[i]);
          }
          this.items = remaining;
          this.saveToDisk();
          return { uploaded, failed };
        } else {
          // Other failure — retry later
          failed++;
          remaining.push({
            ...item,
            retryCount: item.retryCount + 1,
            lastAttempt: new Date().toISOString(),
            error: `HTTP ${response.status}`,
          });
        }
      } catch (error: unknown) {
        failed++;
        remaining.push({
          ...item,
          retryCount: item.retryCount + 1,
          lastAttempt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.items = remaining;
    this.saveToDisk();
    return { uploaded, failed };
  }

  /**
   * Number of items still in the queue (including failed).
   */
  getPendingCount(): number {
    return this.items.length;
  }

  /**
   * Get all items in the queue (for inspection/testing).
   */
  getItems(): readonly UploadQueueItem[] {
    return this.items;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.queuePath)) {
        this.items = [];
        return;
      }
      const raw = readFileSync(this.queuePath, 'utf-8');
      const serialized = JSON.parse(raw) as SerializedQueueItem[];
      this.items = serialized.map((s) => ({
        blobId: s.blobId,
        data: Uint8Array.from(Buffer.from(s.data, 'base64')),
        retryCount: s.retryCount,
        lastAttempt: s.lastAttempt,
        error: s.error,
      }));
    } catch {
      // Corrupted or missing file — start fresh
      this.items = [];
    }
  }

  private saveToDisk(): void {
    const dir = dirname(this.queuePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const serialized: SerializedQueueItem[] = this.items.map((item) => ({
      blobId: item.blobId,
      data: Buffer.from(item.data).toString('base64'),
      retryCount: item.retryCount,
      lastAttempt: item.lastAttempt,
      error: item.error,
    }));
    writeFileSync(this.queuePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }
}
