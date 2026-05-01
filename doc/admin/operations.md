# Operations and Monitoring

Day-to-day operations for a self-hosted ChaosKB backend.

## Monitoring

### CloudWatch

The Lambda function emits standard CloudWatch metrics:

- **Invocations** — total API calls
- **Errors** — failed requests (5xx)
- **Duration** — response time (should be <100ms for most operations)
- **Throttles** — if you hit Lambda concurrency limits (unlikely for personal use)

The DynamoDB table emits:

- **ConsumedReadCapacityUnits** / **ConsumedWriteCapacityUnits** — usage
- **ThrottledRequests** — should be zero on on-demand capacity

### CloudTrail

Enable CloudTrail in your AWS account to audit:

- Who invoked the Lambda function
- DynamoDB API calls

This is optional but recommended for security visibility.

## Cost tracking

Set up a billing alarm for the `chaoskb-*` resources. Expected costs:

| Resource | Typical cost | What drives it |
|----------|-------------|----------------|
| DynamoDB storage | ~$0.05/mo per 1,000 articles | Number of articles saved |
| DynamoDB reads/writes | ~$0.10/mo | Sync frequency, number of devices |
| Lambda invocations | ~$0.00/mo (free tier covers personal use) | API calls |

Total for a typical personal setup: **~$0.25/month**.

## SSH key rotation

If your SSH key is compromised (or as a periodic security measure):

```bash
chaoskb-mcp setup rotate-key --new-key ~/.ssh/id_ed25519_new.pub
```

This:
1. Authenticates with your current (old) SSH key
2. Unwraps the master key using the old key
3. Re-wraps the master key with the new key
4. Registers the new public key in the DynamoDB config item
5. Starts a 24-hour grace period where both old and new keys are accepted

After the grace period, only the new key is accepted. No client reconfiguration is needed — clients automatically use the new key from ssh-agent or `~/.ssh/id_ed25519`.

## DynamoDB backup and restore

### On-demand backup

```bash
aws dynamodb create-backup \
  --table-name chaoskb-prod \
  --backup-name "manual-backup-$(date +%Y%m%d)"
```

### Point-in-time recovery (PITR)

If enabled in the CDK stack (`pointInTimeRecovery: true`), you can restore the table to any second in the last 35 days:

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name chaoskb-prod \
  --target-table-name chaoskb-prod-restored \
  --restore-date-time "2026-03-20T10:00:00Z"
```

Note: this restores to a new table. You'll need to update the Lambda to point at the restored table, or rename tables.

### Client-side backup

The most reliable backup is a client-side encrypted export:

```bash
chaoskb-mcp export --format encrypted --output ~/backup.chaoskb
```

This is independent of the server and can be imported into any ChaosKB instance.

## DynamoDB encryption

DynamoDB encrypts data at rest by default using AWS-owned keys. For additional control, you can use a customer-managed KMS key in the CDK stack. This is defense-in-depth — your data is already client-side encrypted before it reaches DynamoDB.
