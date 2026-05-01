# Self-Hosting

Users can deploy their own backend and point the app and MCP proxy at it. Because the server is a dumb encrypted blob store, self-hosting is straightforward — there are no ML models, vector databases, or complex services to operate.

## What Gets Deployed

```
AWS Account (user-owned)
    │
    ├── Lambda Function URL  (single function, ~50 lines of handler code)
    └── DynamoDB table       (one table, one GSI, on-demand capacity)
```

Total: 2 AWS resources. No VPC, no NAT, no ALB, no CloudFront, no Secrets Manager.

## Deployment

### One-Command Deploy

```bash
npx chaoskb-deploy --ssh-pubkey ~/.ssh/id_ed25519.pub
# or, fetch the public key from GitHub:
npx chaoskb-deploy --github <username>
```

This runs the CDK stack from the published npm package. It:
1. Checks for AWS credentials (`aws sts get-caller-identity`)
2. Reads the SSH public key from the specified file or fetches it from `https://github.com/<username>.keys`
3. Bootstraps CDK if needed (`cdk bootstrap`)
4. Deploys the `ChaoskbStack`
5. Registers the SSH public key in a DynamoDB config item (`PK: CONFIG, SK: SSH_PUBKEY`)
6. Outputs the Function URL
7. Prints configuration instructions for the app and MCP proxy

### Manual CDK Deploy

For users who want to inspect or customize the stack:

```bash
git clone https://github.com/<org>/chaoskb
cd chaoskb/infra
npm install
npx cdk deploy --context stage=prod
```

### Outputs

The stack exports:

| Output            | Example                                           | Used by          |
| ----------------- | ------------------------------------------------- | ---------------- |
| `EndpointUrl`     | `https://abc123.lambda-url.us-east-1.on.aws`     | App + MCP proxy  |
| `TableName`       | `chaoskb-prod`                                     | Informational    |
| `Region`          | `us-east-1`                                       | App + MCP proxy  |

No secrets to retrieve — authentication uses the SSH key already on the user's machine.

## Client Configuration

### Flutter App

Settings screen → "Backend" → "Self-hosted":

```
Endpoint:  https://abc123.lambda-url.us-east-1.on.aws
           [Test Connection]   [Save]
```

The app calls `GET /health` to verify connectivity before saving. Authentication uses the SSH key registered during deployment. The endpoint is stored in platform secure storage (Keychain / Android Keystore).

### Desktop (`chaoskb-mcp`)

Option A — interactive setup:

```bash
chaoskb-mcp setup sync
# Prompts for endpoint only, writes config file
# Validates connection (signs test request with SSH key) before saving
```

Or with GitHub public key registration:

```bash
chaoskb-mcp setup sync --github <username>
# Fetches SSH public key from GitHub, registers with endpoint
```

Option B — config file (`~/.chaoskb/config.json`, permissions `0600`):

```json
{
  "endpoint": "https://abc123.lambda-url.us-east-1.on.aws",
  "keyFile": "~/.chaoskb/key"
}
```

No credential storage is needed beyond the config file — authentication uses the SSH key from ssh-agent (`SSH_AUTH_SOCK`) or `~/.ssh/id_ed25519`. The SSH private key is never copied or duplicated by ChaosKB.

Option C — environment variables (useful for CI or containers):

Set `CHAOSKB_ENDPOINT` in the agent's MCP config env block, or as a system environment variable. For CI environments without ssh-agent, set `CHAOSKB_SSH_KEY_PATH` to point to the private key file.

### Configuration Precedence

```
1. Environment variables (highest priority — CHAOSKB_ENDPOINT, CHAOSKB_SSH_KEY_PATH)
2. Config file (~/.chaoskb/config.json)
3. No server (local-only mode — default)
```

## Hosted vs Self-Hosted

The design supports both a community-hosted default and self-hosted backends. The client code is identical — only the endpoint differs. Authentication uses the same SSH key in both cases.

| Aspect               | Hosted (free 50 MB plan)          | Self-hosted                   |
| -------------------- | --------------------------------- | ----------------------------- |
| Deployment           | None                              | `npx chaoskb-deploy`          |
| Cost                 | Free tier / subscription          | ~$0.25/mo (AWS direct)        |
| Data location        | Provider's AWS account            | User's AWS account            |
| Trust model          | Trust provider's infrastructure   | Trust only yourself + AWS     |
| Authentication       | SSH key registered with provider  | SSH key registered during deploy |
| Uptime               | Provider's SLA                    | Your AWS account's SLA        |
| Customization        | None                              | Full (CDK stack is yours)     |

For Enhanced and Maximum security tiers, self-hosting is the natural choice — the server never sees plaintext, but self-hosting eliminates even the trust in a third-party operator's infrastructure.

## CDK Customization

Self-hosters can modify the stack before deploying:

```typescript
// infra/lib/chaoskb-stack.ts — users can override:

const table = new BlobStore(this, "BlobStore", {
  tableName: `chaoskb-${stage}`,          // custom table name
  pointInTimeRecovery: true,               // enable PITR (default: false, adds cost)
  removalPolicy: cdk.RemovalPolicy.RETAIN, // protect against accidental stack deletion
});

const api = new Api(this, "Api", {
  memorySize: 256,      // Lambda memory (default: 128 — enough for blob storage)
  timeout: 30,          // Lambda timeout seconds
  corsOrigins: ["*"],   // restrict CORS if needed
});
```

### Common Customizations

| Customization              | How                                          | Why                                    |
| -------------------------- | -------------------------------------------- | -------------------------------------- |
| Different AWS region       | `npx cdk deploy --context region=eu-west-1`  | Data residency requirements            |
| Enable PITR on DynamoDB    | Set `pointInTimeRecovery: true`               | Point-in-time recovery (~$0.20/GB/mo)  |
| Retain table on delete     | Set `removalPolicy: RETAIN`                   | Prevent accidental data loss           |
| Custom domain              | Add CloudFront + ACM certificate              | Friendly URL, easier to remember       |
| WAF                        | Add WAF WebACL to Function URL                | Rate limiting, IP blocking             |
| VPC                        | Place Lambda in VPC                           | Corporate network requirements         |

## Tear Down

```bash
npx cdk destroy --context stage=prod
```

If `removalPolicy` is RETAIN (recommended), the DynamoDB table survives stack deletion. The user must manually delete it to fully remove all data.

## Security Considerations for Self-Hosters

- Authentication uses your SSH private key. Protect it with a passphrase and use ssh-agent to avoid repeated passphrase entry.
- Enable CloudTrail in your AWS account to audit who accesses the Lambda and DynamoDB.
- Consider enabling DynamoDB encryption with a customer-managed KMS key (defense-in-depth — blobs are already client-encrypted).
- The Lambda execution role has minimal permissions: DynamoDB read/write on one table. Review it in the CDK source.
- Never share your SSH private key. If compromised, generate a new key pair, register the new public key with the server (`chaoskb-mcp setup sync --rotate-key`), and remove the old public key from the DynamoDB config item.
