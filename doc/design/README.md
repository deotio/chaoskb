# Design

Technical design specifications for ChaosKB. These documents describe how the system works, not how to use it — see the [user guide](../user/) and [admin guide](../admin/) for that.

- [Overview](overview.md) — architecture, what the server knows, key properties
- [Cryptographic design](crypto.md) — security tiers, key hierarchy, encryption scheme, key rotation
- [Envelope specification](envelope-spec.md) — wire format, algorithms, test vectors
- [Client architecture](client-architecture.md) — on-device embedding, local search, sync protocol
- [Server architecture](server-architecture.md) — minimal encrypted storage API
  - [API](server/api.md) — REST endpoints, authentication, rate limiting
  - [Storage](server/storage.md) — DynamoDB schema, sync reliability, sizing
  - [Infrastructure](server/infrastructure.md) — CDK stack layout, cost estimate
- [MCP integration](mcp-integration.md) — how chat agents interact with the knowledge base
- [Threat model](threat-model.md) — what's protected, what's not, residual risks
- [Portability](portability.md) — data export, instance migration, shutdown guarantee
- [Self-hosting](self-hosting.md) — deploy your own backend, client configuration
