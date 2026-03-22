# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in chaoskb, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

Email: **security@chaoskb.com** (or use GitHub's private vulnerability reporting if available on this repository)

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what can an attacker do?)
- Suggested fix (if you have one)

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days
- **Fix or mitigation** within 30 days for critical issues
- **Credit** in the release notes (unless you prefer anonymity)

## Scope

The following are in scope for security reports:

- Cryptographic flaws (key leakage, nonce reuse, weak derivation)
- Authentication bypass
- Data leakage (plaintext exposed to server, metadata leakage beyond what's documented)
- Client-side vulnerabilities (key extraction, insecure storage)
- Supply chain issues (compromised dependencies)
- Server-side vulnerabilities (injection, authorization bypass)

The following are **out of scope**:

- Metadata leakage that is already documented in the [threat model](doc/design/threat-model.md) (timestamps, blob count, blob sizes)
- Standard tier's server-assisted recovery — this is a documented design trade-off, not a vulnerability
- Denial of service (unless it causes data loss)
- Social engineering

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | Yes                |
| < latest | Best effort       |

## Security Design

The full security design is documented in:

- [Cryptographic design](doc/design/crypto.md) — encryption scheme, key management, security tiers
- [Envelope specification](doc/design/envelope-spec.md) — wire format, algorithms, test vectors
- [Threat model](doc/design/threat-model.md) — what's protected and what isn't

## Cryptographic Dependencies

| Component | Desktop (Rust) | Mobile (Flutter) | Purpose |
|-----------|---------------|-------------------|---------|
| Encryption | `chacha20poly1305` crate | libsodium (Dart bindings) | XChaCha20-Poly1305, HMAC-SHA256 |
| Key derivation | `hkdf` + `argon2` crates | libsodium | HKDF-SHA256, Argon2id |
| Secure random | `rand::rngs::OsRng` | Platform CSPRNG | Nonce and key generation |
| Key storage | OS keyring (macOS Keychain / Linux Secret Service / Windows Credential Manager) | iOS Keychain / Android Keystore | Master key caching |

We do not implement cryptographic primitives. Desktop uses well-audited Rust crates from RustCrypto. Mobile uses libsodium's high-level API.
