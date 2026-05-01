# Deploy a Self-Hosted Backend

Deploy your own ChaosKB server in your AWS account. The server is a minimal encrypted blob store — no ML models, no vector databases, no complex services.

## What gets deployed

| Resource | Purpose |
|----------|---------|
| Lambda Function URL | Single API endpoint (~50 lines of handler code) |
| DynamoDB table | Encrypted blob storage (one table, one GSI, on-demand capacity) |

Total: 2 AWS resources. No VPC, no NAT, no ALB, no CloudFront, no Secrets Manager.

Estimated cost: **~$0.25/month** for a typical personal knowledge base.

## Prerequisites

- An AWS account
- AWS CLI configured with credentials (`aws sts get-caller-identity` should succeed)
- Node.js 18+ (for CDK)

## One-command deploy

```bash
npx chaoskb-deploy --ssh-pubkey ~/.ssh/id_ed25519.pub
# or, fetch the public key from GitHub:
npx chaoskb-deploy --github <username>
```

This:
1. Checks for AWS credentials
2. Reads the SSH public key from the specified file or fetches it from GitHub
3. Bootstraps CDK if needed
4. Deploys the stack
5. Registers the SSH public key in a DynamoDB config item
6. Outputs the Function URL
7. Prints configuration instructions

## Manual CDK deploy

If you want to inspect or customize the stack first:

```bash
git clone https://github.com/<org>/chaoskb
cd chaoskb/infra
npm install
npx cdk deploy --context stage=prod
```

## Connect your clients

### Desktop

```bash
chaoskb-mcp setup sync
# Prompts for endpoint only. SSH key is used automatically via ssh-agent.
```

The endpoint is written to `~/.chaoskb/config.json`. Authentication uses the SSH key from ssh-agent or `~/.ssh/id_ed25519` — no credentials to copy or paste.

### Mobile

**Settings > Backend > Self-hosted:**
- Paste the endpoint URL
- SSH key is used automatically
- Tap "Test Connection", then "Save"

## Verify

```bash
chaoskb-mcp status
```

Should show the server endpoint, connection status, and blob count.

## Deploy to a different region

```bash
npx cdk deploy --context stage=prod --context region=eu-west-1
```
