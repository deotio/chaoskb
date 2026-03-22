import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKbDelete } from '../../tools/kb-delete.js';
import { createMockDeps } from '../mcp-server.test.js';
import type { McpDependencies } from '../../mcp-server.js';
import { SyncStatus } from '../../../storage/types.js';

describe('kb-delete handler', () => {
  let deps: McpDependencies;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('should successfully soft-delete a source', async () => {
    vi.mocked(deps.db.sources.getById).mockReturnValue({
      id: 'src1',
      url: 'https://example.com/1',
      title: 'Test Article',
      tags: [],
      chunkCount: 2,
      blobSizeBytes: 1000,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      lastAccessedAt: '2026-03-01T00:00:00Z',
    });
    vi.mocked(deps.db.sources.softDelete).mockReturnValue(true);
    vi.mocked(deps.db.chunks.getBySourceId).mockReturnValue([
      {
        id: 'chunk1',
        sourceId: 'src1',
        chunkIndex: 0,
        content: 'chunk content',
        embedding: new Float32Array(384),
        tokenCount: 2,
        model: 'snowflake-arctic-embed-s@384',
      },
    ]);

    const result = await handleKbDelete({ id: 'src1' }, deps);

    expect(result).toEqual({ id: 'src1', deleted: true });
    expect(deps.db.sources.softDelete).toHaveBeenCalledWith('src1');
    expect(deps.db.embeddingIndex.remove).toHaveBeenCalledWith('src1');
    expect(deps.db.syncStatus.set).toHaveBeenCalledWith('src1', SyncStatus.PendingDelete);
    expect(deps.db.syncStatus.set).toHaveBeenCalledWith('chunk1', SyncStatus.PendingDelete);
  });

  it('should throw when source is not found', async () => {
    vi.mocked(deps.db.sources.getById).mockReturnValue(null);

    await expect(
      handleKbDelete({ id: 'nonexistent' }, deps),
    ).rejects.toThrow('Source not found: nonexistent');
  });

  it('should throw when source is already deleted', async () => {
    vi.mocked(deps.db.sources.getById).mockReturnValue({
      id: 'src1',
      url: 'https://example.com/1',
      title: 'Deleted Article',
      tags: [],
      chunkCount: 1,
      blobSizeBytes: 500,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      lastAccessedAt: '2026-03-01T00:00:00Z',
      deletedAt: '2026-03-15T00:00:00Z',
    });

    await expect(
      handleKbDelete({ id: 'src1' }, deps),
    ).rejects.toThrow('Source already deleted: src1');
  });
});
