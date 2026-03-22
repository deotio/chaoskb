# Client Architecture

## On-Device Embedding

### Model Choice

**Default model:** `snowflake-arctic-embed-s` (384 dimensions, ~134MB ONNX)

Selected for the best retrieval quality among mobile-capable models (MTEB Retrieval ~53.1), matching the size of less capable alternatives.

| Property       | Value                         |
| -------------- | ----------------------------- |
| Dimensions     | 384                           |
| Model size     | ~134 MB (ONNX)               |
| Context length | 512 tokens                   |
| MTEB Retrieval | ~53.1                        |
| Blob size      | ~4.5 KB per chunk            |
| 50k chunks RAM | ~73 MB                       |

### Model Switchability

The design supports switching embedding models. Every chunk blob is tagged with a `model` field (e.g., `snowflake-arctic-embed-s@384`).

Key points:
- Migration re-embeds all chunks from stored plaintext — a client-only operation
- During migration, dual-search across old and new embeddings maintains full results
- Same-dimension swaps (e.g., snowflake → bge-small, both 384) change no storage characteristics
- Cross-dimension swaps (384 → 768) change blob size and memory footprint
- Two migration modes (user's choice):
  - **Laptop** — MCP proxy or CLI runs migration in foreground (~5 min for 5k articles). Phone syncs the results automatically.
  - **Phone (charger required)** — `BGProcessingTask` (iOS) / `WorkManager` (Android) with `requiresCharging: true`. Runs in batches overnight. Progress persisted between wake cycles.

### Runtime

- **Flutter:** `onnxruntime_flutter` to run the ONNX model on-device
- **Desktop (`chaoskb-mcp`):** ONNX Runtime (via `onnxruntime-node`)
- **Tokenizer:** Bundled with the model (WordPiece, ~500KB)

### Embedding Performance (estimates)

| Device         | Chunks/sec | 100 chunks (1 article) |
| -------------- | ---------- | ---------------------- |
| iPhone 14      | ~30-50     | 2-3 seconds            |
| Pixel 7        | ~20-40     | 2-5 seconds            |
| M1 MacBook     | ~100-200   | <1 second              |

Acceptable for single-article ingest. Full re-embedding for model migration:

| Dataset size   | Chunks  | Phone (~50/s) | Laptop (~200/s) |
| -------------- | ------- | ------------- | --------------- |
| 100 articles   | ~1,200  | ~24 seconds   | ~6 seconds      |
| 1,000 articles | ~12,000 | ~4 minutes    | ~1 minute       |
| 5,000 articles | ~60,000 | ~20 minutes   | ~5 minutes      |

## Local Search

With all embeddings in memory, search is a brute-force cosine similarity scan.

```dart
// Pseudocode
List<SearchResult> search(Float32List queryEmbedding, int topK) {
  final scores = chunks.map((c) => (
    chunk: c,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  ));
  scores.sort((a, b) => b.score.compareTo(a.score));
  return scores.take(topK).toList();
}
```

At 50k chunks x 384 dims, this is ~19M multiply-adds — takes <50ms on any modern device. No index needed. HNSW is for millions of vectors; brute force wins at this scale due to zero overhead.

## Local Data Store

Decrypted data lives in an on-device database for fast access:

| Platform | Storage                                    | Encryption |
| -------- | ------------------------------------------ | ---------- |
| iOS      | SQLite via `sqflite` (app sandbox)         | App sandbox provides isolation |
| Android  | SQLite via `sqflite` (app sandbox)         | App sandbox provides isolation |
| Desktop  | `better-sqlite3` file (~/.chaoskb/local.db) | Blobs are encrypted at the application layer before writing to SQLite. File permissions set to `0600` as defense-in-depth. |

**Desktop SQLite encryption:** Desktop uses `better-sqlite3` for local storage. Blobs are encrypted at the application layer before writing to SQLite (the encryption envelope ensures data at rest is ciphertext). File permissions are set to `0600` as defense-in-depth.

```sql
-- On-device SQLite
CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    url TEXT, title TEXT, tags TEXT, -- JSON array
    chunk_count INTEGER,
    blob_size_bytes INTEGER,        -- total encrypted size (source + chunk blobs)
    created_at TEXT, updated_at TEXT,
    last_accessed_at TEXT            -- updated when source appears in search results user views
);

CREATE TABLE chunks (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES sources(id),
    chunk_index INTEGER,
    content TEXT,
    token_count INTEGER,
    model TEXT           -- e.g., 'snowflake-arctic-embed-s@384'
);
-- Embeddings loaded into memory from encrypted server blobs, not stored in SQLite
```

`blob_size_bytes` tracks each source's contribution to the synced storage quota. `last_accessed_at` is updated whenever the user views a search result from this source — enables "never accessed" cleanup filters.

## Offline-First Architecture

**The app is a standalone knowledge base. The server is optional — it provides backup and multi-device sync, nothing more.**

Every operation — ingest, search, delete, export — works without a server connection. The local SQLite database and in-memory embedding index are the source of truth for the device. The server is a remote encrypted mirror that enables backup and cross-device sync when available.

### Design rules

1. **Local-first writes.** Ingest writes to the local database immediately. The article is searchable the moment embedding completes — before any server upload.
2. **Sync is async and best-effort.** Server uploads happen in the background. If the server is unreachable, writes queue locally and sync when connectivity returns.
3. **No server dependency on any read path.** Search, list, and read operations never contact the server. They hit the local database and in-memory index exclusively.
4. **App launches without a server.** First launch, onboarding, account creation — all work in local-only mode. The user can optionally configure a server endpoint later (hosted or self-hosted) to enable backup and sync.
5. **Graceful degradation.** If the server goes offline during use, the only visible change is a "sync paused" indicator. All other functionality continues.
6. **Server shutdown is survivable.** If the server is permanently shut down, the app keeps working with its local data. No feature is lost except backup and multi-device sync.

### State management

```
┌─────────────────────────────────────┐
│ Local SQLite + in-memory embeddings │  ← source of truth for this device
│   (always available)                │
└──────────────┬──────────────────────┘
               │ sync (async, best-effort)
               ▼
┌─────────────────────────────────────┐
│ Server (encrypted blob store)       │  ← optional remote mirror
│   (may be offline or nonexistent)   │
└─────────────────────────────────────┘
```

The local database tracks a `sync_status` per blob:

| Status | Meaning |
|--------|---------|
| `local_only` | Not yet uploaded to server (or no server configured) |
| `synced` | Uploaded and confirmed |
| `pending_delete` | Locally deleted, server tombstone not yet written |
| `sync_failed` | Upload failed, will retry |

## Sync Protocol

The client maintains a local state and syncs encrypted blobs with the server when a server endpoint is configured and reachable.

### Ingest (local-first, then sync)

```
1. Fetch URL content (client fetches directly)
2. Extract with Readability (client-side)
3. Chunk text (~500 tokens, 50 token overlap, sentence boundaries)
4. Compute embeddings on-device (snowflake-arctic-embed-s)
5. Store plaintext locally in SQLite + embeddings in memory
   → Article is now searchable. Done if no server configured.
6. Canonicalize plaintext JSON (RFC 8785)
7. Encrypt with verify-after-encrypt (encryptAndVerify for every blob)
8. Upload to server via TransactWriteItems (atomic) — async, best-effort
9. Verify server-returned SHA-256 hash matches locally computed hash (transit integrity)
10. Mark blobs as synced on success, or queue for retry on failure
```

### Full Sync (server → client, e.g., new device)

```
1. Download and verify canary blob (confirms correct key before proceeding)
2. GET /blobs — paginated Query on DynamoDB base table
3. Download all blobs (strongly consistent read)
4. Pre-decryption validation for each blob:
   a. Verify enc.ct decoded length >= nonce_size + tag_size + 1 (41 bytes for XChaCha20-Poly1305)
   b. If enc["ct.len"] present: verify decoded length matches enc["ct.len"]
   c. If validation fails: flag blob as corrupted/truncated, do not attempt decryption
5. Decrypt with master key (any blob that fails decryption is flagged, not skipped)
5. Populate local SQLite + in-memory embedding index
6. Track progress with cursor for resumability
7. Post-sync verification: count(local blobs) == count(server blobs)
```

If interrupted (app killed, network lost), resumes from last cursor position. Only marks complete when all blobs are processed and count verification passes.

### Incremental Sync

```
1. If lastSyncTimestamp is older than 25 days:
   → Use Full Sync (reconciliation mode) instead of incremental.
     Reason: DynamoDB TTL can fire up to 48 hours late. If this device was offline
     for ~29 days, tombstones may have been TTL'd before this sync. Full reconciliation
     ensures the client doesn't re-upload data the user deleted on another device.

2. GET /blobs?since={lastSyncTimestamp}
   — Query GSI (gsi-ts) where ts > lastSync
   — Uses server-generated timestamps (no clock skew issues)
3. Download new/updated blobs, decrypt, merge into local state
4. Process tombstones: remove deleted sources/chunks locally
```

**GSI eventual consistency note:** The DynamoDB GSI may lag by up to a few seconds after a write. The client merges its own pending writes with GSI results to avoid missing its own recent ingests.

### Sync State Verification (Rollback Detection)

After each sync (full or incremental), the client computes a state hash to detect server-side tampering, rollback, or data suppression:

```
state_hash = SHA-256(sorted list of (blob_id || ":" || HMAC-SHA256(commit_key, blob_data)))
```

The client stores this hash locally. On the next sync, it recomputes the hash from the current server state. A mismatch indicates:
- The server rolled back to a previous state (replaying old data)
- The server suppressed a blob (withholding new data)
- The server un-deleted a tombstone (resurfacing deleted data)

**On mismatch:**
1. Log a warning with the divergent blob IDs (if identifiable)
2. Show a user-visible warning: "Sync integrity check failed. Your data may have been tampered with."
3. Do NOT automatically resolve — the user decides whether to trust the local or server state

For stronger guarantees, a Merkle tree can replace the flat hash, enabling efficient identification of divergent blobs without downloading everything.

### Atomic Ingest

Ingesting an article produces 1 source blob + N chunk blobs. DynamoDB `TransactWriteItems` makes this atomic (up to 100 items / 4MB per transaction).

At ~4.5KB per blob, one transaction handles ~100 chunks (~8-10 articles worth). For articles exceeding 100 chunks:
1. Write chunk blobs in idempotent batches (safe to retry)
2. Write source blob last — acts as a commit marker
3. Chunks without a matching source blob are ignored during sync

**Orphan cleanup:** If the client crashes after writing some chunks but before writing the source blob, orphaned chunks persist on the server indefinitely. During full sync, the client detects orphans (decrypted blobs with `type: "chunk"` whose `sourceId` does not match any source blob) and flags them for deletion. Orphan detection runs only during full sync, not incremental sync, to avoid false positives from in-progress ingests on other devices.

### Delete (Soft Delete with Encrypted Trash)

Delete moves the item to encrypted trash, not permanent deletion.

```
1. User taps delete
2. Client marks blob: deleted: true, deleted_at: timestamp
3. Blob remains encrypted on server (unchanged)
4. UI shows "Moved to trash" with 5-second Undo option
5. Trash is visible in app: "Recently Deleted (N items)"
6. Other devices see the deletion on next sync → item moves to their trash too
7. Restore: user can restore from trash at any time within at least 30 days
8. Auto-purge: DynamoDB TTL permanently removes after 45 days (server TTL is 45 days to account for DynamoDB TTL variance of up to 48 hours; users are promised at least 30 days)
9. Manual purge: user can permanently delete from trash settings
```

This prevents the most common user-error data loss (accidental deletion) with minimal added complexity — the `deleted` flag and `ttl` attribute are already in the DynamoDB schema.

### Cleanup

Users need ways to remove outdated content from their knowledge base — especially Notetaker users approaching their 50 MB synced storage limit.

#### Storage Dashboard

Accessible from Settings. Shows:

- **Total synced storage used** (e.g., "38 MB of 50 MB") with a visual bar
- **Top sources by size** — largest articles listed first, with size and date
- **Storage by age** — breakdown by time period (last 30 days, 3 months, 6 months, older)

This gives users a quick picture of what's consuming their quota.

#### Bulk Cleanup Filters

A "Manage Library" view that lists all sources with sortable/filterable columns:

| Filter | What it shows | Why it's useful |
|--------|--------------|-----------------|
| Oldest first | Sources sorted by `created_at` ascending | Find stale content from months/years ago |
| Largest first | Sources sorted by `blob_size_bytes` descending | Free the most space with fewest deletions |
| Never accessed | Sources where `last_accessed_at` is NULL | Articles saved but never found via search — likely low-value |
| Not accessed since... | Sources where `last_accessed_at` < user-chosen date | Content that hasn't been useful recently |

Users select multiple sources and delete in bulk. Same soft-delete flow — everything goes to trash with at least 30 days recovery.

#### Storage-Aware Nudges

When a syncing user approaches their storage limit:

| Threshold | Behavior |
|-----------|----------|
| 80% used | Subtle indicator in the app (e.g., storage bar turns amber) |
| 95% used | Banner: "Running low on synced storage. Free up space or upgrade." with links to Manage Library and upgrade |
| 100% used | New articles save locally but don't sync. Banner: "Synced storage full. New articles are saved locally only." |

At 100%, the app continues to work — articles are saved locally, searched locally, fully functional. Only sync stops. No data loss, no blocked workflows. The user can free space (cleanup) or upgrade (Notetaker → Pro) at their own pace.

#### All cleanup is client-side

The server has no concept of "cleanup." The client decides what to delete, issues `DELETE /v1/blobs/{id}` for each, and the server marks tombstones. All filtering, sorting, and size calculations happen locally using the SQLite `sources` table.

### Conflict Resolution

For a single-user system, last-write-wins using server-generated timestamps. Multi-device conflicts (e.g., same URL ingested from phone and laptop simultaneously) are resolved by keeping both and deduplicating by URL on the client.

## Content Fetching

**Client-direct fetching** for maximum privacy. The app fetches the URL itself and extracts content using a Dart HTML parser + Readability port.

The server never sees which URLs you ingest.

Fallback to a stateless fetch proxy only if the client can't reach the URL (e.g., CORS issues in Flutter web). The proxy would see the URL but not the extracted content or what happens with it.
