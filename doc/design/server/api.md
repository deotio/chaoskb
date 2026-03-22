# Server API

A single Lambda Function URL. All endpoints are versioned under `/v1/`.

```
GET  /health                 — no auth, no version prefix
POST /v1/auth/register       — register SSH public key (creates tenant)
GET  /v1/blobs               — list blob metadata (IDs, timestamps, sizes)
GET  /v1/blobs?since={ts}    — incremental sync (new/updated/deleted since timestamp)
GET  /v1/blobs/count         — total blob count for integrity verification
PUT  /v1/blobs/{id}          — upload encrypted blob (write-if-absent; returns 409 if exists)
DELETE /v1/blobs/{id}        — soft delete (marks as tombstone, 45-day TTL)
GET  /v1/blobs/{id}          — download encrypted blob
POST /v1/blobs/{id}/restore  — restore soft-deleted blob (remove tombstone flag)
GET  /v1/export              — download all blobs as a single streamed response (for backup)
```

## Authentication

All authenticated endpoints use SSH signature-based authentication. The client signs a payload using its SSH private key (via ssh-agent or `~/.ssh/id_ed25519`), and the server verifies the signature against the registered public key.

**Signature format** (compatible with `ssh-keygen -Y sign`):

The client signs a canonical string containing:

```
chaoskb-auth\n
{HTTP method} {path}\n
{ISO 8601 timestamp}\n
{SHA-256 hex digest of request body, or empty string for bodyless requests}
```

The signature and metadata are sent in the `Authorization` header:

```
Authorization: ChaosKB-SSH pubkey={base64 public key}, ts={ISO 8601 timestamp}, sig={base64 SSH signature}
```

The server:
1. Looks up the public key in the registered keys for the tenant
2. Verifies the timestamp is within 5 minutes of server time (replay prevention)
3. Reconstructs the canonical string from the request
4. Verifies the SSH signature against the registered public key

**Replay prevention:** The 5-minute timestamp window is acceptable because existing endpoint semantics provide idempotency:
- PUT uses write-if-absent (`attribute_not_exists` condition) — a replayed PUT returns 409 Conflict
- DELETE is soft-delete — a replayed DELETE on an already-deleted blob is idempotent
- GET is read-only — replay is harmless

For stronger replay prevention (if needed in future), add a per-request nonce: include a random value in the signed canonical string, and track used nonces server-side with a 5-minute DynamoDB TTL. This adds one DynamoDB write per request.

Supported key types: Ed25519 (preferred), RSA (fallback, minimum 2048-bit). The SSH private key is never sent to the server.

## PUT /blobs/{id}

```
Authorization: ChaosKB-SSH pubkey=<base64>, ts=<ISO 8601>, sig=<base64>
Content-Type: application/octet-stream

<encrypted blob bytes>
```

**Write-if-absent semantics:** The PUT operation uses `ConditionExpression: attribute_not_exists(SK)` on DynamoDB PutItem. If a blob with the given ID already exists, the server returns `409 Conflict`. This prevents accidental overwrites from client bugs, race conditions during key rotation, or replay attacks.

**Intentional overwrites** (e.g., during key rotation) use the `If-Match` header with the blob's current `ts` value as an ETag. The server verifies the condition before writing.

Response: `201 Created`

```json
{ "id": "b_a1b2c3d4e5", "size": 4832, "ts": "2026-03-20T10:00:00Z", "sha256": "base64-encoded-sha256-of-stored-bytes" }
```

The `sha256` field contains the SHA-256 hash of the stored bytes, allowing the client to verify transit integrity (the server stored exactly what was sent). Clients should compare this against a locally computed hash.

Response (conflict): `409 Conflict`

```json
{ "error": "blob_exists", "id": "b_a1b2c3d4e5" }
```

## Rate Limiting

The Lambda handler enforces rate limits per public key to prevent abuse:

| Operation | Limit | Window |
|-----------|-------|--------|
| PUT (upload) | 100 requests | per minute |
| GET (download) | 300 requests | per minute |
| DELETE | 50 requests | per minute |
| GET /blobs (list) | 10 requests | per minute |

Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` header. Rate state is tracked in DynamoDB using a sliding window counter (per-tenant, per-operation).

Storage quota enforcement (50 MB free plan) is active from Phase 1. Future phases add: device-bound tokens (rotate independently of the SSH key) and per-device rate limits.

## GET /blobs

```
Authorization: ChaosKB-SSH pubkey=<base64>, ts=<ISO 8601>, sig=<base64>
```

Response:

```json
{
  "blobs": [
    { "id": "b_a1b2c3d4e5", "size": 4832, "ts": "2026-03-20T10:00:00Z" },
    { "id": "b_f6g7h8i9j0",  "size": 2048, "ts": "2026-03-20T10:00:01Z" }
  ],
  "tombstones": [
    { "id": "b_k1l2m3n4o5", "deleted_at": "2026-03-19T08:00:00Z" }
  ]
}
```

## GET /blobs?since={ts}

Same shape as `GET /blobs` but filtered to items modified/deleted after `ts`. Tombstones older than 45 days are pruned (server TTL is 45 days; users are promised at least 30 days).
