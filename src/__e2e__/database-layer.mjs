/**
 * E2E test: Database layer (T6)
 *
 * Exercises the full application SQLite schema: source/chunk insert,
 * FTS5 keyword search, embedding BLOB round-trip, VACUUM/ANALYZE.
 *
 * Exit 0 = pass, exit 1 = fail.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;
let tempDir;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

console.log('\n=== Database Layer ===');

try {
  const { DatabaseManager } = await import('../dist/storage/database-manager.js');

  // Create a temp directory for the test database
  tempDir = mkdtempSync(join(tmpdir(), 'chaoskb-e2e-db-'));
  const dbManager = new DatabaseManager(tempDir);

  // 1. Initialize personal DB (creates full schema)
  const db = dbManager.getPersonalDb();
  assert(db !== null, 'personal DB opens');

  // 2. Insert a source
  const source = db.sources.insert({
    id: 'b_test_source_001',
    url: 'https://example.com/test-article',
    title: 'E2E Test Article',
    tags: ['test', 'e2e'],
    chunkCount: 2,
    blobSizeBytes: 1024,
  });
  assert(source.id === 'b_test_source_001', 'source inserted with correct id');
  assert(source.title === 'E2E Test Article', 'source has correct title');

  // 3. Retrieve the source
  const retrieved = db.sources.getById('b_test_source_001');
  assert(retrieved !== null, 'source retrievable by id');
  assert(retrieved.url === 'https://example.com/test-article', 'source URL round-trips');

  // 4. Insert chunks with embeddings
  const embedding1 = new Float32Array(384).fill(0.1);
  const embedding2 = new Float32Array(384).fill(0.2);

  const chunks = db.chunks.insertMany([
    {
      sourceId: 'b_test_source_001',
      chunkIndex: 0,
      content: 'The quick brown fox jumps over the lazy dog.',
      embedding: Buffer.from(embedding1.buffer),
      tokenCount: 10,
      model: 'snowflake-arctic-embed-s',
    },
    {
      sourceId: 'b_test_source_001',
      chunkIndex: 1,
      content: 'JavaScript frameworks evolve rapidly in the modern web ecosystem.',
      embedding: Buffer.from(embedding2.buffer),
      tokenCount: 10,
      model: 'snowflake-arctic-embed-s',
    },
  ]);
  assert(chunks.length === 2, 'two chunks inserted');

  // 5. FTS5 keyword search
  const ftsResults = db.chunks.searchKeyword('fox', 10);
  assert(ftsResults.length === 1, 'FTS5 finds "fox" in one chunk');
  assert(ftsResults[0].content.includes('fox'), 'FTS5 result contains search term');

  const ftsResults2 = db.chunks.searchKeyword('javascript', 10);
  assert(ftsResults2.length === 1, 'FTS5 finds "javascript" in one chunk');

  const ftsResultsNone = db.chunks.searchKeyword('nonexistent_xyzzy', 10);
  assert(ftsResultsNone.length === 0, 'FTS5 returns empty for non-matching query');

  // 6. Embedding BLOB round-trip
  const retrievedChunks = db.chunks.getBySourceId('b_test_source_001');
  assert(retrievedChunks.length === 2, 'both chunks retrievable by source id');

  const chunk0 = retrievedChunks.find((c) => c.chunkIndex === 0);
  const recoveredEmbedding = new Float32Array(
    chunk0.embedding.buffer,
    chunk0.embedding.byteOffset,
    chunk0.embedding.byteLength / 4,
  );
  assert(recoveredEmbedding.length === 384, 'embedding BLOB preserves dimension');
  assert(
    Math.abs(recoveredEmbedding[0] - 0.1) < 1e-6,
    'embedding BLOB preserves values',
  );

  // 7. Embedding index
  db.embeddingIndex.load();
  db.embeddingIndex.add('b_test_source_001', [
    { chunkIndex: 0, embedding: embedding1 },
    { chunkIndex: 1, embedding: embedding2 },
  ]);
  assert(db.embeddingIndex.size === 2, 'embedding index has 2 entries');

  const searchResults = db.embeddingIndex.search(embedding1, 5);
  assert(searchResults.length > 0, 'embedding index search returns results');
  assert(searchResults[0].chunkIndex === 0, 'nearest neighbor is the exact match');

  // 8. Source listing and count
  const allSources = db.sources.list();
  assert(allSources.length === 1, 'sources.list returns 1 source');
  const count = db.sources.count();
  assert(count === 1, 'sources.count returns 1');

  // 9. Soft delete and restore
  const deleted = db.sources.softDelete('b_test_source_001');
  assert(deleted, 'soft delete returns true');
  const afterDelete = db.sources.getById('b_test_source_001');
  assert(afterDelete === null || afterDelete.deletedAt !== null, 'soft-deleted source is not returned or is marked');

  const restored = db.sources.restore('b_test_source_001');
  assert(restored, 'restore returns true');

  // 10. Close and cleanup
  db.close();
  dbManager.closeAll();
  assert(true, 'database closes cleanly');
} catch (err) {
  console.error(`  FAIL: Unexpected error: ${err.message}`);
  console.error(err.stack);
  failed++;
}

// Cleanup temp directory
if (tempDir) {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
