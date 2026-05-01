# Storage Backend

## Decision: DynamoDB Only

DynamoDB is the only storage backend. S3 and hybrid options were evaluated and rejected.

**Why DynamoDB wins:**
- Atomic multi-item writes via `TransactWriteItems` — critical for reliable ingest
- GSI enables efficient incremental sync (`since` queries)
- Single-digit millisecond latency for reads and writes
- 400KB item limit is 80x headroom over typical ~4.5KB chunk blobs
- Simplest operational model — no cross-service consistency gaps

**Why not S3:** No native "list since timestamp" makes incremental sync impractical. No multi-object transactions means partial ingests on failure.

**Why not DynamoDB + S3:** Adds a non-atomic cross-service write failure mode with no benefit at ~5KB blob sizes.

## Schema

```
Table: chaoskb-{stage}

PK: TENANT#{tenantId}
SK: BLOB#{blobId}
Attributes:
  data     Binary    -- encrypted blob bytes
  ts       Number    -- server-generated epoch ms (write timestamp)
  size     Number    -- blob size in bytes
  deleted  Boolean   -- tombstone flag
  ttl      Number    -- TTL epoch seconds (tombstones only, 45 days)

GSI: gsi-ts
  PK: TENANT#{tenantId}
  SK: ts (Number)     -- enables incremental sync queries
```

Capacity: on-demand (PAY_PER_REQUEST). No provisioned capacity needed for personal use.

## Sizing

| Dataset        | Blobs  | Storage | DynamoDB cost (storage) |
| -------------- | ------ | ------- | ----------------------- |
| 100 articles   | ~1,300 | ~5.8 MB | ~$0.002/mo              |
| 1,000 articles | ~13,000 | ~58 MB | ~$0.015/mo              |
| 5,000 articles | ~65,000 | ~290 MB | ~$0.073/mo              |

Assumes ~12 chunks/article average, ~4.5KB/blob.

## Sync Reliability Guarantees

### Atomic Ingest

`TransactWriteItems` ensures source + chunk blobs are written atomically (up to 100 items / 4MB). At ~4.5KB per blob, this covers ~100 chunks per transaction.

For articles exceeding 100 chunks, a two-phase approach:
1. Write chunks in idempotent batches
2. Write source blob last as a commit marker
3. Orphaned chunks (no source) are ignored during sync

### Incremental Sync Consistency

The GSI is eventually consistent (typically <1 second lag). A blob written to the base table may not immediately appear in the GSI.

**Mitigation:** The client merges its own pending local writes with GSI query results, ensuring it never misses its own recent ingests.

### Server-Generated Timestamps

All `ts` values are set by the Lambda handler (`Date.now()`), not the client. The client records the server's response timestamp as `lastSync`. This eliminates clock skew between devices.

### Tombstone Lifecycle

Deletes write a tombstone (blob ID + `deleted: true` + `ttl`). Tombstones appear in sync responses so other devices can remove local copies. DynamoDB TTL auto-prunes tombstones after 45 days.

**Why 45 days (not 30):** DynamoDB TTL can fire up to 48 hours late. If a device is offline for ~29 days and the tombstone TTL is 30 days, the tombstone may be pruned before the device syncs, causing the device to re-upload data the user deleted. A 45-day TTL provides a 15-day buffer. The client uses a 25-day threshold to trigger full reconciliation sync instead of incremental (see client-architecture.md), providing defense-in-depth against this race.

### Full Sync Resumability

Full sync paginates via DynamoDB `ExclusiveStartKey`. The client stores the last processed key locally. If interrupted, it resumes from that cursor. Sync is marked complete only when all pages are processed.
