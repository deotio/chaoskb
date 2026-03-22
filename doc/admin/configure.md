# Configuration and Customization

The CDK stack can be customized before deployment. Edit `infra/lib/chaoskb-stack.ts` or pass CDK context parameters.

## Common customizations

| Customization | How | Why |
|---------------|-----|-----|
| Different AWS region | `npx cdk deploy --context region=eu-west-1` | Data residency requirements |
| Enable point-in-time recovery | Set `pointInTimeRecovery: true` | Restore DynamoDB to any second in the last 35 days (~$0.20/GB/mo) |
| Retain table on stack delete | Set `removalPolicy: RETAIN` | Prevent accidental data loss if the stack is destroyed |
| Custom domain | Add CloudFront + ACM certificate | Friendly URL instead of the Lambda Function URL |
| WAF | Add WAF WebACL to Function URL | Rate limiting, IP blocking, geo-restrictions |
| VPC | Place Lambda in VPC | Corporate network requirements |

## CDK overrides

```typescript
// infra/lib/chaoskb-stack.ts

const table = new BlobStore(this, "BlobStore", {
  tableName: `chaoskb-${stage}`,
  pointInTimeRecovery: true,               // default: false
  removalPolicy: cdk.RemovalPolicy.RETAIN,  // default: DESTROY
});

const api = new Api(this, "Api", {
  memorySize: 256,      // default: 128 MB (sufficient for blob storage)
  timeout: 30,          // default: 30 seconds
  corsOrigins: ["*"],   // restrict if needed
});
```

## Client configuration precedence

Clients resolve server configuration in this order:

1. **Environment variables** (highest priority) — `CHAOSKB_ENDPOINT`, `CHAOSKB_SSH_KEY_PATH` (optional, defaults to `~/.ssh/id_ed25519`)
2. **Config file** — `~/.chaoskb/config.json` (endpoint) + ssh-agent or `~/.ssh/id_ed25519` (SSH private key)
3. **No server** — local-only mode (default)

Environment variables are intended for CI/container use. For interactive desktop use, prefer `chaoskb-mcp setup sync` which writes the endpoint to the config file. Authentication uses the SSH key from ssh-agent automatically.
