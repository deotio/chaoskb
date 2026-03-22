import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKbList } from '../../tools/kb-list.js';
import { createMockDeps } from '../mcp-server.test.js';
import type { McpDependencies } from '../../mcp-server.js';

describe('kb-list handler', () => {
  let deps: McpDependencies;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('should list sources with pagination', async () => {
    const mockSources = [
      {
        id: 'src1',
        url: 'https://example.com/1',
        title: 'Article One',
        tags: ['ai'],
        chunkCount: 3,
        blobSizeBytes: 1000,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        lastAccessedAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'src2',
        url: 'https://example.com/2',
        title: 'Article Two',
        tags: ['research'],
        chunkCount: 5,
        blobSizeBytes: 2000,
        createdAt: '2026-03-02T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
        lastAccessedAt: '2026-03-02T00:00:00Z',
      },
    ];

    vi.mocked(deps.db.sources.list).mockReturnValue(mockSources);
    vi.mocked(deps.db.sources.count).mockReturnValue(10);

    const result = await handleKbList({ limit: 2, offset: 0 }, deps);

    expect(result.sources).toHaveLength(2);
    expect(result.total).toBe(10);
    expect(result.sources[0]).toEqual({
      id: 'src1',
      title: 'Article One',
      url: 'https://example.com/1',
      tags: ['ai'],
      chunkCount: 3,
      createdAt: '2026-03-01T00:00:00Z',
    });

    expect(deps.db.sources.list).toHaveBeenCalledWith(
      { tags: undefined, includeDeleted: false },
      { limit: 2, offset: 0 },
    );
  });

  it('should filter by tags', async () => {
    vi.mocked(deps.db.sources.list).mockReturnValue([]);
    vi.mocked(deps.db.sources.count).mockReturnValue(0);

    await handleKbList({ tags: ['ai', 'research'] }, deps);

    expect(deps.db.sources.list).toHaveBeenCalledWith(
      { tags: ['ai', 'research'], includeDeleted: false },
      { limit: 20, offset: 0 },
    );
  });

  it('should use default limit and offset', async () => {
    vi.mocked(deps.db.sources.list).mockReturnValue([]);
    vi.mocked(deps.db.sources.count).mockReturnValue(0);

    await handleKbList({}, deps);

    expect(deps.db.sources.list).toHaveBeenCalledWith(
      { tags: undefined, includeDeleted: false },
      { limit: 20, offset: 0 },
    );
  });

  it('should support offset-based pagination', async () => {
    vi.mocked(deps.db.sources.list).mockReturnValue([]);
    vi.mocked(deps.db.sources.count).mockReturnValue(50);

    const result = await handleKbList({ limit: 10, offset: 20 }, deps);

    expect(deps.db.sources.list).toHaveBeenCalledWith(
      { tags: undefined, includeDeleted: false },
      { limit: 10, offset: 20 },
    );
    expect(result.total).toBe(50);
  });
});
