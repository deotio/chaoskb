/**
 * E2E test: Native module loading and correctness (T1/T4)
 *
 * Verifies that all three native modules install their platform-specific
 * prebuilts correctly and produce correct output.
 *
 * Exit 0 = pass, exit 1 = fail.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// --- sodium-native ---
console.log('\n=== sodium-native ===');
try {
  const sodium = require('sodium-native');

  // Random bytes generation
  const buf = Buffer.alloc(32);
  sodium.randombytes_buf(buf);
  assert(buf.length === 32, 'randombytes_buf produces 32 bytes');
  assert(!buf.every((b) => b === 0), 'randombytes_buf produces non-zero output');

  // Deterministic hash
  const out1 = Buffer.alloc(sodium.crypto_generichash_BYTES);
  const out2 = Buffer.alloc(sodium.crypto_generichash_BYTES);
  const input = Buffer.from('chaoskb-e2e-test');
  sodium.crypto_generichash(out1, input);
  sodium.crypto_generichash(out2, input);
  assert(out1.equals(out2), 'crypto_generichash is deterministic');
  assert(out1.length === 32, 'crypto_generichash produces 32 bytes');

  // Argon2id key derivation (the actual path used in setup)
  const password = Buffer.from('test-passphrase-e2e');
  const salt = Buffer.alloc(sodium.crypto_pwhash_SALTBYTES);
  sodium.randombytes_buf(salt);
  const key = Buffer.alloc(32);
  sodium.crypto_pwhash(
    key,
    password,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_MIN,
    sodium.crypto_pwhash_MEMLIMIT_MIN,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  assert(key.length === 32, 'Argon2id derives a 32-byte key');
  assert(!key.every((b) => b === 0), 'Argon2id output is non-zero');
} catch (err) {
  console.error(`  FAIL: sodium-native load/usage error: ${err.message}`);
  failed++;
}

// --- better-sqlite3 ---
console.log('\n=== better-sqlite3 ===');
try {
  const Database = require('better-sqlite3');

  // Basic open + query
  const db = new Database(':memory:');
  assert(db !== null, 'opens in-memory database');

  // WAL mode (used by the app) — requires a file-backed database
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const walDir = mkdtempSync(join(tmpdir(), 'chaoskb-e2e-wal-'));
  const walDb = new Database(join(walDir, 'test.db'));
  const walResult = walDb.pragma('journal_mode=WAL');
  assert(walResult[0].journal_mode === 'wal', 'WAL mode enabled');
  walDb.close();
  rmSync(walDir, { recursive: true, force: true });

  // Table round-trip
  db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, data TEXT)');
  db.prepare('INSERT INTO test (data) VALUES (?)').run('hello-e2e');
  const row = db.prepare('SELECT data FROM test WHERE id = 1').get();
  assert(row.data === 'hello-e2e', 'INSERT/SELECT round-trip works');

  // FTS5 virtual table (used for keyword search)
  db.exec(`
    CREATE VIRTUAL TABLE test_fts USING fts5(content);
    INSERT INTO test_fts (content) VALUES ('the quick brown fox');
    INSERT INTO test_fts (content) VALUES ('lazy dog sleeps');
  `);
  const ftsResults = db
    .prepare("SELECT * FROM test_fts WHERE test_fts MATCH 'fox'")
    .all();
  assert(ftsResults.length === 1, 'FTS5 match query returns correct result');
  assert(ftsResults[0].content === 'the quick brown fox', 'FTS5 returns correct row');

  // BLOB round-trip (embedding vectors are stored as BLOBs)
  db.exec('CREATE TABLE vectors (id INTEGER PRIMARY KEY, vec BLOB)');
  const vec = new Float32Array([1.0, 2.0, 3.0, 4.0]);
  const vecBuf = Buffer.from(vec.buffer);
  db.prepare('INSERT INTO vectors (vec) VALUES (?)').run(vecBuf);
  const vecRow = db.prepare('SELECT vec FROM vectors WHERE id = 1').get();
  const recovered = new Float32Array(
    vecRow.vec.buffer,
    vecRow.vec.byteOffset,
    vecRow.vec.byteLength / 4,
  );
  assert(recovered.length === 4, 'BLOB round-trip preserves length');
  assert(recovered[0] === 1.0 && recovered[3] === 4.0, 'BLOB round-trip preserves values');

  db.close();
} catch (err) {
  console.error(`  FAIL: better-sqlite3 load/usage error: ${err.message}`);
  failed++;
}

// --- onnxruntime-node ---
console.log('\n=== onnxruntime-node ===');
try {
  const ort = await import('onnxruntime-node');
  assert(ort.InferenceSession !== undefined, 'InferenceSession is available');
  assert(typeof ort.InferenceSession.create === 'function', 'InferenceSession.create is a function');
  assert(ort.Tensor !== undefined, 'Tensor class is available');

  // Check if the model is cached (don't fail if not — the workflow caches it)
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');
  const { existsSync } = await import('node:fs');

  const modelPath = join(homedir(), '.chaoskb', 'models', 'model.onnx');
  const vocabPath = join(homedir(), '.chaoskb', 'models', 'vocab.txt');

  if (existsSync(modelPath) && existsSync(vocabPath)) {
    console.log('  Model found — running full inference test');

    // Use the app's own Embedder for the full inference test
    const { Embedder } = await import('../dist/pipeline/embedder.js');
    const embedder = new Embedder(modelPath, vocabPath);

    const embDog = await embedder.embed('dog');
    const embPuppy = await embedder.embed('puppy');
    const embJs = await embedder.embed('javascript framework');

    assert(embDog.length === 384, 'embedding dimension is 384');

    // Cosine similarity
    function cosine(a, b) {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    const simDogPuppy = cosine(embDog, embPuppy);
    const simDogJs = cosine(embDog, embJs);

    console.log(`  similarity(dog, puppy) = ${simDogPuppy.toFixed(4)}`);
    console.log(`  similarity(dog, js)    = ${simDogJs.toFixed(4)}`);

    assert(
      simDogPuppy > simDogJs,
      `semantic similarity: dog/puppy (${simDogPuppy.toFixed(4)}) > dog/js (${simDogJs.toFixed(4)})`,
    );

    embedder.dispose();
  } else {
    console.log('  Model not cached — skipping full inference (module binding verified)');
  }
} catch (err) {
  console.error(`  FAIL: onnxruntime-node load/usage error: ${err.message}`);
  failed++;
}

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
