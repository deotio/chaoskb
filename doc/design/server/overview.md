# Server Architecture — Overview

The server is a key-value store for opaque encrypted blobs. It authenticates requests and stores/retrieves data. It performs no computation over user data.

```
Lambda Function URL
    │
    ├── Auth: SSH signature verification (public key in DynamoDB)
    │
    └── DynamoDB table (PAY_PER_REQUEST)
         ├── Blob storage (encrypted client data, ~4.5KB/blob)
         ├── GSI for incremental sync (server-generated timestamps)
         └── TransactWriteItems for atomic ingest
```

No VPC. No database engine. No ML services.

## Documents

- [api.md](api.md) — REST endpoints, request/response examples
- [storage.md](storage.md) — DynamoDB schema, sync reliability guarantees, sizing
- [infrastructure.md](infrastructure.md) — CDK stack layout, cost estimate

## Key Design Decisions

- **DynamoDB-only storage** — S3 and hybrid options were evaluated and rejected. DynamoDB provides atomic multi-item writes, efficient incremental sync via GSI, and the simplest operational model at ~4.5 KB blob sizes.
- **snowflake-arctic-embed-s** — selected for best retrieval quality among mobile-capable models (MTEB Retrieval ~53.1, 384 dimensions, ~134 MB ONNX).
- **Model switchability** — the design supports switching embedding models via client-side re-embedding with never-overwrite migration.
