# Cryptographic Design

## Design Principles

1. **Zero crypto knowledge required.** The default path must work without the user knowing what encryption is. No key files, no passphrases, no seed phrases during setup.
2. **Progressive disclosure.** Advanced options exist but are hidden behind settings. Users who need stronger security can opt in.
3. **Hard to lose data.** The default configuration favors recoverability over maximum security. This is a knowledge base of bookmarked articles, not a cryptocurrency wallet.
4. **Impossible to send plaintext.** Regardless of configuration, data is always encrypted before leaving the device. There is no "disable encryption" option.

---

## Security Tiers

Three tiers, from easiest to most secure. The user picks one during setup (defaulting to Standard). The tier can be changed later.

| Tier         | Encryption claim               | Setup experience            | Recovery              | Multi-device           | Who it's for                    |
| ------------ | ------------------------------ | --------------------------- | --------------------- | ---------------------- | ------------------------------- |
| **Standard** | End-to-end encrypted (SSH key-wrapped) | Tap "Get Started." Done. | SSH private key | QR code scan | Most users |
| **Enhanced** | End-to-end encrypted           | Write down a recovery key   | Recovery key OR SSH private key | QR code scan           | Privacy-conscious users         |
| **Maximum**  | End-to-end encrypted           | Create a passphrase         | Passphrase only       | Passphrase on each device | Journalists, activists, high-risk |

**Terminology note:** All three tiers are genuinely end-to-end encrypted — the server cannot access user data under any circumstances. In Standard tier, the master key is wrapped with the user's SSH public key; the server never has the SSH private key and therefore cannot unwrap the master key. In Enhanced tier, the master key is additionally encoded as a BIP39 mnemonic recovery key. In Maximum tier, the master key is derived from a user-chosen passphrase.

### Standard Tier (default)

The master key is generated randomly on-device and stored in the platform keystore. A wrapped copy of the master key is stored on the server, encrypted to the user's SSH public key. For Ed25519 keys, the public key is converted to X25519 via `crypto_sign_ed25519_pk_to_curve25519` and the master key is wrapped using `crypto_box_seal` (ephemeral X25519 ECDH + XSalsa20-Poly1305). For RSA keys, RSA-OAEP-SHA256 is used. The server never has the SSH private key and therefore cannot unwrap the master key.

```
Setup:  Tap "Get Started"
        → App generates 256-bit master key
        → Stores in iOS Keychain / Android Keystore
        → Converts user's SSH Ed25519 public key to X25519 (crypto_sign_ed25519_pk_to_curve25519)
        → Wraps master key with crypto_box_seal(x25519_pubkey, master_key)
        → Uploads wrapped key to server
        → Done. User sees nothing about keys.

Recover (new device):
        → User has their SSH private key (via ssh-agent or ~/.ssh/id_ed25519)
        → App downloads wrapped key from server
        → Converts Ed25519 private key to X25519 (crypto_sign_ed25519_sk_to_curve25519)
        → Unwraps with crypto_box_seal_open(x25519_sk, wrapped_key)
        → Master key restored. Sync begins.
```

**What this protects against:** Database breach (blobs are encrypted), network interception, and server operator access. The server operator cannot unwrap the master key because they do not have the user's SSH private key. This is genuinely end-to-end encrypted.

**What this does NOT protect against:** Loss of the SSH private key. If the user loses all copies of their SSH private key and all devices with the cached master key, data is unrecoverable. The SSH private key is the recovery factor.

**Trust model:** Standard tier does NOT trust the server operator. The server stores only the SSH-public-key-wrapped master key, which is useless without the corresponding private key. This is a genuine E2E encryption boundary, not just transport encryption. The server operator sees only opaque ciphertext for both the wrapped key and the data blobs.

**Why this works for the default tier:** SSH keys are ubiquitous among developers (the primary audience). Most users already have an Ed25519 or RSA key pair. The SSH private key never leaves the user's control — it is accessed via ssh-agent (`SSH_AUTH_SOCK`) or read from `~/.ssh/id_ed25519`. No passphrase to remember, no recovery key to write down, but genuinely E2E encrypted.

### Enhanced Tier

The master key is generated randomly on-device. The user writes down a recovery key (a human-readable encoding of the master key). Additionally, the master key is wrapped with the user's SSH public key (same mechanism as Standard tier) and uploaded to the server. Either the recovery key or the SSH private key can recover the master key.

