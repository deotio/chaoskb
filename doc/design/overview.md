# E2E Encrypted Knowledge Base — Overview

## Core Insight

A personal knowledge base is small. Hundreds of articles, maybe a few thousand — perhaps 10k-50k chunks total. At 384-dim float32 embeddings, 50k chunks is ~73MB of vectors. This fits comfortably in memory on any modern device.

This changes the calculus entirely. We don't need server-side search at all.

## The Idea

**The app is a standalone, fully functional knowledge base. The server is optional — it exists only for backup and multi-device sync.**

All intelligence — content fetching, text extraction, chunking, embedding, searching — happens on the client. The server never sees plaintext, never sees embeddings, never computes anything over user data. It stores opaque blobs and serves them back. If the server is offline, unreachable, or permanently shut down, the app continues to work with its local data.

```
Clients
├── Mobile (Flutter — iOS / Android)
│     ├── Ingest via share sheet
│     ├── On-device embedding, search, encryption
│     └── SQLite local store
│
├── Desktop (chaoskb-mcp — macOS / Windows / Linux)
│     ├── TypeScript CLI, installed via `npm install -g chaoskb-mcp` or shell script
│     ├── Runs as MCP server (stdio) for any compatible chat agent
│     ├── Same pipeline: fetch, chunk, embed, encrypt, search
│     ├── Auto-registers with detected agents (Claude, Cursor, VS Code, etc.)
│     └── SQLite local store (~/.chaoskb/local.db)
│
└── Both clients:
      ├── Store locally in SQLite + in-memory index     ← app works here, with or without a server
      ├── Upload encrypted blobs to server (if available) ← optional: backup & sync
      ├── Download & decrypt from server (if available)   ← optional: multi-device sync
      └── Vector similarity search in local memory

Server (Lambda + DynamoDB) — optional
  └── Store and retrieve encrypted blobs (knows nothing)
      Offline? App keeps working. Shutdown? App keeps working.
```

## What the Server Knows

| Data                | Server sees?  |
| ------------------- | ------------- |
| Article content     | No (encrypted) |
| Article URL         | No (encrypted) |
| Article title       | No (encrypted) |
| Tags                | No (encrypted) |
| Embeddings          | No (encrypted) |
| Chunk count per source | No (relationship metadata is encrypted) |
| Total storage used  | Yes            |
| Timestamp of ingest | Yes            |
| Client IP address   | Yes            |

The server is a key-value store for ciphertext. It can observe access patterns and volume, but not content.

## Key Properties

| Dimension           | Value                                         |
| ------------------- | --------------------------------------------- |
| Offline-first       | Yes — app works fully standalone, no server required |
| Server role         | Backup & multi-device sync only (optional)    |
| Search quality      | snowflake-arctic-embed-s (384-dim, MTEB ~53)  |
| Search latency      | ~50-100ms (local brute-force, small dataset)  |
| Ingest latency      | ~5-15s (on-device embed)                      |
| Offline search      | Yes — always local, not "once synced"         |
| Offline ingest      | Yes — queued for sync when server is available |
| Privacy             | Server sees nothing (opaque ciphertext only)  |
| Desktop client      | `chaoskb-mcp` — TypeScript CLI (Node.js)      |
| MCP integration     | Auto-registers with detected chat agents      |
| Server cost         | ~$0.25/mo (DynamoDB + Lambda) — $0 if no server |
| Scalability ceiling | ~50-100k chunks (device RAM)                  |

## Design Documents

- [crypto.md](crypto.md) — Security tiers, encryption scheme (XChaCha20-Poly1305), key management
- [envelope-spec.md](envelope-spec.md) — Formal wire format specification with test vectors
- [client-architecture.md](client-architecture.md) — On-device embedding, local search, sync protocol, soft delete
- [server-architecture.md](server-architecture.md) — Minimal encrypted storage API (DynamoDB)
- [mcp-integration.md](mcp-integration.md) — How MCP clients interact with an E2E system
- [threat-model.md](threat-model.md) — What's protected, what's not, residual risks
- [self-hosting.md](self-hosting.md) — Deploy your own backend, client configuration
- [portability.md](portability.md) — Data export, instance migration, shutdown guarantee

