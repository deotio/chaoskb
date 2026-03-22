# Data Portability

You own your data. You can export it, move it between servers, or take it offline at any time. Export is available to all users, including those on the free plan.

## Export

### Encrypted export

Creates a portable copy of your entire knowledge base, still encrypted. You can import this into any ChaosKB instance.

```bash
# Desktop
chaoskb-mcp export --format encrypted --output ~/backup.chaoskb
```

You'll be asked to create an **export passphrase**. This protects the backup file. You need this passphrase to import the file later.

The export file contains all your encrypted articles plus a wrapped copy of your master key. Store it anywhere — it's ciphertext.

### Plaintext export

Creates a folder of readable Markdown files. Use this to leave ChaosKB entirely or to have a human-readable backup.

```bash
# Desktop
chaoskb-mcp export --format plaintext --output ~/my-articles/
```

This creates one `.md` file per article with a YAML header (URL, save date) and the extracted text. A `manifest.json` includes checksums for tamper detection.

Plaintext export happens entirely on your device. No decrypted content is sent anywhere.

## Import

```bash
# Import an encrypted export into your current instance
chaoskb-mcp import ~/backup.chaoskb
```

You'll be asked for the export passphrase. The import merges with your existing data (no duplicates).

## Migrate between servers

Move your data from one server to another (e.g., hosted service to self-hosted, or between self-hosted instances):

```bash
chaoskb-mcp migrate --from <source-endpoint> --to <destination-endpoint>
```

This:
1. Authenticates with both servers
2. Copies all encrypted blobs from source to destination
3. Verifies the transfer (blob count + spot checks)
4. Reports success

Your encryption key doesn't change. Blobs are copied as-is — no re-encryption needed.

The source data is **not** deleted automatically. You decide when to clean up the old server.

## If the hosted service shuts down

ChaosKB is designed so a server shutdown is not an emergency:

- **Your app keeps working.** All your data is on your device. Search, save, delete — everything works without a server.
- **90 days notice** before any shutdown, via email and in-app notification.
- **Export stays live** for the full notice period.
- **You can self-host.** Deploy your own backend and import your data.
- **Or just go local.** Continue using ChaosKB without any server. You lose backup and multi-device sync — nothing else.
