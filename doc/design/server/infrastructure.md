# Server Infrastructure (CDK)

## Stack Layout

```
lib/
  chaoskb-e2e-stack.ts     ── single stack
  constructs/
    auth.ts                ── SSH public key registered in DynamoDB config item
    blob-store.ts          ── DynamoDB table + GSI
    api.ts                 ── Lambda Function URL (no VPC)
```

One stack, three constructs, no conditional backends. No Secrets Manager — authentication uses SSH signatures verified against the registered public key in DynamoDB.

## Cost Estimate

| Item                  | Cost       |
| --------------------- | ---------- |
| Lambda (light usage)  | ~$0.10/mo  |
| DynamoDB (250MB)      | ~$0.10/mo  |
| DynamoDB reads/writes | ~$0.05/mo  |
| **Total**             | **~$0.25/mo** |

The server is a minimal blob store — no VPC, no database engine, no ML services.
