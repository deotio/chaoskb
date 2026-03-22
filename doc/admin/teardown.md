# Tear Down

How to remove a self-hosted ChaosKB backend.

## Before you start

1. **Export your data** if you haven't already:
   ```bash
   chaoskb-mcp export --format encrypted --output ~/backup.chaoskb
   ```

2. **Migrate** if you're moving to another instance:
   ```bash
   chaoskb-mcp migrate --from <old-endpoint> --to <new-endpoint>
   ```

3. **Update your clients** to point at the new endpoint (or remove the server config to go local-only):
   ```bash
   chaoskb-mcp setup sync
   # Enter new endpoint, or leave blank to go local-only
   ```

Your local data is not affected by server teardown. The app continues working with its local database.

## Destroy the stack

```bash
npx cdk destroy --context stage=prod
```

### If `removalPolicy` is RETAIN (recommended default)

The DynamoDB table survives stack deletion. This is a safety net — you can still recover your data after destroying the Lambda.

To fully remove all data, manually delete the table:

```bash
aws dynamodb delete-table --table-name chaoskb-prod
```

### If `removalPolicy` is DESTROY

The DynamoDB table is deleted with the stack. All server-side data is permanently gone. Make sure you have an export or local copy before proceeding.

## What gets removed

| Resource | Removed by `cdk destroy`? |
|----------|--------------------------|
| Lambda Function URL | Yes |
| DynamoDB table | Depends on `removalPolicy` |
| CloudWatch logs | Retained (delete manually if desired) |
| CDK bootstrap resources | No (shared across stacks) |

## After teardown

- Clients that still point at the old endpoint will show "sync failed" and continue working locally
- Update or remove server config on each client
- Your local database and encryption keys are unaffected
