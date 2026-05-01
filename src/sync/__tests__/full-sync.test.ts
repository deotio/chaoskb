import { describe, it, expect, vi } from 'vitest';
import { fullSync } from '../full-sync.js';
import type { ISyncHttpClient, SyncState } from '../types.js';
import type { IDatabase } from '../../storage/types.js';
import { SyncStatus } from '../../storage/types.js';

function createMockStorage(): IDatabase {
  return {
    sources: {} as IDatabase['sources'],
    chunks: {} as IDatabase['chunks'],
    embeddingIndex: {} as IDatabase['embeddingIndex'],
    syncStatus: {
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
      getPending: vi.fn().mockReturnValue([]),
      getByStatus: vi.fn().mockReturnValue([]),
    },
    close: vi.fn(),
  };
}

function createState(overrides?: Partial<SyncState>): SyncState {
  return {
    fullSyncInProgress: false,
    ...overrides,
  };
}

describe('fullSync', () => {
  it('should download blobs from a single page', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            blobs: [
              { id: 'b_1', size: 100, ts: '2026-03-20T10:00:00Z' },
              { id: 'b_2', size: 200, ts: '2026-03-20T10:00:01Z' },
            ],
            // No cursor means last page
          }),
        })
        // Individual blob downloads
        .mockResolvedValueOnce({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)),
        })
        // Empty second page (end of pagination)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ blobs: [] }),
        }),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(),
    };

    const storage = createMockStorage();
    const state = createState();

    const result = await fullSync(client, storage, state);

    expect(result.newBlobs).toBe(2);
    expect(result.success).toBe(true);
    expect(state.fullSyncInProgress).toBe(false);
    expect(state.fullSyncCursor).toBeUndefined();
    expect(state.lastSyncTimestamp).toBeDefined();
    expect(storage.syncStatus.set).toHaveBeenCalledWith('b_1', SyncStatus.Synced);
    expect(storage.syncStatus.set).toHaveBeenCalledWith('b_2', SyncStatus.Synced);
  });

  it('should handle multi-page pagination', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn()
        // Page 1
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            blobs: [{ id: 'b_1', size: 100, ts: '2026-03-20T10:00:00Z' }],
            cursor: 'page2cursor',
          }),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        })
        // Page 2
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            blobs: [{ id: 'b_2', size: 200, ts: '2026-03-20T10:00:01Z' }],
            // No cursor — last page
          }),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(200)),
        })
        // Empty final page
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ blobs: [] }),
        }),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(),
    };

    const storage = createMockStorage();
    const state = createState();

    const result = await fullSync(client, storage, state);

    expect(result.newBlobs).toBe(2);
    expect(result.success).toBe(true);

    // Verify second page used cursor
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('cursor=page2cursor'),
    );
  });

  it('should resume from cursor', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn()
        // Resumed page (from saved cursor)
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({
            blobs: [{ id: 'b_3', size: 300, ts: '2026-03-20T10:00:02Z' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(300)),
        })
        // Empty last page
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ blobs: [] }),
        }),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(),
    };

    const storage = createMockStorage();
    const state = createState({
      fullSyncInProgress: true,
      fullSyncCursor: 'saved_cursor_abc',
    });

    const result = await fullSync(client, storage, state);

    expect(result.newBlobs).toBe(1);
    expect(client.get).toHaveBeenCalledWith(
      expect.stringContaining('cursor=saved_cursor_abc'),
    );
    expect(state.fullSyncInProgress).toBe(false);
  });

  it('should handle list failure', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn().mockResolvedValueOnce({
        ok: false, status: 503,
      }),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn(),
    };

    const storage = createMockStorage();
    const state = createState();

    const result = await fullSync(client, storage, state);

    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe('LIST_FAILED');
  });
});
