import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleKbIngest } from '../../tools/kb-ingest.js';
import { createMockDeps } from '../mcp-server.test.js';
import type { McpDependencies } from '../../mcp-server.js';

describe('kb-ingest handler', () => {
  let deps: McpDependencies;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('should successfully ingest a URL', async () => {
    const mockExtracted = {
      title: 'Test Article',
      content: 'This is test content for the article.',
      url: 'https://example.com/article',
      byteLength: 39,
    };

    const mockChunks = [
      { content: 'This is test content', index: 0, tokenCount: 5, byteOffset: 0 },
    ];

    const mockEmbeddedChunks = [
      {
        content: 'This is test content',
        index: 0,
        tokenCount: 5,
        byteOffset: 0,
        embedding: new Float32Array(384),
        model: 'snowflake-arctic-embed-s@384',
      },
    ];

    vi.mocked(deps.pipeline.fetchAndExtract).mockResolvedValue(mockExtracted);
    vi.mocked(deps.pipeline.chunk).mockReturnValue(mockChunks);
    vi.mocked(deps.pipeline.embedChunks).mockResolvedValue(mockEmbeddedChunks);

    let blobIdCounter = 0;
    vi.mocked(deps.encryption.generateBlobId).mockImplementation(
      () => `b_blob${blobIdCounter++}`,
    );

    const result = await handleKbIngest(
      { url: 'https://example.com/article' },
      deps,
    );

    expect(result.title).toBe('Test Article');
    expect(result.url).toBe('https://example.com/article');
    expect(result.chunkCount).toBe(1);
    expect(result.blobIds).toHaveLength(2); // source + 1 chunk
    expect(deps.db.sources.insert).toHaveBeenCalledOnce();
    expect(deps.db.chunks.insertMany).toHaveBeenCalledOnce();
    expect(deps.db.embeddingIndex.add).toHaveBeenCalledOnce();
  });

  it('should propagate fetch errors', async () => {
    vi.mocked(deps.pipeline.fetchAndExtract).mockRejectedValue(
      new Error('Failed to fetch URL'),
    );

    await expect(
      handleKbIngest({ url: 'https://bad-url.com' }, deps),
    ).rejects.toThrow('Failed to fetch URL');
  });

  it('should assign tags to the source', async () => {
    vi.mocked(deps.pipeline.fetchAndExtract).mockResolvedValue({
      title: 'Tagged Article',
      content: 'Content',
      url: 'https://example.com/tagged',
      byteLength: 7,
    });
    vi.mocked(deps.pipeline.chunk).mockReturnValue([]);
    vi.mocked(deps.pipeline.embedChunks).mockResolvedValue([]);

    await handleKbIngest(
      { url: 'https://example.com/tagged', tags: ['ai', 'research'] },
      deps,
    );

    expect(deps.db.sources.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['ai', 'research'],
      }),
    );
  });

  it('should enqueue all blobs for sync upload', async () => {
    vi.mocked(deps.pipeline.fetchAndExtract).mockResolvedValue({
      title: 'Test',
      content: 'Content',
      url: 'https://example.com',
      byteLength: 7,
    });
    vi.mocked(deps.pipeline.chunk).mockReturnValue([
      { content: 'c1', index: 0, tokenCount: 1, byteOffset: 0 },
    ]);
    vi.mocked(deps.pipeline.embedChunks).mockResolvedValue([
      {
        content: 'c1',
        index: 0,
        tokenCount: 1,
        byteOffset: 0,
        embedding: new Float32Array(384),
        model: 'snowflake-arctic-embed-s@384',
      },
    ]);

    let blobId = 0;
    vi.mocked(deps.encryption.generateBlobId).mockImplementation(
      () => `b_id${blobId++}`,
    );

    await handleKbIngest({ url: 'https://example.com' }, deps);

    // Should enqueue source + 1 chunk = 2 calls
    expect(deps.db.storeAndEnqueueUpload).toHaveBeenCalledTimes(2);
    expect(deps.db.storeAndEnqueueUpload).toHaveBeenCalledWith('b_id0', expect.any(Uint8Array));
    expect(deps.db.storeAndEnqueueUpload).toHaveBeenCalledWith('b_id1', expect.any(Uint8Array));
  });
});
