# Sync Subsystem Consolidation Plan

## Context

The sync subsystem has had 5 production bugs (body hash mismatch, 409 handling, sequence corruption, upload never wired, sequence counter conflicts), all caused by the same structural problem: **5 duplicated HTTP client implementations** with ~15 independent `SequenceCounter` instances sharing a single flat file with no locking.

The user runs multiple VS Code instances simultaneously, each spawning their own MCP server process. All processes share `~/.chaoskb/` — the flat-file sequence counter and upload queue cannot handle this safely. SQLite (already in use with WAL mode + `busy_timeout=5000`) handles multi-process concurrency correctly and should replace all flat-file state.

## Approach: Move Shared State Into SQLite, Consolidate HTTP Clients

**Core idea**: Replace `~/.chaoskb/sequence`, `upload-queue.json`, and `sync-state.json` with SQLite tables. SQLite's WAL mode + write serialization eliminates all file-based race conditions. Then consolidate all HTTP client code into a single `SyncHttpClient` path.

---

## Phase 1: SQLite Tables for Sequence, Queue, and Sync State

**Goal**: Eliminate flat-file concurrency hazards. Pure additions — existing code unchanged.

### Schema Changes

Modify `src/storage/schema.ts` — bump version to 3, add tables:

```sql
-- Atomic sequence counter (single-row table)
CREATE TABLE IF NOT EXISTS sync_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync_sequence (id, value) VALUES (1, 0);

-- Unified sync queue (uploads AND deletes, replaces upload-queue.json)
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blob_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upload', 'delete')),
  data BLOB,                    -- encrypted bytes (NULL for deletes)
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_attempt TEXT,
  next_attempt TEXT,            -- exponential backoff
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sync state key-value store (replaces sync-state.json)
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### New Repository Interfaces

Add to `src/storage/types.ts`:

```typescript
interface ISyncQueueRepository {
  enqueue(blobId: string, operation: 'upload' | 'delete', data?: Uint8Array): void;
  claimBatch(limit: number): SyncQueueItem[];  // atomic claim via UPDATE...RETURNING
  complete(id: number): void;
  fail(id: number, error: string): void;       // increment retry, set backoff
  permanentFail(id: number, error: string): void;
  releaseStale(olderThanSeconds: number): number;  // crash recovery
  pendingCount(): number;
}

interface ISyncSequenceRepository {
  next(): number;   // UPDATE value = value + 1 RETURNING value (atomic)
  peek(): number;
}

