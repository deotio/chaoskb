# Data Portability & Instance Migration

## Principle

Users own their data. They must be able to leave the hosted service at any time — moving to a self-hosted instance, a different hosted instance, or simply taking their data offline. This is a non-negotiable design constraint, not a premium feature.

Export and migration tools are available to all users, including those using the free local-only mode.

---

## Export

### Full Export (Encrypted)

The existing `GET /v1/export` endpoint streams all blobs as a single response. The client wraps this into a self-contained export file.

**Export file format:**

```
chaoskb-export-v1
├── manifest.json          — export metadata (version, timestamp, blob count, model info)
├── blobs/                 — all encrypted blobs, one file per blob ID
│   ├── b_a1b2c3d4e5.bin
│   ├── b_f6g7h8i9j0.bin
│   └── ...
└── key-bundle.json        — encrypted master key (same format as backup in crypto.md)
```

The export is encrypted — it's a portable copy of exactly what the server stores plus the wrapped master key. It can be imported into any ChaosKB instance.

**Key bundle contents** (from `crypto.md` backup format):

- KDF parameters (algorithm, salt, iterations/memory)
- Master key wrapped with an export passphrase (user-chosen at export time)
- Key commitment tag (HMAC-SHA256)

The export passphrase is separate from the account password and from the Maximum-tier passphrase. It protects the export file at rest.

### Full Export (Plaintext)

For users who want to leave ChaosKB entirely, the client can decrypt and export as plaintext:

```
chaoskb-plaintext-export/
├── manifest.json          — export metadata + integrity checksums
└── articles/
    ├── 001-article-title.md    — markdown with extracted text
    ├── 002-article-title.md
    └── ...
```

Each article file includes a YAML frontmatter block:

```yaml
---
url: https://example.com/original-article
saved: 2026-03-15T10:00:00Z
chunks: 12
---
```

**Integrity protection:** The `manifest.json` includes a SHA-256 hash for every exported file, plus an HMAC signature over the entire manifest:

```json
{
  "format": "chaoskb-plaintext-export-v1",
  "created_at": "2026-03-20T10:00:00Z",
  "article_count": 42,
  "files": {
    "articles/001-article-title.md": "sha256:base64...",
    "articles/002-article-title.md": "sha256:base64..."
  },
  "manifest_hmac": "base64..."
}
```

The `manifest_hmac` is `HMAC-SHA256(export_key, canonical_json(files))` where `export_key` is derived from the export passphrase (user provides one at export time, even for plaintext exports). This detects tampering with individual files or the manifest itself. Without the passphrase, an attacker can modify files but cannot update the HMAC to match.

Plaintext export happens entirely on-device. The server is never involved. No decrypted content is transmitted.

### Incremental Export

For ongoing backup, the client can export only blobs created or updated since a given timestamp, using the same `GET /v1/blobs?since={ts}` endpoint that powers incremental sync.

---

## Instance Migration

### Hosted → Self-Hosted

A user on the hosted service wants to move to their own infrastructure.

**Steps:**

1. **Deploy self-hosted instance:** `npx chaoskb-deploy --ssh-pubkey ~/.ssh/id_ed25519.pub` (creates Lambda + DynamoDB)
2. **Export from hosted instance:** Client calls `GET /v1/export` on hosted endpoint, streams all blobs
3. **Import to self-hosted instance:** Client calls `PUT /v1/blobs/{id}` for each blob on the new endpoint
4. **Verify:** Client calls `GET /v1/blobs/count` on both endpoints, confirms counts match
5. **Switch endpoint:** Client config updated to point at the new instance
6. **Confirm & delete hosted account:** Once the user is satisfied, delete the hosted account

**Key properties:**
- The master key does not change. Blobs are already encrypted — they're copied as-is.
- No re-encryption needed. The blobs are opaque; the server doesn't care which instance stored them.
- The client does all the work. No server-to-server transfer is needed or desirable (that would require the hosted service to have credentials for the self-hosted instance).

### Self-Hosted → Hosted

Reverse of the above. Export from self-hosted, import to hosted, switch endpoint.

### Instance → Instance (Any Direction)

The same export/import flow works between any two ChaosKB instances — hosted-to-hosted, self-hosted-to-self-hosted, or any combination. The protocol is symmetric.

---

## Migration Tool

The `chaoskb-mcp` binary and the Flutter app both include migration support:

```bash
# Desktop
chaoskb-mcp migrate --from <source-endpoint> --to <destination-endpoint>
```

```
# Mobile
Settings → Migrate to Another Instance
```

The migration tool:

1. Authenticates with both endpoints
2. Exports all blobs from source
3. Imports all blobs to destination
4. Verifies blob count and spot-checks random blobs (download + compare hash)
5. Reports success/failure
6. Does NOT delete source data — the user does that manually after confirming

---

## Service Shutdown Guarantee

If the hosted service is shut down:

1. **90 days notice minimum** — communicated via email, in-app notification, and the website
2. **Export remains functional** — the export endpoint stays live for the full 90-day notice period
3. **Migration tool provided** — a standalone migration tool (not dependent on the hosted service) will be published so users can move their data
4. **Self-hosting instructions** — clear documentation for deploying a personal instance and importing the export file
5. **Source code remains available** — the open-source client and server code are not affected by a hosted service shutdown

These commitments are codified in the Terms of Service.

---

## Serverless Operation

The app is designed to work fully standalone, without any server. The server exists only for backup and multi-device sync. This means:

- **No server required to use ChaosKB.** A user can install the app, save articles, search, and use MCP integration without ever configuring a server endpoint.
- **Server shutdown is not data loss.** If the hosted service shuts down, the app continues working with its local data. The user loses backup and multi-device sync — nothing else.
- **Migration is optional, not urgent.** Because the app works without a server, a shutdown notice gives users time to either set up self-hosting or simply continue using the app in local-only mode.

## What This Means for the Architecture

- **No vendor lock-in by design.** The server is a dumb blob store with a simple API. Any implementation of the same API can serve as a backend — or no backend at all.
- **Blob format is the contract.** The encrypted blob format (defined in `envelope-spec.md`) is the portable unit. As long as a server can store and return blobs by ID, it's compatible.
- **Master key is independent of the server.** The key lives on the device (or in the recovery phrase). It doesn't matter which server stored the blobs.
- **Export is not a premium feature.** Gating export behind payment would make users hostages, not customers. All users — including free local-only — have full export access.
- **The app is the product, the server is a utility.** The value is in local search, local embedding, local encryption. The server adds convenience (backup, sync), not capability.
