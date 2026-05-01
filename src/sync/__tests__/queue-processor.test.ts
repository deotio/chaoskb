import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncQueueProcessor } from '../queue-processor.js';
import type { ISyncQueueRepository, SyncQueueItem } from '../../storage/types.js';
import type { ISyncHttpClient } from '../types.js';

function makeItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 1,
    blobId: 'b_test',
    operation: 'upload',
    data: new Uint8Array([1, 2, 3]),
    retryCount: 0,
    maxRetries: 5,
    status: 'processing',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function createMockQueue(items: SyncQueueItem[] = []): ISyncQueueRepository {
  return {
    enqueue: vi.fn(),
    claimBatch: vi.fn().mockReturnValue(items),
    complete: vi.fn(),
    fail: vi.fn(),
    permanentFail: vi.fn(),
    releaseStale: vi.fn().mockReturnValue(0),
    pendingCount: vi.fn().mockReturnValue(items.length),
  };
}

function createMockClient(
  responses?: Map<string, Response>,
): ISyncHttpClient {
  const defaultResponse = mockResponse(201);
  return {
    get: vi.fn(),
    put: vi.fn().mockImplementation(async (path: string) => {
      if (responses) {
        for (const [key, resp] of responses) {
          if (path.includes(key)) return resp;
        }
      }
      return defaultResponse;
    }),
    delete: vi.fn().mockImplementation(async (path: string) => {
      if (responses) {
        for (const [key, resp] of responses) {
          if (path.includes(key)) return resp;
        }
      }
      return mockResponse(200);
    }),
    post: vi.fn(),
  };
}

describe('SyncQueueProcessor', () => {
  let queue: ISyncQueueRepository;
  let client: ISyncHttpClient;
  let processor: SyncQueueProcessor;

  beforeEach(() => {
    queue = createMockQueue();
    client = createMockClient();
    processor = new SyncQueueProcessor(queue, client);
  });

  it('should release stale items before processing', async () => {
    await processor.processQueue();
    expect(queue.releaseStale).toHaveBeenCalledWith(300);
  });

  it('should process upload items successfully', async () => {
    const item = makeItem({ blobId: 'b_upload' });
    queue = createMockQueue([item]);
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.uploaded).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
    expect(client.put).toHaveBeenCalledWith('/v1/blobs/b_upload', item.data);
    expect(queue.complete).toHaveBeenCalledWith(item.id);
  });

  it('should process delete items successfully', async () => {
    const item = makeItem({ blobId: 'b_del', operation: 'delete', data: null });
    queue = createMockQueue([item]);
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.uploaded).toBe(0);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    expect(client.delete).toHaveBeenCalledWith('/v1/blobs/b_del');
    expect(queue.complete).toHaveBeenCalledWith(item.id);
  });

  it('should handle mixed uploads and deletes', async () => {
    const items = [
      makeItem({ id: 1, blobId: 'b_up', operation: 'upload' }),
      makeItem({ id: 2, blobId: 'b_del', operation: 'delete', data: null }),
      makeItem({ id: 3, blobId: 'b_up2', operation: 'upload' }),
    ];
    queue = createMockQueue(items);
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.uploaded).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('should treat 409 as idempotent success for uploads', async () => {
    const item = makeItem({ blobId: 'b_exists' });
    queue = createMockQueue([item]);
    client = createMockClient(new Map([['b_exists', mockResponse(409)]]));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.uploaded).toBe(1);
    expect(result.failed).toBe(0);
    expect(queue.complete).toHaveBeenCalledWith(item.id);
  });

  it('should treat 409 as idempotent success for deletes', async () => {
    const item = makeItem({ blobId: 'b_gone', operation: 'delete', data: null });
    queue = createMockQueue([item]);
    client = createMockClient(new Map([['b_gone', mockResponse(409)]]));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.deleted).toBe(1);
    expect(queue.complete).toHaveBeenCalledWith(item.id);
  });

  it('should stop processing on 413 quota exceeded', async () => {
    const items = [
      makeItem({ id: 1, blobId: 'b_ok' }),
      makeItem({ id: 2, blobId: 'b_quota' }),
      makeItem({ id: 3, blobId: 'b_never' }),
    ];
    queue = createMockQueue(items);
    client = createMockClient(new Map([['b_quota', mockResponse(413)]]));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.uploaded).toBe(1);
    expect(result.quotaExceeded).toBe(true);
    // b_quota should be failed (not completed), b_never should not be attempted
    expect(queue.fail).toHaveBeenCalledWith(2, 'Quota exceeded (HTTP 413)');
    expect(client.put).toHaveBeenCalledTimes(2); // b_ok + b_quota
  });

  it('should fail item on server error and increment retry', async () => {
    const item = makeItem({ id: 1, blobId: 'b_err', retryCount: 0 });
    queue = createMockQueue([item]);
    client = createMockClient(new Map([['b_err', mockResponse(500)]]));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.failed).toBe(1);
    expect(queue.fail).toHaveBeenCalledWith(1, 'HTTP 500');
  });

  it('should permanently fail item after max retries', async () => {
    const item = makeItem({ id: 1, blobId: 'b_hopeless', retryCount: 4, maxRetries: 5 });
    queue = createMockQueue([item]);
    client = createMockClient(new Map([['b_hopeless', mockResponse(500)]]));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.failed).toBe(1);
    // retryCount (4) + 1 >= maxRetries (5) → permanent fail
    expect(queue.permanentFail).toHaveBeenCalledWith(1, 'HTTP 500');
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it('should handle network errors gracefully', async () => {
    const item = makeItem({ id: 1, blobId: 'b_net' });
    queue = createMockQueue([item]);
    client = createMockClient();
    vi.mocked(client.put).mockRejectedValue(new Error('ECONNREFUSED'));
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.failed).toBe(1);
    expect(queue.fail).toHaveBeenCalledWith(1, 'ECONNREFUSED');
  });

  it('should throw on upload item with no data', async () => {
    const item = makeItem({ id: 1, blobId: 'b_nodata', operation: 'upload', data: null });
    queue = createMockQueue([item]);
    processor = new SyncQueueProcessor(queue, client);

    const result = await processor.processQueue();

    expect(result.failed).toBe(1);
    expect(queue.fail).toHaveBeenCalledWith(1, expect.stringContaining('no data'));
  });

  it('should return zeros when queue is empty', async () => {
    const result = await processor.processQueue();

    expect(result.uploaded).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.quotaExceeded).toBe(false);
  });

  it('should pass batch size to claimBatch', async () => {
    await processor.processQueue(25);
    expect(queue.claimBatch).toHaveBeenCalledWith(25);
  });

  it('should use default batch size of 10', async () => {
    await processor.processQueue();
    expect(queue.claimBatch).toHaveBeenCalledWith(10);
  });
});