interface ISyncStateRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}
```

Add `syncQueue`, `syncSequence`, `syncState` to `IDatabase`.

### New Files

- `src/storage/sync-queue-repo.ts` — ISyncQueueRepository implementation
- `src/storage/sync-sequence-repo.ts` — ISyncSequenceRepository implementation  
- `src/storage/sync-state-repo.ts` — ISyncStateRepository implementation

### Migration

`runMigrationV3()` in `schema.ts`:
1. Create new tables
2. Import `~/.chaoskb/sequence` value into `sync_sequence`
3. Import `~/.chaoskb/upload-queue.json` items into `sync_queue`
4. Import `~/.chaoskb/sync-state.json` into `sync_state`
5. Do NOT delete old files (keep as rollback backup)

### Key Design: claimBatch Atomicity

Multiple processes can safely call `claimBatch` concurrently:
```sql
UPDATE sync_queue
SET status = 'processing', last_attempt = datetime('now')
WHERE id IN (
  SELECT id FROM sync_queue
  WHERE status = 'pending'
    AND (next_attempt IS NULL OR next_attempt <= datetime('now'))
  ORDER BY created_at ASC LIMIT ?
)
RETURNING *;
```
SQLite serializes writes — each item is claimed by exactly one process.

---

## Phase 2: Consolidate HTTP Clients

**Goal**: Single `SyncHttpClient` factory used by all callers. Eliminate 4 duplicate implementations.

### Modify SyncHttpClient

`src/sync/http-client.ts` — accept `ISyncSequenceRepository` instead of `SequenceCounter`:
```typescript
constructor(config: SyncConfig, signer: SSHSigner, sequence: ISyncSequenceRepository)
```

### Create Client Factory

`src/sync/client-factory.ts` — lazy singleton per process:
```typescript
export function createSyncClientFactory(db: IDatabase): SyncClientFactory {
  // Loads config, creates SSHSigner, uses db.syncSequence
  // Returns singleton SyncHttpClient
}
```

### Eliminate Duplicate Clients

| File | Current | Change |
|---|---|---|
| `src/cli/tools/sync-client.ts` | Own SSHSigner + SequenceCounter | Delegate to factory |
| `src/cli/commands/devices.ts` | 2x own SSHSigner + SequenceCounter | Import from sync-client.ts |
| `src/cli/commands/notifications.ts` | Own SSHSigner + SequenceCounter | Import from sync-client.ts |
| `src/cli/commands/projects.ts` | Module-level SequenceCounter | Import from sync-client.ts |
| `src/cli/commands/rotate-key.ts` | 2x SSHSigner + SequenceCounter, no timeout | Use factory (with key override for rotation) |
| `src/cli/commands/setup-sync.ts` | Inline signing, no SequenceCounter | Use factory |
| `src/cli/bootstrap.ts` | 2x SSHSigner + SequenceCounter + raw fetch | Use factory after DB init |

### Fix Inconsistencies During Consolidation

- Add HTTPS enforcement to all paths (currently missing in CLI commands)
- Standardize Content-Type: `application/octet-stream` for binary, none for GET
- Add timeouts everywhere (missing in rotate-key.ts, projects.ts)
- Add blobId format validation before URL interpolation

---

## Phase 3: Storage-Layer Sync Wiring

**Goal**: Sync enqueuing happens automatically when blobs are stored/deleted. Tool handlers no longer need to know about sync.

### Add Methods to IDatabase

```typescript
// In types.ts or via SyncAwareDatabase wrapper
storeAndEnqueueUpload(blobId: string, encryptedBytes: Uint8Array): void;
enqueueDelete(blobId: string): void;
```

### Simplify kb-ingest.ts

Replace lines 96-114 (the entire sync block) with:
```typescript
db.storeAndEnqueueUpload(sourceId, sourceEncrypted.bytes);
for (const chunk of chunkEncrypted) {
  db.storeAndEnqueueUpload(chunk.blobId, chunk.bytes);
}
```

Remove `syncService` from `McpDependencies` for ingest/delete.

### Simplify kb-delete.ts

Replace lines 42-58 with:
```typescript
for (const blobId of allBlobIds) {
  db.enqueueDelete(blobId);
}
```

---

## Phase 4: Queue Processor

**Goal**: Replace `UploadQueue` with a `SyncQueueProcessor` that handles both uploads and deletes with retry.

### Create SyncQueueProcessor

`src/sync/queue-processor.ts`:
- `processQueue(batchSize)`: claims items via `claimBatch`, uploads/deletes via `SyncHttpClient`, marks complete/failed
- Handles 409 (already exists) as success
- Handles 413 (quota) by stopping
- Exponential backoff: `fail()` sets `next_attempt = now + 2^retryCount seconds`
- Crash recovery: `releaseStale(300)` at start of each run

### Queue Draining Strategy

**All processes drain** — no leader election needed. The `claimBatch` atomicity ensures no double-processing. If 3 VS Code instances are open, whichever calls `processQueue` first claims items; others find nothing.

### Integrate with MCP Server

In `mcp-server.ts`, after initializing dependencies:
1. Create `SyncQueueProcessor` with db + client factory
2. Call `processQueue()` on startup (drain pending items from previous sessions)
3. Call `processQueue()` after each ingest/delete tool call

### Remove Old Files

- Delete `src/sync/upload-queue.ts`
- Delete `src/sync/sequence.ts`
- Old flat files remain on disk but are no longer read after migration

---

## Phase 5: Tests

### New Test Files

| File | Tests |
|---|---|
| `src/storage/__tests__/sync-queue-repo.test.ts` | Enqueue, claimBatch atomicity, fail+backoff, permanentFail, releaseStale, duplicates |
| `src/storage/__tests__/sync-sequence-repo.test.ts` | Monotonic increment, concurrent instances, peek |
| `src/storage/__tests__/sync-state-repo.test.ts` | Get/set/delete |
| `src/sync/__tests__/queue-processor.test.ts` | Upload success, delete success, retry on failure, permanent failure, 413 stops, 409 success, crash recovery |
| `src/sync/__tests__/client-factory.test.ts` | Singleton creation, error when unconfigured |
| `src/sync/__tests__/sync-service.test.ts` | Full integration with mocked HTTP, state persistence |
| `src/storage/__tests__/schema-migration.test.ts` | v2->v3 migration, flat file import, idempotency |

### Update Existing Tests

| File | Add Coverage For |
|---|---|
| `src/cli/__tests__/tools/kb-ingest.test.ts` | Verify enqueueUpload called for each blob |
| `src/cli/__tests__/tools/kb-delete.test.ts` | Verify enqueueDelete called for each blob |

---

## Implementation Order

Each phase produces a working system. All existing tests pass at each step.

1. **Phase 1** — schema + repositories (pure additions)
2. **Phase 5 (partial)** — repository unit tests
3. **Phase 4** — queue processor (replaces UploadQueue)
4. **Phase 2** — client consolidation
5. **Phase 3** — storage-layer sync wiring
6. **Phase 5 (remaining)** — integration + migration tests

---

## Verification

After implementation:
1. `npm test --workspace=src` — all unit tests pass
2. `npm test --workspace=server` — server tests unaffected
3. `npm run test:e2e:sync --workspace=src` — e2e sync flow (Ed25519 + RSA) passes
4. Open 2 VS Code instances, ingest a URL in each simultaneously — verify no sequence conflicts, both blobs sync
5. Kill one VS Code instance mid-ingest — verify the other instance picks up stale queue items via `releaseStale`
6. Check `~/.chaoskb/local.db` — verify `sync_queue`, `sync_sequence`, `sync_state` tables exist and contain expected data

## Critical Files

**Create:**
- `src/storage/sync-queue-repo.ts`
- `src/storage/sync-sequence-repo.ts`
- `src/storage/sync-state-repo.ts`
- `src/sync/client-factory.ts`
- `src/sync/queue-processor.ts`

**Modify (significant):**
- `src/storage/schema.ts` — v3 migration
- `src/storage/types.ts` — new repo interfaces
- `src/storage/database.ts` — instantiate new repos
- `src/sync/http-client.ts` — accept ISyncSequenceRepository
- `src/sync/sync-service.ts` — use queue processor + SQLite state
- `src/cli/tools/kb-ingest.ts` — simplify to enqueueUpload
- `src/cli/tools/kb-delete.ts` — simplify to enqueueDelete
- `src/cli/mcp-server.ts` — wire up queue processor

**Modify (consolidation — remove duplicate HTTP clients):**
- `src/cli/tools/sync-client.ts`
- `src/cli/commands/devices.ts`
- `src/cli/commands/notifications.ts`
- `src/cli/commands/projects.ts`
- `src/cli/commands/rotate-key.ts`
- `src/cli/commands/setup-sync.ts`
- `src/cli/bootstrap.ts`

**Delete:**
- `src/sync/upload-queue.ts`
- `src/sync/sequence.ts`
