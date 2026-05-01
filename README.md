# ChaosKB

A personal knowledge base for saving and searching web articles. All intelligence — content fetching, text extraction, chunking, embedding, searching, encryption — runs on your device. The server is an optional encrypted blob store for backup and multi-device sync.

## How it works

1. Save a URL (via chat agent, share sheet, or CLI)
2. The client fetches, chunks, and embeds the article on-device
3. Everything is encrypted before leaving the device
4. Search your knowledge base with natural language — locally, instantly

## Install

```bash
npm install -g @de-otio/chaoskb-client
```

That's it. On first launch, ChaosKB detects your SSH key, enables sync automatically, and encrypts your data with your public key. No setup commands, no accounts, no configuration.

## Clients

- **Desktop** — `@de-otio/chaoskb-client`, an npm package that runs as an MCP server for any compatible chat agent (Claude Desktop, Claude Code, Cursor, VS Code, etc.)
- **Mobile** (future) — Flutter app for iOS and Android

## Key properties

| Property | Value |
|----------|-------|
| Privacy | Server never sees plaintext — opaque ciphertext only |
| Offline | Fully functional without a server |
| Search | On-device embedding + brute-force cosine similarity (<50ms) |
| Encryption | XChaCha20-Poly1305, HKDF-SHA256, Argon2id |
| Server cost | ~$0.25/mo (DynamoDB + Lambda), or $0 in local-only mode |

## Security tiers

| Tier | Key management | Recovery |
|------|---------------|----------|
| **Standard** (default) | Your SSH key | Same SSH key on new device restores everything |
| **Enhanced** (deprecated) | 24-word recovery key + SSH key | Recovery key OR SSH private key |
| **Maximum** | Passphrase you choose | Re-enter passphrase on new device |

All tiers are end-to-end encrypted — the server stores only ciphertext it cannot decrypt. Lose your key material (SSH key, recovery words, or passphrase depending on tier), and your data is gone. No backdoor, no server-side key escrow. Enhanced is deprecated for new installations; use Maximum for stronger protection.

## Self-hosting

Deploy your own backend with a single command:

```bash
npx chaoskb-deploy --ssh-pubkey ~/.ssh/id_ed25519.pub
# or, fetch the public key from GitHub:
npx chaoskb-deploy --github <username>
```

This creates a Lambda Function URL + DynamoDB table in your AWS account. See [self-hosting docs](doc/design/self-hosting.md).

## Documentation

### User guide ([`doc/user/`](doc/user/))

- [Getting started](doc/user/getting-started.md) — install, first save, first search
- [Chat agent setup](doc/user/chat-agent-setup.md) — register with Claude Desktop, Cursor, VS Code, etc.
- [MCP tools reference](doc/user/mcp-tools.md) — what you can ask your agent to do
- [Security tiers](doc/user/security-tiers.md) — choosing, upgrading, recovery
- [Managing your library](doc/user/managing-your-library.md) — search, delete, cleanup, storage
- [Project knowledge bases](doc/user/project-knowledge-bases.md) — isolated, scoped KBs for specific work
- [Data portability](doc/user/data-portability.md) — export, import, migrate
- [Troubleshooting](doc/user/troubleshooting.md) — common issues and fixes

### Admin guide ([`doc/admin/`](doc/admin/))

- [Deploy](doc/admin/deploy.md) — deploy a self-hosted backend
- [Configure](doc/admin/configure.md) — CDK customizations, client config
- [Operations](doc/admin/operations.md) — monitoring, cost, API key rotation, backups
- [Tear down](doc/admin/teardown.md) — remove the backend safely

### Design ([`doc/design/`](doc/design/))

- [Overview](doc/design/overview.md) — architecture, what the server knows, key properties
- [Cryptographic design](doc/design/crypto.md) — security tiers, key hierarchy, encryption scheme, key rotation
- [Envelope specification](doc/design/envelope-spec.md) — wire format, algorithms, test vectors
- [Client architecture](doc/design/client-architecture.md) — on-device embedding, local search, sync protocol
- [Server architecture](doc/design/server-architecture.md) — minimal encrypted storage API
- [MCP integration](doc/design/mcp-integration.md) — how chat agents interact with the knowledge base
- [Threat model](doc/design/threat-model.md) — what's protected, what's not, residual risks
- [Tier upgrade protocol](doc/design/tier-upgrade.md) — cryptographic protocol for changing tiers
- [Portability](doc/design/portability.md) — data export, instance migration, shutdown guarantee
- [Self-hosting](doc/design/self-hosting.md) — deploy your own backend, client configuration

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy and cryptographic dependencies.

## License

[MIT](LICENSE)
