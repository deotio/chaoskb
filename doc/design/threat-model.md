# Threat Model (E2E Encrypted Architecture)

## What's Protected

| Threat                                    | Protected? | How                                    |
| ----------------------------------------- | ---------- | -------------------------------------- |
| Server operator reads your articles       | Yes        | All content encrypted client-side      |
| Server operator reads your URLs           | Yes        | URLs encrypted in source metadata      |
| Server operator reads your search queries | Yes        | Search happens locally, never sent     |
| Database breach exposes content           | Yes        | Attacker gets ciphertext only          |
| Embedding inversion attacks               | Yes        | Embeddings encrypted, not on server    |
| Network MITM reads content                | Yes        | Client encryption + TLS               |
| AWS employee accesses data                | Yes        | Encrypted before reaching AWS          |
| Bedrock trains on your data               | N/A        | Bedrock not used at all               |
| CloudWatch logs reveal content            | Yes        | Server never sees content to log       |

## What's NOT Protected

| Threat                                    | Protected? | Why                                    |
| ----------------------------------------- | ---------- | -------------------------------------- |
| Compromised client device                 | No         | Key is in memory; attacker has everything |
| Malicious local MCP proxy update          | No         | Supply chain attack on the proxy binary |
| Access pattern analysis                   | Partial    | Server sees when you ingest/sync, blob count, sizes |
| Volume analysis                           | No         | Server knows total KB size and growth rate |
| Timing correlation                        | No         | Ingest timestamp ≈ browse timestamp    |
| Key loss = data loss                      | By design  | No recovery without the key            |
| Weak passphrase (if passphrase-derived)   | No         | Brute-forceable if passphrase is weak  |

## Attack Scenarios

### 1. Server Compromise

**Scenario:** Attacker gains full access to DynamoDB and Lambda.

**What they get:** Encrypted blobs, blob IDs, timestamps, sizes, registered SSH public keys.

**What they can't do:** Read any content, URLs, tags, or embeddings. Cannot search the knowledge base. Cannot determine what topics the user is interested in (beyond volume/timing). Cannot impersonate the user without the SSH private key — the public key alone is not sufficient to forge signatures.

**Mitigation:** Register a new SSH key and remove the compromised public key. The encrypted data remains safe. The attacker cannot unwrap the master key without the SSH private key.

### 2. Compromised Client

**Scenario:** Malware on the user's device.

**What they get:** Everything. The master key, all decrypted content, the local SQLite database, the in-memory embeddings.

**Mitigation:** This is outside the scope of E2E encryption. Standard device security (OS updates, app sandboxing, full-disk encryption) applies. The E2E design doesn't make this worse than any other app on the device.

### 3. Malicious Fetch Proxy (if used)

**Scenario:** The user opts into the server-side fetch proxy. The proxy is compromised.

**What they get:** URLs being ingested (not content — the client fetches and re-extracts if the proxy only returns text that the client then processes). Actually, if the proxy returns extracted text that the client trusts, the proxy could inject content.

**Mitigation:** Don't use the fetch proxy in E2E mode. Client-direct fetching only. If a proxy is needed, treat its output as untrusted and verify (e.g., fetch the URL again directly to compare).

### 4. Metadata / Side-Channel Analysis

**Scenario:** Attacker with server access observes patterns over time.

**What they learn:**
- When the user ingests articles (timestamps)
- How many articles and chunks (blob count)
- Approximate article length (blob size, though encryption adds padding)
- Sync frequency and patterns

**Mitigation:** Optional padding of blob sizes to fixed buckets (1KB, 4KB, 16KB, 64KB). Doesn't eliminate but reduces size-based inference. Batching syncs to fixed intervals (e.g., every 15 minutes) reduces timing correlation.

## Trust Boundaries

| Property               | Value                              |
| ---------------------- | ---------------------------------- |
| Trust boundary         | Client device only                 |
| Data exposed to server | Nothing (opaque ciphertext)        |
| Third-party ML exposure | None (embedding model runs locally) |
| Breach impact          | Useless ciphertext                 |
| Operational complexity | Low (blob store)                   |
| Key management risk    | Key loss = data loss (tier-dependent) |
| Attack surface         | Client device + supply chain       |

## Residual Risks and Acceptance

For a personal knowledge base of bookmarked articles:

- **Access pattern leakage** is low-value — knowing that someone saved 3 articles on Tuesday reveals little.
- **Key loss** is acceptable — the original URLs still exist; re-ingest is possible.
- **Client compromise** is the real risk, but it's the same risk as for any app on the device. E2E encryption is about protecting against *server-side* threats, not client-side ones.

The E2E architecture successfully moves the trust boundary from "you + AWS + your server code" to "you + your device."
