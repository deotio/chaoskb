import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UploadQueue } from '../upload-queue.js';
import type { ISyncHttpClient } from '../types.js';

function createMockClient(
  putResponses?: Map<string, { status: number; body?: unknown }>,
): ISyncHttpClient {
  return {
    get: vi.fn(),
    put: vi.fn().mockImplementation(async (path: string) => {
      if (putResponses) {
        for (const [key, value] of putResponses) {
          if (path.includes(key)) {
            return {
              ok: value.status >= 200 && value.status < 300,
              status: value.status,
              json: () => Promise.resolve(value.body),
            } as unknown as Response;
          }
        }
      }
      return { ok: true, status: 201 } as unknown as Response;
    }),
    delete: vi.fn(),
    post: vi.fn(),
  };
}

describe('UploadQueue', () => {
  const testDir = join(tmpdir(), `chaoskb-queue-test-${Date.now()}`);
  const queuePath = join(testDir, 'upload-queue.json');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should enqueue and process items', async () => {
    const client = createMockClient();
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_1', new Uint8Array([1, 2, 3]));
    await queue.enqueue('b_2', new Uint8Array([4, 5, 6]));

    expect(queue.getPendingCount()).toBe(2);

    const result = await queue.processQueue();

    expect(result.uploaded).toBe(2);
    expect(result.failed).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('should persist queue to disk', async () => {
    const client = createMockClient();
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_persist', new Uint8Array([10, 20]));

    expect(existsSync(queuePath)).toBe(true);
    const raw = readFileSync(queuePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].blobId).toBe('b_persist');
  });

  it('should load queue from disk on construction', async () => {
    const client = createMockClient();

    // First instance: enqueue
    const queue1 = new UploadQueue(client, queuePath);
    await queue1.enqueue('b_loaded', new Uint8Array([30]));

    // Second instance: should see the item
    const queue2 = new UploadQueue(client, queuePath);
    expect(queue2.getPendingCount()).toBe(1);
  });

  it('should retry on failure and increment retryCount', async () => {
    const client = createMockClient(
      new Map([['b_flaky', { status: 500, body: { error: 'internal' } }]]),
    );
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_flaky', new Uint8Array([1]));

    const result = await queue.processQueue();

    expect(result.failed).toBe(1);
    expect(queue.getPendingCount()).toBe(1);

    const items = queue.getItems();
    expect(items[0].retryCount).toBe(1);
  });

  it('should handle 409 conflict as idempotent success', async () => {
    const client = createMockClient(
      new Map([['b_exists', { status: 409, body: { error: 'blob_exists' } }]]),
    );
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_exists', new Uint8Array([1]));
    const result = await queue.processQueue();

    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
  });

  it('should stop processing on 413 quota exceeded', async () => {
    const putFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 413 });

    const client: ISyncHttpClient = {
      get: vi.fn(),
      put: putFn,
      delete: vi.fn(),
      post: vi.fn(),
    };

    const queue = new UploadQueue(client, queuePath);
    await queue.enqueue('b_ok', new Uint8Array([1]));
    await queue.enqueue('b_quota', new Uint8Array([2]));
    await queue.enqueue('b_remaining', new Uint8Array([3]));

    const result = await queue.processQueue();

    expect(result.uploaded).toBe(1);
    // b_quota stays in queue, b_remaining stays in queue
    expect(queue.getPendingCount()).toBe(2);
    // b_remaining was never attempted
    expect(putFn).toHaveBeenCalledTimes(2);
  });

  it('should mark items as failed after max retries', async () => {
    const client = createMockClient(
      new Map([['b_hopeless', { status: 500, body: null }]]),
    );
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_hopeless', new Uint8Array([1]));

    // Process 5 times to exhaust retries
    for (let i = 0; i < 5; i++) {
      await queue.processQueue();
    }

    // On the 6th attempt, retryCount >= 5, so it's marked failed
    const result = await queue.processQueue();
    expect(result.failed).toBe(1);

    const items = queue.getItems();
    expect(items[0].error).toBe('Max retries exceeded');
  });

  it('should replace existing entry for same blobId', async () => {
    const client = createMockClient();
    const queue = new UploadQueue(client, queuePath);

    await queue.enqueue('b_dup', new Uint8Array([1]));
    await queue.enqueue('b_dup', new Uint8Array([2]));

    expect(queue.getPendingCount()).toBe(1);
  });
});
