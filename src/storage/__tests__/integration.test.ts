import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { KBDatabase } from '../kb-database.js';
import { SyncStatus } from '../types.js';

describe('Storage Integration', () => {
  let tmpDir: string;
  let db: KBDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaoskb-integration-test-'));
    db = new KBDatabase({ path: path.join(tmpDir, 'test.db') });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should support full lifecycle: insert source + chunks, search, soft delete, restore', () => {
    // 1. Insert a source
    const source = db.sources.insert({
      id: 'src1',
      url: 'https://example.com/article',
      title: 'Test Article',
      tags: ['test', 'integration'],
      chunkCount: 3,
      blobSizeBytes: 1024,
    });

    expect(source.id).toBe('src1');
    expect(source.createdAt).toBeDefined();

    // 2. Insert chunks with embeddings
    const embeddings = [
      new Float32Array([1.0, 0.0, 0.0]),
      new Float32Array([0.0, 1.0, 0.0]),
      new Float32Array([0.7, 0.7, 0.0]),
    ];

    const chunks = db.chunks.insertMany([
      {
        sourceId: 'src1',
        chunkIndex: 0,
        content: 'First paragraph about JavaScript',
        embedding: embeddings[0],
        tokenCount: 5,
        model: 'test-model',
      },
      {
        sourceId: 'src1',
        chunkIndex: 1,
        content: 'Second paragraph about Python',
        embedding: embeddings[1],
        tokenCount: 5,
        model: 'test-model',
      },
      {
        sourceId: 'src1',
        chunkIndex: 2,
        content: 'Third paragraph about both',
        embedding: embeddings[2],
        tokenCount: 5,
        model: 'test-model',
      },
    ]);

    expect(chunks).toHaveLength(3);

    // 3. Load embeddings into the index
    db.embeddingIndex.load();
    expect(db.embeddingIndex.size).toBe(3);

    // 4. Search — query similar to first chunk
    const searchResults = db.embeddingIndex.search(new Float32Array([1.0, 0.0, 0.0]), 3);
    expect(searchResults).toHaveLength(3);
    expect(searchResults[0].sourceId).toBe('src1');
    expect(searchResults[0].chunkIndex).toBe(0);
    expect(searchResults[0].score).toBeCloseTo(1.0, 5);
    // Third chunk (0.7, 0.7, 0) should be second most similar to (1, 0, 0)
    expect(searchResults[1].chunkIndex).toBe(2);

    // 5. Verify we can retrieve chunks and embeddings survive round-trip
    const retrievedChunks = db.chunks.getBySourceId('src1');
    expect(retrievedChunks).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const original = embeddings[i];
      const retrieved = retrievedChunks[i].embedding;
      expect(retrieved.length).toBe(original.length);
      for (let j = 0; j < original.length; j++) {
        expect(retrieved[j]).toBeCloseTo(original[j], 5);
      }
    }

    // 6. Soft delete the source
    const deleted = db.sources.softDelete('src1');
    expect(deleted).toBe(true);

    // Verify it's not in the default listing
    const listedAfterDelete = db.sources.list();
    expect(listedAfterDelete).toHaveLength(0);

    // But still in the DB with includeDeleted
    const allSources = db.sources.list({ includeDeleted: true });
    expect(allSources).toHaveLength(1);
    expect(allSources[0].deletedAt).toBeDefined();

    // 7. Remove from embedding index
    db.embeddingIndex.remove('src1');
    const searchAfterDelete = db.embeddingIndex.search(new Float32Array([1.0, 0.0, 0.0]), 3);
    expect(searchAfterDelete).toHaveLength(0);

    // 8. Restore the source
    const restored = db.sources.restore('src1');
    expect(restored).toBe(true);

    const restoredSource = db.sources.getById('src1');
    expect(restoredSource!.deletedAt).toBeUndefined();

    // 9. Re-add to embedding index
    db.embeddingIndex.load();
    expect(db.embeddingIndex.size).toBe(3);

    const searchAfterRestore = db.embeddingIndex.search(new Float32Array([1.0, 0.0, 0.0]), 1);
    expect(searchAfterRestore).toHaveLength(1);
    expect(searchAfterRestore[0].score).toBeCloseTo(1.0, 5);
  });

  it('should support multiple sources with separate embeddings', () => {
    // Insert two sources
    db.sources.insert({
      id: 'src-js',
      url: 'https://example.com/js',
      title: 'JavaScript Guide',
      tags: ['javascript'],
      chunkCount: 1,
      blobSizeBytes: 100,
    });

    db.sources.insert({
      id: 'src-py',
      url: 'https://example.com/py',
      title: 'Python Guide',
      tags: ['python'],
      chunkCount: 1,
      blobSizeBytes: 100,
    });

    db.chunks.insertMany([
      {
        sourceId: 'src-js',
        chunkIndex: 0,
        content: 'JavaScript content',
        embedding: new Float32Array([1, 0]),
        tokenCount: 2,
        model: 'model',
      },
      {
        sourceId: 'src-py',
        chunkIndex: 0,
        content: 'Python content',
        embedding: new Float32Array([0, 1]),
        tokenCount: 2,
        model: 'model',
      },
    ]);

    db.embeddingIndex.load();
    expect(db.embeddingIndex.size).toBe(2);

    // Search for JS-like content
    const jsResults = db.embeddingIndex.search(new Float32Array([1, 0]), 1);
    expect(jsResults[0].sourceId).toBe('src-js');

    // Delete JS chunks
    const deleteCount = db.chunks.deleteBySourceId('src-js');
    expect(deleteCount).toBe(1);
    db.embeddingIndex.remove('src-js');

    // Only Python should remain
    expect(db.embeddingIndex.size).toBe(1);
    const remaining = db.embeddingIndex.search(new Float32Array([1, 0]), 1);
    expect(remaining[0].sourceId).toBe('src-py');
  });

  it('should handle sync status alongside source operations', () => {
    db.sources.insert({
      id: 'src1',
      url: 'https://example.com',
      title: 'Test',
      tags: [],
      chunkCount: 0,
      blobSizeBytes: 100,
    });

    // Set sync status
    db.syncStatus.set('src1', SyncStatus.LocalOnly);

    const status = db.syncStatus.get('src1');
    expect(status!.status).toBe(SyncStatus.LocalOnly);

    // Mark as synced
    db.syncStatus.set('src1', SyncStatus.Synced);
    expect(db.syncStatus.get('src1')!.status).toBe(SyncStatus.Synced);

    // Pending should be empty
    expect(db.syncStatus.getPending()).toHaveLength(0);
  });

  it('should support filtering sources by tags', () => {
    db.sources.insert({
      id: 'src1',
      url: 'https://example.com/1',
      title: 'JS Tutorial',
      tags: ['javascript', 'tutorial'],
      chunkCount: 0,
      blobSizeBytes: 0,
    });

    db.sources.insert({
      id: 'src2',
      url: 'https://example.com/2',
      title: 'Python Tutorial',
      tags: ['python', 'tutorial'],
      chunkCount: 0,
      blobSizeBytes: 0,
    });

    db.sources.insert({
      id: 'src3',
      url: 'https://example.com/3',
      title: 'JS Reference',
      tags: ['javascript', 'reference'],
      chunkCount: 0,
      blobSizeBytes: 0,
    });

    // Filter by single tag
    const tutorials = db.sources.list({ tags: ['tutorial'] });
    expect(tutorials).toHaveLength(2);

    // Filter by two tags
    const jsTutorials = db.sources.list({ tags: ['javascript', 'tutorial'] });
    expect(jsTutorials).toHaveLength(1);
    expect(jsTutorials[0].id).toBe('src1');

    // Filter by title search
    const jsStuff = db.sources.list({ titleSearch: 'JS' });
    expect(jsStuff).toHaveLength(2);

    // Count
    expect(db.sources.count({ tags: ['javascript'] })).toBe(2);
  });

  it('should update last accessed timestamp', () => {
    db.sources.insert({
      id: 'src1',
      url: 'https://example.com',
      title: 'Test',
      tags: [],
      chunkCount: 0,
      blobSizeBytes: 0,
    });

    const before = db.sources.getById('src1')!.lastAccessedAt;
    db.sources.updateLastAccessed('src1');
    const after = db.sources.getById('src1')!.lastAccessedAt;

    expect(after >= before).toBe(true);
  });
});