```
Setup:  App generates 256-bit master key
        → Encodes as 24-word BIP39 mnemonic
        → Screen: "Write down these 24 words. You can also recover using
           your SSH key, but we recommend keeping the recovery key as a backup."
        → User confirms by entering 3 random words from the list
        → Key stored in platform keystore
        → Wraps master key with SSH public key (same as Standard tier)
        → Uploads SSH-wrapped key to server

Recover (new device) — Option A (recovery key):
        → User enters 24-word recovery key
        → App derives master key from mnemonic
        → Sync begins.

Recover (new device) — Option B (SSH key):
        → User has their SSH private key (via ssh-agent or ~/.ssh/id_ed25519)
        → App downloads SSH-wrapped key from server
        → Unwraps with SSH private key (same as Standard tier recovery)
        → Master key restored. Sync begins.
```

**What this adds:** Two independent recovery paths — the BIP39 mnemonic (offline, paper backup) and the SSH private key (digital, on the user's machines). Server compromise cannot recover the master key via either path. True E2E.

**Risk:** Lose the recovery key + lose the SSH private key + lose all devices = lose all data. Having two independent recovery factors significantly reduces the risk of total data loss compared to a single recovery key. The app shows a periodic reminder: "When did you last verify your recovery key is safe?"

### Maximum Tier

The master key is derived from a user-chosen passphrase via a memory-hard KDF. No recovery key, no server-stored wrapped key.

```
Setup:  User creates a passphrase (minimum 5 words / 25 characters, zxcvbn score ≥ 3)
        → App derives master key via Argon2id(passphrase, salt, t=3, m=64MB, p=1)
        → Salt stored on server (not secret, generated via CSPRNG, 16 bytes)
        → Key stored in platform keystore for session caching
        → Passphrase NOT stored anywhere

Argon2id parameters: t=3 (iterations), m=65536 KiB (64MB memory), p=1 (parallelism).
This exceeds OWASP 2023 minimum (m=19MB, t=2, p=1) by 3.3x memory and 1.5x time.
At 64MB/t=3, a single evaluation takes ~1-2 seconds on a modern phone.
Attacker estimate: 1000 GPUs at ~500 evals/sec each = 500k evals/sec total.
A 5-word diceware passphrase (~64 bits): ~1,100 years to brute force.
A 6-word diceware passphrase (~77 bits): ~5 billion years.

Recover (new device):
        → User enters passphrase
        → App fetches salt from server
        → Derives master key via Argon2id
        → Sync begins.

Re-auth (periodic, configurable):
        → App clears cached key from keystore after inactivity timeout
        → User re-enters passphrase to continue
```

**What this adds:** Even physical device theft with an unlocked phone doesn't give persistent access (key is cleared on timeout). Strongest protection against all server-side and device-theft threats.

**Risks:**
- Forgotten passphrase = permanent data loss. No recovery path exists.
- Weak passphrases are brute-forceable despite Argon2id. The app enforces a minimum of 5 words / 25 characters, requires a zxcvbn score ≥ 3, and displays estimated crack time. User-chosen passphrases that meet the character minimum but have low entropy (e.g., song lyrics, common phrases) are rejected.
- Argon2id at 64MB memory cost takes ~1-2 seconds on mobile. Noticeable at login but acceptable.
- Re-entering passphrase on every app open is annoying. The inactivity timeout is configurable (1 hour to 7 days).

---

## Key Hierarchy (All Tiers)

Regardless of how the master key is created or recovered, the rest of the hierarchy is the same.

```
Master Key (256-bit)
    │
    ├──► HKDF-SHA256(master, salt, "chaoskb-content")    → Content Key (CEK)
    ├──► HKDF-SHA256(master, salt, "chaoskb-metadata")   → Metadata Key (MEK)
    ├──► HKDF-SHA256(master, salt, "chaoskb-embedding")  → Embedding Key (EEK)
    └──► HKDF-SHA256(master, salt, "chaoskb-commit")     → Commitment Key (CKY)
```

Separate derived keys mean a compromise of one key class doesn't expose the others. HKDF derivation is deterministic — the same master key always produces the same derived keys.

### HKDF Mode and Salt Specification

All key derivation uses **HKDF-SHA256 in Extract+Expand mode** (RFC 5869):

1. **Extract phase:** `PRK = HMAC-SHA256(salt, master_key)` — produces a pseudorandom key from the master key and salt.
2. **Expand phase:** `OKM = HKDF-Expand(PRK, info, 32)` — expands the PRK with the context string (`"chaoskb-content"`, etc.) to produce the 32-byte derived key.

The `salt` parameter varies by tier:

| Tier | Salt value | Rationale |
|------|-----------|-----------|
| **Standard** | Empty byte string (`b""`) | Master key is generated from CSPRNG — already has full entropy. HKDF Extract with empty salt uses a zero-filled HMAC key per RFC 5869 §2.2. |
| **Enhanced** | Empty byte string (`b""`) | Same as Standard — master key is CSPRNG-generated. |
| **Maximum** | Argon2id output salt (16 bytes, stored on server) | The Argon2id salt is reused as the HKDF salt. Since Argon2id already performs extraction (mixing passphrase + salt into a uniform key), this is redundant but harmless and simplifies the design. |

**Important:** The `info` parameter (e.g., `"chaoskb-content"`) is the **context string**, not the salt. These are distinct HKDF inputs. Implementations must not confuse them — using the context string as the salt would produce non-deterministic keys if the salt is also set.

### Commitment Key

The Commitment Key (CKY) is used exclusively for key commitment HMACs in the envelope format. Using the same key for both AEAD encryption and HMAC commitment violates key separation. The CKY ensures that even if the AEAD key is compromised, the commitment cannot be forged with a different key, and vice versa.

---

## Encryption Scheme

**Algorithm:** XChaCha20-Poly1305 (authenticated encryption, nonce-misuse resistant)

Each field is encrypted independently:

```
Nonce (24 bytes, random) || Ciphertext || Auth Tag (16 bytes)
```

- Nonce: 24 bytes (192-bit), cryptographically random per encryption operation
- Poly1305 provides confidentiality + integrity (tamper detection) in one pass
- No separate HMAC needed

### Why XChaCha20-Poly1305 (not AES-256-GCM)

AES-256-GCM was the original choice but has a critical weakness: 96-bit nonces have a birthday-bound collision risk at ~2^48 encryptions, and a nonce reuse is catastrophic (leaks the auth key, enables plaintext recovery). XChaCha20-Poly1305 eliminates this:

- **192-bit nonces** make random collision probability negligible (~2^96 operations). No counter needed, no nonce management complexity.
- **Nonce reuse is still catastrophic.** If a nonce is reused, the XOR of plaintexts is exposed and Poly1305 forgery becomes possible — the same severity as GCM nonce reuse. The protection is the 192-bit nonce space making random collision negligible, not damage limitation if reuse occurs.
- **Available everywhere** via libsodium (iOS, Android, Node.js, Dart, Rust). libsodium is the most widely audited crypto library.
- **Faster on devices without AES hardware.** ChaCha20 is a software cipher — consistent performance regardless of hardware AES support.
- **256-bit key** provides post-quantum margin against Grover's algorithm (128-bit equivalent post-quantum security). See [Post-Quantum Considerations](#post-quantum-considerations) for the full analysis.

AES-256-GCM remains supported for decryption (forward compatibility with any blobs encrypted during development). The `alg` field in the envelope identifies which algorithm was used.

### Verify-After-Encrypt

Every encryption operation must prove the ciphertext is decryptable before the plaintext is discarded. The application never calls `encrypt()` directly — only `encryptAndVerify()`:

```
encryptAndVerify(key, plaintext):
  ciphertext = encrypt(key, plaintext)
  recovered  = decrypt(key, ciphertext)
  assert(constant_time_equals(recovered, plaintext))
  return ciphertext
```

If verification fails, the operation aborts and retries with a fresh nonce. This catches: serialization bugs, key caching errors, platform crypto library bugs, encoding mismatches. Used by 1Password and Standard Notes (adopted after a protocol migration caused data loss).

**Cost:** One extra decrypt per encrypt. At ChaCha20 speeds (~1 GB/s), this adds microseconds per blob.

### Constant-Time Comparisons

All comparisons involving secret values must use constant-time equality functions to prevent timing side-channel attacks:

| Context | Platform | Function |
|---------|----------|----------|
| Node.js | `crypto.timingSafeEqual()` |
| Dart | libsodium `sodium.crypto_verify_*()` |
| Swift | `CC_HMAC_compare` or Data `==` (constant-time by default in CryptoKit) |
| General | libsodium `sodium_memcmp()` |

This applies to: canary verification, verify-after-encrypt, SSH signature verification on the server, key commitment HMAC comparison. Variable-time comparison (e.g., `==` on byte arrays with early exit) leaks the number of matching prefix bytes through timing.

### Cryptographically Secure Random Number Generation

All random values (nonces, keys, salts, blob IDs) must come from platform-provided CSPRNGs:

| Platform | Source |
|----------|--------|
| Node.js | `crypto.randomBytes()` |
| Dart | libsodium `randombytes_buf()` or `Random.secure()` |
| Swift | `SecRandomCopyBytes()` |
| Android | `java.security.SecureRandom` (default provider, backed by `/dev/urandom`) |

Never use `Math.random()`, `Random()`, or any non-cryptographic PRNG. This is a hard rule — a single use of a weak PRNG for nonce generation would be catastrophic.

### Memory Protection for Key Material

Key material in memory must be protected against swap, crash dumps, and lingering after use:

- **Locked memory:** Use `sodium_malloc()` (libsodium) which calls `mlock()` / `VirtualLock()` to prevent key pages from being swapped to disk
- **Secure zeroing:** Use `sodium_memzero()` to overwrite key material immediately after use. Standard `memset` may be optimized away by the compiler.
- **Non-dumpable:** Where supported, mark key memory pages as excluded from core dumps
- **Mobile:** On iOS (Secure Enclave) and Android (StrongBox/TEE), hardware-backed key operations keep key material inside the secure element — it never enters application memory
- **Scope:** Applies to master key, derived keys (CEK, MEK, EEK), and any decrypted plaintext that contains other keys (e.g., unwrapped master key during recovery)

### Canonicalization

Before encrypting JSON plaintext, canonicalize it per RFC 8785 (JSON Canonicalization Scheme): sorted keys, no whitespace, deterministic number formatting. This prevents cross-platform serialization mismatches where the same logical data produces different bytes on different platforms (Standard Notes had exactly this bug in their 003 protocol).

```
plaintext_object → RFC 8785 canonical JSON bytes → encryptAndVerify
```

---

## Envelope Format

The server sees only an opaque ID, a timestamp, and ciphertext. All type information, relationships, and metadata are inside the encrypted payload. This minimizes metadata leakage — the server cannot distinguish a source blob from a chunk blob or determine the structure of the knowledge base.

### Envelope (all blob types)

```json
{
  "v": 1,
  "id": "b_7f3a9c2e1d4b8a",
  "ts": "2026-03-20T10:00:00Z",
  "enc": {
    "alg": "XChaCha20-Poly1305",
    "kid": "CEK",
    "ct": "<base64: nonce + ciphertext + tag>",
    "commit": "<base64: HMAC-SHA256(commit_key, id || nonce || ciphertext || auth_tag)>"
  }
}
```

- `v`: envelope version (integer). Enables schema evolution.
- `id`: opaque random identifier. No type prefix — the server cannot infer blob type.
- `ts`: server-generated timestamp. Inherent to the sync protocol (cannot be hidden).
- `enc.alg`: algorithm identifier. Supports cryptographic agility.
- `enc.kid`: key identifier. Supports key rotation.
- `enc.ct`: the ciphertext (nonce + encrypted data + auth tag).
- `enc.commit`: key commitment. `HMAC-SHA256(commit_key, id || nonce || ciphertext || auth_tag)` where `commit_key` is the dedicated Commitment Key (CKY), not the encryption key. Including the blob `id` prevents blob substitution attacks. This separation prevents multi-key attacks and follows key separation best practices. Verified before decryption.

### Decrypted Payload: Source

```json
{
  "type": "source",
  "url": "https://example.com/article",
  "title": "Introduction to Rust Ownership",
  "tags": ["rust", "programming"],
  "chunkCount": 12,
  "chunkIds": ["b_a1b2c3...", "b_d4e5f6...", ...]
}
```

### Decrypted Payload: Chunk

The chunk payload contains the content, embedding, and all relationship/model metadata — none of this is visible to the server.

```json
{
  "type": "chunk",
  "sourceId": "b_9f8e7d6c5b",
  "index": 0,
  "model": "snowflake-arctic-embed-s@384",
  "content": "In Rust, each value has a single owner...",
  "tokenCount": 487,
  "embedding": [0.0234, -0.0891, ...]
}
```

All relationship information (`sourceId`, `index`), model metadata, and content are encrypted. The `commit` field provides key commitment — HMAC binding prevents multi-key attacks where a ciphertext decrypts validly under different keys.

### Formal Specification

A byte-level envelope specification with test vectors will be published as a separate document (`envelope-spec.md`) before open-source release. This enables independent implementations and interoperability testing.

---

## Why Encrypt Embeddings?

Embeddings are not safe to leave unencrypted. Research has demonstrated embedding inversion attacks that can reconstruct approximate plaintext from embeddings. For a personal knowledge base, the URLs and titles alone could reveal sensitive browsing patterns. Encrypt everything.

---

## Key Storage

| Platform    | API                           | Hardware-backed | Notes                                   |
| ----------- | ----------------------------- | --------------- | --------------------------------------- |
| iOS         | Keychain Services             | Yes (Secure Enclave) | `kSecAttrAccessibleAfterFirstUnlock` |
| Android     | Android Keystore              | Yes (TEE/StrongBox)  | `setUserAuthenticationRequired(false)` for Standard/Enhanced |
| Desktop/CLI | OS keyring (libsecret/Keychain/Credential Manager) | Varies | Fallback: encrypted file `~/.chaoskb/key` encrypted with DPAPI (Windows) / libsecret (Linux) |

The platform keystore is a **convenience cache**, not the source of truth. Keystores can lose keys (factory reset, OS upgrade, biometric re-enrollment on some Android devices). The app must always have a fallback recovery path.

### Keystore Resilience

```
On every app open:
1. Try to read master key from platform keystore
2. If success: verify canary (see below). If canary passes, proceed.
3. If keystore read fails OR canary fails:
   a. Standard tier → download wrapped key from server, unwrap with SSH private key
   b. Enhanced tier → prompt for 24-word recovery key OR unwrap with SSH private key
   c. Maximum tier → prompt for passphrase
   d. Re-store master key in keystore for next time
4. NEVER show "data corrupted" when the real issue is "keystore key lost"
```

This handles: Android factory reset, OS upgrade invalidating keystore, Samsung/Knox key invalidation, iOS keychain items not included in certain backup types, device migration quirks.

### Key Derivation Canary

A known-plaintext blob encrypted with the **derived Content Key (CEK)**, verified before any operation. The canary uses CEK (not the raw master key) so that it validates the full key derivation pipeline — if HKDF derivation is wrong, the canary fails instead of silently passing while content decryption breaks.

```
CANARY_PLAINTEXT = "chaoskb-canary-v1"

On setup:
  cek = HKDF-SHA256(master_key, salt, "chaoskb-content")
  canary = encryptAndVerify(cek, CANARY_PLAINTEXT)
  store canary on server as a regular blob (opaque ID, kid: "CEK")

On unlock / sync / migration:
  cek = HKDF-SHA256(master_key, salt, "chaoskb-content")
  download canary blob
  result = decrypt(cek, canary)
  if result != CANARY_PLAINTEXT:
    STOP — key is wrong. Do not proceed.
    Fall back to recovery path (see Keystore Resilience above).
  else:
    Proceed.
```

This catches: wrong passphrase, corrupted KDF parameters, incorrect HKDF salt or info string, platform keystore returning the wrong key, key derivation serialization mismatches. Used by 1Password, Bitwarden, Signal (SQLCipher sentinel page), and Standard Notes.

### Maximum Tier: Session-Only Caching

In Maximum tier, the derived keys are held in memory only and optionally cached in the keystore with an expiry. After the inactivity timeout, the cache is cleared and the user must re-enter their passphrase. The master key itself is never stored — only re-derived from the passphrase.

---

## Multi-Device Key Transfer

For Standard and Enhanced tiers, adding a new device uses a QR code scanned from an existing device. The QR code is the out-of-band channel that prevents server MITM attacks.

```
Existing device                          New device
     │                                        │
     │  User taps "Add device"                │  User taps "Set up from existing device"
     │                                        │
     ├── Generate ephemeral X25519 keypair    │
     ├── Generate ephemeral ML-KEM-768 keypair│
     │                                        │
     ├── Display QR code containing:          ├── Scan QR code
     │   - X25519 public key (pubkey_A)       │    (optical channel — server never sees this)
     │   - ML-KEM-768 encaps key (ek_A)       │
     │   - device ID                          │
     │   - server endpoint                    │
     │                                        │
     │                                        ├── Generate ephemeral X25519 keypair
     │                                        ├── Compute X25519 shared secret from pubkey_A
     │                                        ├── Encapsulate ML-KEM-768 → (ciphertext_kem, ss_kem)
     │                                        ├── Combine: shared = HKDF(X25519_ss || ML-KEM_ss)
     │                                        │   (pubkey_A + ek_A came from QR, NOT from server)
     │                                        ├── Encrypt pubkey_B + ciphertext_kem with shared secret
     │  ◄──── New device sends encrypted payload via server relay ────
     │                                        │
     ├── Decrypt payload with shared secret   │
     ├── Decapsulate ML-KEM-768 ciphertext    │
     ├── Combine: shared = HKDF(X25519_ss || ML-KEM_ss)
     ├── Verify shared secrets match          │
     ├── Encrypt master key with shared secret│
     ├── Send encrypted master key via relay  ──────────────────────────►
     │                                        ├── Decrypt master key
     │                                        ├── Verify canary (confirms correct key)
     │                                        ├── Store in platform keystore
     │                                        ├── Begin sync
     │                                        │
     └── Show "Device added" confirmation     └── Show "Setup complete"
```

**Why the QR code prevents MITM:** The existing device's public key (`pubkey_A`) is transmitted optically via the QR code — the server never sees it. The server relay only passes ciphertext encrypted with a shared secret derived from `pubkey_A`. Even a fully compromised server cannot substitute its own public key because `pubkey_A` never passes through it. This is the same pattern used by Signal's device linking.

The ephemeral keypair provides forward secrecy — compromise of a future session doesn't expose past key transfers.

**Relay logging:** The server relay that passes the encrypted key transfer payload must not log request or response bodies for this operation. While the payload is encrypted and the server cannot decrypt it, logging encrypted blobs creates unnecessary exposure — a future compromise of the log store combined with a compromised QR code photograph could enable key recovery. Lambda CloudWatch log configuration should exclude request/response bodies globally (the server never needs to log them — all payloads are opaque ciphertext), and the key transfer relay endpoint should be explicitly flagged as sensitive in operational documentation.

For Maximum tier, multi-device setup requires entering the passphrase on each device. No QR transfer (the passphrase is the only key source).

---

## Post-Quantum Considerations

### Threat Model

A cryptographically relevant quantum computer (CRQC) running Shor's algorithm would break all elliptic curve cryptography, including X25519 (ECDH). Grover's algorithm halves the effective security of symmetric ciphers, reducing 256-bit keys to 128-bit equivalent — still far beyond brute-force.

The primary risk for ChaosKB is **harvest now, decrypt later (HNDL)**: an attacker captures encrypted key-transfer traffic today and decrypts it years later when a CRQC becomes available. This is a low-probability threat for a personal knowledge base of bookmarked articles, but the fix is straightforward and the cost is minimal.

### Current Timeline Estimates

NIST and the broader cryptographic community estimate CRQCs capable of breaking current public-key cryptography are 10-20+ years away (as of 2026). However:
- Migration timelines for cryptographic standards are long (5-10 years)
- "Harvest now, decrypt later" attacks begin today, not when the quantum computer arrives
- NIST finalized post-quantum standards in 2024 (FIPS 203/204/205), signaling the transition should begin

### What's Already Quantum-Safe

| Primitive | Quantum impact | Status |
|-----------|---------------|--------|
| XChaCha20-Poly1305 (256-bit) | Grover reduces to 128-bit equivalent | **Safe** — 128-bit security is sufficient |
| HKDF-SHA256 | Grover reduces collision resistance to 128-bit | **Safe** |
| HMAC-SHA256 | Grover reduces to 128-bit | **Safe** |
| Argon2id | Memory-hard; quantum speedup is minimal against memory-bound problems | **Safe** |

### What Needs Protection: Key Transfer (X25519)

The QR-code multi-device key transfer uses X25519 (ECDH), which Shor's algorithm breaks completely. ChaosKB uses a **hybrid key exchange** that combines X25519 with ML-KEM-768 (FIPS 203, formerly Kyber):

```
shared_secret = HKDF-SHA256(
    ikm = X25519_shared_secret || ML-KEM_shared_secret,
    salt = "",
    info = "chaoskb-key-transfer"
)
```

**Why hybrid (not pure ML-KEM):** ML-KEM is new. If a classical attack is found against it, X25519 still protects the exchange. If a quantum computer breaks X25519, ML-KEM still protects. Both must be broken simultaneously to compromise the key transfer. This is the approach adopted by Signal (PQXDH), Chrome/TLS, Apple iMessage (PQ3), and Wire.

**ML-KEM-768 parameters:**

| Property | Value |
|----------|-------|
| NIST security level | 3 (equivalent to AES-192) |
| Public key size | 1,184 bytes |
| Ciphertext size | 1,088 bytes |
| Shared secret size | 32 bytes |

The QR code size increases from ~100 bytes (X25519 only) to ~1,300 bytes (X25519 + ML-KEM encapsulation key). This is well within QR code capacity (version 25 holds ~2,000 bytes at medium error correction). The QR code density increases but remains scannable on modern phone cameras.

### What Doesn't Need Protection

- **Encrypted blobs at rest:** Protected by XChaCha20-Poly1305 (256-bit symmetric). Quantum-safe.
- **HKDF key derivation:** Symmetric. Quantum-safe.
- **Argon2id (Maximum tier):** Memory-hard. Quantum-safe.
- **Server API authentication:** Uses SSH signatures (Ed25519 or RSA). The SSH signature itself is not quantum-vulnerable at rest — it authenticates a single request. A future quantum computer could forge Ed25519 signatures, but this is a real-time attack (must forge during the 5-minute replay window), not a harvest-now-decrypt-later risk. TLS itself is transitioning to post-quantum independently — this is outside ChaosKB's scope.

### Implementation Notes

- **Library:** `ml-kem` crate (Rust), `liboqs` (C, via FFI for Flutter/Dart), or `pqcrypto` (cross-platform)
- **Fallback:** If the receiving device doesn't support ML-KEM (old client version), fall back to X25519-only. The QR code includes a version byte indicating which key exchange modes are supported.
- **Key sizes:** ML-KEM-768 adds ~1.2 KB to the QR code payload and ~1 KB to the relay message. Negligible for a one-time key transfer operation.

---

## Key Rotation

If the user suspects their key is compromised (e.g., lost a device), they can rotate the master key.

**Critical: never overwrite blobs in place during rotation.** Write new blobs alongside old ones, verify, then delete old.

```
1. Generate new master key
2. Derive new CEK, MEK, EEK
3. Encrypt new canary with new key, verify it
4. Migration smoke test: pick 3 random blobs, decrypt with old key,
   re-encrypt with new key, verify-after-encrypt. If any fail, abort.
5. For each blob on the server:
   a. Download and decrypt with old key
   b. Re-encrypt with new key (encryptAndVerify)
   c. Upload as NEW blob (new ID = old ID + "_rotated")
   d. Do NOT delete old blob yet
6. After ALL blobs re-encrypted:
   a. Verify: count(new blobs) == count(old blobs)
   b. Spot-check: decrypt 10 random new blobs, compare to originals
   c. Upload new canary
   d. Atomically swap: update source blobs to reference new chunk IDs
   e. Mark old blobs for deletion (45-day retention as safety net; DynamoDB TTL may fire up to 48 hours late)
7. Revoke old wrapped key (Standard tier)
8. Update all devices (QR scan or passphrase re-entry)

Rollback: if rotation fails at any step, delete new blobs, keep old ones.
Old key remains valid until step 7.
```

### Key Rotation Coordination (Multi-Device)

If two devices initiate key rotation simultaneously, each generates a new key and re-encrypts blobs. Blobs become split between two keys that neither device fully has. After the 45-day TTL deletes old blobs, data encrypted with the "losing" key is permanently lost.

**Server-side coordination protocol:**

1. **Rotation lock:** Before starting rotation, the client writes a `rotation_in_progress` metadata blob to the server with its device ID and a lease TTL (e.g., 1 hour). The write uses a conditional expression (`attribute_not_exists`) — if another device already holds the lock, the write fails and the client must wait.
2. **Pre-rotation check:** Before starting, the client checks for any blobs encrypted with an unknown `kid` (key version). If found, another device has partially rotated — the client must sync and resolve before proceeding.
3. **Key versioning:** Each blob's `kid` field includes a version suffix (e.g., `CEK:v2`). During rotation, new blobs are written with the new version. After rotation completes, the client scans for blobs with the old version and re-encrypts them.
4. **Lock release:** After rotation completes (or on failure/timeout), the client deletes the lock blob.

This is a heavyweight operation (~same cost as model migration). For most threat scenarios, revoking the compromised SSH key (removing it from the server's registered keys) is sufficient — the encrypted blobs remain safe even if the old SSH public key is known, since the attacker would need the private key to unwrap the master key.

---

## Upgrade and Downgrade Between Tiers

Users can change security tiers. Upgrades that increase risk of data loss include safety measures.

| Transition              | What happens                                           |
| ----------------------- | ------------------------------------------------------ |
| Standard → Enhanced     | Generate recovery key from existing master key. Delete wrapped key from server. |
| Standard → Maximum      | **See upgrade safety flow below.** |
| Enhanced → Standard     | Upload wrapped master key to server. Recovery key remains valid (user should destroy it if they don't want a second recovery path). |
| Enhanced → Maximum      | **See upgrade safety flow below.** |
| Maximum → Standard      | Upload wrapped key derived from current passphrase-derived master key. |
| Maximum → Enhanced      | Generate recovery key from current master key. |

### Upgrade to Maximum: Safety Flow

Upgrading to Maximum generates a new passphrase-derived master key and re-encrypts all data. If the user forgets the passphrase, everything is lost — including data from before the upgrade. This requires extra safeguards:

```
1. Explain consequences clearly:
   "If you forget your passphrase, ALL data is permanently lost.
    There is no recovery. This cannot be undone after 24 hours."

2. Offer encrypted backup export before proceeding
   (self-contained file with separate passphrase — see backup export)

3. User creates passphrase (minimum 5 words / 25 characters, zxcvbn score ≥ 3)
   Show strength estimate: "Would take ~X years to crack"

4. User re-enters passphrase to confirm

5. 24-HOUR COOLING-OFF PERIOD begins (server-enforced):
   ├── New passphrase-derived key is generated
   ├── New blobs are written alongside old blobs (never overwrite)
   ├── Client writes an upgrade-state metadata blob to the server:
   │   { "upgrade_started": "2026-03-20T10:00:00Z", "old_tier": "standard", "new_tier": "maximum" }
   ├── Server rejects DELETE requests for old-key blobs while upgrade state exists
   │   and the 24-hour window has not elapsed (server checks the timestamp)
   ├── Old key remains valid — user can cancel the upgrade
   └── App shows: "Upgrade in progress. Cancel before [time] to revert."

6. After 24 hours (if not cancelled):
   ├── Client sends explicit confirmation (deletes upgrade-state blob)
   ├── Server now allows deletion of old-key blobs
   ├── Verify all new blobs decrypt correctly
   ├── Delete old blobs and old wrapped key
   └── Upgrade is final

7. First-week daily reminder:
   "You upgraded to Maximum security on March 20.
    Your passphrase is the only way to access your data."
```

The cooling-off period is critical. It gives the user time to realize they've made a mistake before the old key is gone. Cancelling during the cooling-off period deletes the new blobs and restores the previous tier — no data is affected.

---

## Best-Practice Checklist

### Cryptographic Primitives
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| Nonce-misuse resistant encryption (XChaCha20-Poly1305, 192-bit nonces) | Yes |
| Key commitment (HMAC-SHA256 with separate commitment key, prevents multi-key attacks) | Yes |
| Key derivation via HKDF-SHA256 Extract+Expand (salt and info specified per tier) | Yes   |
| Memory-hard KDF for passphrases (Argon2id, 64MB, exceeds OWASP minimum) | Yes |
| Separate derived keys per data class (CEK, MEK, EEK, CKY) | Yes |
| CSPRNG for all random values (nonces, keys, salts, IDs) | Yes |
| Constant-time comparisons for all secret values   | Yes     |

### Key Management
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| Key derivation canary (uses CEK, validates full derivation pipeline) | Yes |
| Hardware-backed key storage where available        | Yes     |
| Platform keystore treated as cache, not source of truth | Yes |
| Memory protection for key material (mlock, secure zero) | Yes |
| Forward secrecy on key transfer (ephemeral ECDH)  | Yes     |
| Post-quantum hybrid key exchange (X25519 + ML-KEM-768) | Yes |
| QR code as out-of-band channel (prevents server MITM on key transfer) | Yes |
| No master-key-derived material sent to server (SSH signatures only) | Yes |

### Data Protection
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| Verify-after-encrypt on every encryption operation | Yes   |
| JSON canonicalization before encryption (RFC 8785) | Yes   |
| Opaque blob IDs (no type prefixes, no metadata leakage) | Yes |
| All metadata encrypted (type, relationships, model inside ciphertext) | Yes |
| Embeddings encrypted (inversion attack defense)   | Yes     |
| No plaintext ever sent to server                  | Yes     |
| Never overwrite blobs during migration/rotation   | Yes     |
| Soft delete with encrypted trash (at least 30-day recovery window) | Yes     |
| Migration smoke test before bulk re-encryption    | Yes     |

### Envelope and Protocol
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| Version field in envelope (supports evolution)    | Yes     |
| Algorithm identifier in envelope (supports agility) | Yes   |
| Key identifier in envelope (supports rotation)    | Yes     |
| AAD binds envelope metadata to ciphertext (prevents blob substitution) | Yes |
| Pre-decryption size validation (ct length ≥ nonce + tag + 1) | Yes |
| All tiers are genuinely E2E (Standard uses SSH key wrapping) | Yes |
| Standard tier documents SSH key as recovery factor | Yes |
| API versioning (/v1/blobs)                        | Yes     |

### Operational Safety
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| 24-hour cooling-off period for Maximum tier upgrade (server-enforced) | Yes   |
| Key rotation coordination lock (prevents concurrent rotation) | Yes |
| Encrypted backup export (server-independent)      | Yes     |
| Passphrase strength enforcement (zxcvbn ≥ 3, 5+ words, crack-time estimate) | Yes |
| Periodic recovery key reminder (Enhanced tier)    | Yes     |

### Supply Chain and Open Source
| Practice                                         | Status  |
| ------------------------------------------------ | ------- |
| Pinned dependency versions with integrity hashes  | Yes     |
| ONNX model verified by hard-coded SHA-256 hash    | Yes     |
| Formal envelope specification with test vectors   | Yes — [envelope-spec.md](envelope-spec.md) |
| SECURITY.md with responsible disclosure policy    | Yes — [SECURITY.md](../../SECURITY.md) |

