# Envelope Specification v1

Formal specification for the chaoskb encrypted blob format. This document enables independent implementations and interoperability testing.

## Wire Format

Every blob stored on the server is a JSON object with this exact structure:

```
{
  "v":   <integer>,
  "id":  <string>,
  "ts":  <string>,
  "enc": {
    "alg":    <string>,
    "kid":    <string>,
    "ct":     <string>,
    "commit": <string>
  }
}
```

The JSON is encoded as UTF-8 with no BOM. Whitespace between fields is optional (the server stores whatever the client sends).

**Format efficiency note:** The JSON + base64 wire format adds ~33% overhead from base64 encoding. At the current scale (~50k blobs, ~4.5 KB each), this amounts to ~75 MB of overhead — acceptable. The `v` field enables future evolution to a more compact format (e.g., CBOR with raw binary ciphertext) if storage efficiency becomes a concern at scale.

## Field Definitions

### Top-Level Fields

| Field | Type    | Required | Description |
|-------|---------|----------|-------------|
| `v`   | integer | Yes      | Envelope version. Must be `1` for this specification. |
| `id`  | string  | Yes      | Opaque blob identifier. 16+ bytes of CSPRNG output, base62-encoded, prefixed with `b_`. Example: `b_7f3a9c2e1d4b8a`. No type information. |
| `ts`  | string  | Yes      | ISO 8601 timestamp with timezone. Server-generated. Example: `2026-03-20T10:00:00Z`. |
| `enc` | object  | Yes      | Encryption envelope. |

### Encryption Envelope Fields

| Field    | Type   | Required | Description |
|----------|--------|----------|-------------|
| `alg`    | string | Yes      | Algorithm identifier. See Algorithm Registry below. |
| `kid`    | string | Yes      | Key identifier. Identifies which derived key was used. See Key Identifiers below. |
| `ct`     | string | Yes      | Base64-encoded ciphertext: `nonce || ciphertext || auth_tag`. |
| `ct.len` | integer | Yes     | Byte length of the decoded `ct` value (before base64). Verified before decryption to catch truncated downloads. |
| `commit` | string | Yes      | Base64-encoded key commitment: `HMAC-SHA256(commit_key, id || nonce || ciphertext || auth_tag)` where `commit_key = HKDF-SHA256(master, salt, "chaoskb-commit")`. The blob `id` is included to prevent blob substitution attacks. |

## Algorithm Registry

| `alg` value               | Nonce size | Tag size | Key size | Status    |
|---------------------------|-----------|----------|----------|-----------|
| `XChaCha20-Poly1305`      | 24 bytes  | 16 bytes | 256 bits | Default   |
| `AES-256-GCM`             | 12 bytes  | 16 bytes | 256 bits | Decrypt-only (legacy) |

Implementations must support decryption of all registered algorithms. Encryption must use the default algorithm.

## Key Identifiers

| `kid` value | Derived key                                    | Used for          |
|-------------|------------------------------------------------|-------------------|
| `CEK`       | `HKDF-SHA256(master, salt, "chaoskb-content")` | Chunk content + embedding, general blobs, canary |
| `MEK`       | `HKDF-SHA256(master, salt, "chaoskb-metadata")`| Source metadata    |
| `EEK`       | `HKDF-SHA256(master, salt, "chaoskb-embedding")`| Reserved (future: separate embedding encryption) |

The **Commitment Key** (`CKY = HKDF-SHA256(master, salt, "chaoskb-commit")`) is not a `kid` value — it is never used for encryption. It is used exclusively for the `commit` HMAC field. This key separation ensures the encryption key and commitment key cannot be confused.

In v1, chunk blobs encrypt both content and embedding in a single `enc` field using `CEK`. The `EEK` key identifier is reserved for a future version that may encrypt content and embeddings separately.

The canary blob uses `kid: "CEK"` to validate the full key derivation pipeline (HKDF from master key), not the raw master key.

## Ciphertext Layout (`ct` field, after base64 decode)

```
Byte 0                 Byte N         Byte N+C           Byte N+C+T
┌──────────────────┬──────────────┬──────────────────┐
│  Nonce (N bytes) │  Ciphertext  │  Auth Tag (T)    │
└──────────────────┴──────────────┴──────────────────┘
```

Where N and T are determined by the `alg`:
- `XChaCha20-Poly1305`: N=24, T=16
- `AES-256-GCM`: N=12, T=16

## Key Commitment Layout (`commit` field, after base64 decode)

```
HMAC-SHA256(commit_key, id_bytes || nonce || ciphertext || auth_tag)
```

Where:
- `commit_key = HKDF-SHA256(master, salt, "chaoskb-commit")` — a dedicated key, separate from the encryption key
- `id_bytes` = the blob `id` string encoded as UTF-8 bytes (e.g., `b_7f3a9c2e1d4b8a`)
- `nonce || ciphertext || auth_tag` = the raw bytes of the `ct` field (before base64 encoding)

Output: 32 bytes. Including the blob ID in the HMAC input binds the ciphertext to its identifier, preventing blob substitution attacks where a malicious server swaps blobs between IDs.

## Associated Authenticated Data (AAD)

AEAD encryption binds unencrypted envelope fields to the ciphertext via AAD. Any tampering with the outer fields (version, blob ID, algorithm, key identifier) causes decryption to fail.

**AAD construction:**

```
AAD = canonical_json({"alg": enc.alg, "id": id, "kid": enc.kid, "v": v})
```

The AAD is the RFC 8785 canonical JSON of the four fields: `alg`, `id`, `kid`, `v` (sorted keys, no whitespace). The `ts` field is excluded because it is server-generated and may change during re-upload without re-encryption.

**What AAD prevents:**
- **Blob substitution:** Swapping ciphertext between blob IDs fails because the `id` in AAD won't match
- **Version downgrade:** Changing `v` fails because it's bound to the ciphertext
- **Algorithm confusion:** Changing `alg` fails because it's bound to the ciphertext
- **Key identifier swap:** Changing `kid` fails because it's bound to the ciphertext

## Decryption Procedure

```
1. Parse JSON envelope
2. Check v == 1 (reject unknown versions)
3. Decode enc.ct from base64 → raw bytes
4. Verify size: len(raw_ct_bytes) >= nonce_size + tag_size + 1 (per enc.alg)
   - XChaCha20-Poly1305: len >= 24 + 16 + 1 = 41
   - If too short: reject with "truncated ciphertext" error
5. If enc["ct.len"] is present: verify len(raw_ct_bytes) == enc["ct.len"]
   - If mismatch: reject with "ciphertext length mismatch" error
6. Decode enc.commit from base64 → raw bytes
7. Look up encryption key by enc.kid, and derive commit_key from master key
8. Verify key commitment:
   expected = HMAC-SHA256(commit_key, id_bytes || raw_ct_bytes)
   constant_time_equals(expected, commit) → must be true
9. Construct AAD: canonical_json({"alg": enc.alg, "id": id, "kid": enc.kid, "v": v})
10. Split raw_ct_bytes into nonce, ciphertext, auth_tag (sizes per enc.alg)
11. Decrypt: plaintext = AEAD_Decrypt(key, nonce, ciphertext, auth_tag, aad=AAD)
    - If decryption fails (auth tag mismatch): reject
12. Parse plaintext as UTF-8 JSON
```

## Encryption Procedure

```
1. Serialize plaintext object to canonical JSON (RFC 8785)
2. Convert to UTF-8 bytes
3. Generate opaque blob ID (16+ bytes CSPRNG, base62, prefix "b_")
4. Generate random nonce (24 bytes from CSPRNG for XChaCha20-Poly1305)
5. Construct AAD: canonical_json({"alg": "XChaCha20-Poly1305", "id": blob_id, "kid": kid, "v": 1})
6. Encrypt: ciphertext || auth_tag = AEAD_Encrypt(key, nonce, plaintext_bytes, aad=AAD)
7. Concatenate: raw_ct = nonce || ciphertext || auth_tag
8. Compute key commitment: commit = HMAC-SHA256(commit_key, id_bytes || raw_ct)
   where commit_key = HKDF-SHA256(master, salt, "chaoskb-commit")
9. Verify round-trip:
   a. Decrypt raw_ct with key and AAD → recovered_bytes
   b. constant_time_equals(recovered_bytes, plaintext_bytes) → must be true
   c. If false: abort, retry with fresh nonce
10. Base64-encode raw_ct → enc.ct
11. Set enc["ct.len"] = len(raw_ct) (byte length before base64)
12. Base64-encode commit → enc.commit
13. Assemble JSON envelope
```

Note: the blob ID must be generated before encryption (step 3) because it is included in both the AAD and the key commitment HMAC.

## Plaintext Payload Schemas

The decrypted plaintext is always a canonical JSON object (RFC 8785). The `type` field identifies the payload schema.

### Source Payload

```json
{
  "chunkCount": 12,
  "chunkIds": ["b_a1b2c3d4e5", "b_f6g7h8i9j0"],
  "tags": ["rust", "programming"],
  "title": "Introduction to Rust Ownership",
  "type": "source",
  "url": "https://example.com/article"
}
```

Note: keys are sorted (RFC 8785 canonicalization).

| Field       | Type     | Required | Description |
|-------------|----------|----------|-------------|
| `type`      | string   | Yes      | Must be `"source"` |
| `url`       | string   | Yes      | Original URL |
| `title`     | string   | No       | Extracted title |
| `tags`      | string[] | No       | User-assigned tags |
| `chunkCount`| integer  | Yes      | Number of chunks |
| `chunkIds`  | string[] | Yes      | Blob IDs of associated chunks |

### Chunk Payload

```json
{
  "content": "In Rust, each value has a single owner...",
  "embedding": [0.0234, -0.0891, 0.0412],
  "index": 0,
  "model": "snowflake-arctic-embed-s@384",
  "sourceId": "b_9f8e7d6c5b",
  "tokenCount": 487,
  "type": "chunk"
}
```

| Field       | Type     | Required | Description |
|-------------|----------|----------|-------------|
| `type`      | string   | Yes      | Must be `"chunk"` |
| `sourceId`  | string   | Yes      | Blob ID of the parent source |
| `index`     | integer  | Yes      | Zero-based position within the source |
| `model`     | string   | Yes      | Embedding model identifier: `{name}@{dims}` |
| `content`   | string   | Yes      | Chunk text (UTF-8) |
| `tokenCount`| integer  | Yes      | Approximate token count |
| `embedding` | number[] | Yes      | Float32 embedding vector |

### Canary Payload

```json
{
  "type": "canary",
  "value": "chaoskb-canary-v1"
}
```

| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `type`  | string | Yes      | Must be `"canary"` |
| `value` | string | Yes      | Must be `"chaoskb-canary-v1"` |

**Known-plaintext note:** The canary plaintext (`"chaoskb-canary-v1"`) is static and well-known. For Standard and Enhanced tiers (CSPRNG-generated master key with 256 bits of entropy), this is not exploitable — brute-forcing a 256-bit key is infeasible regardless of known plaintext. For Maximum tier (passphrase-derived key), the canary provides a decryption oracle for offline brute-force: an attacker can try passphrases, derive keys, and check if the canary decrypts to the known value. However, this provides no advantage beyond what any blob's AEAD authentication tag already provides — a failed decryption attempt (wrong key) is detectable from the Poly1305 tag without needing known plaintext. The Argon2id parameters (64 MB memory, t=3) make brute-force expensive regardless.

## Blob ID Generation

```
1. Generate 16 bytes from CSPRNG
2. Encode as base62 (characters: 0-9, a-z, A-Z)
3. Prefix with "b_"
```

Result: `b_` + 21-22 characters. Example: `b_7f3a9c2e1d4b8aXyZ`.

Blob IDs must not encode type information. The server must not be able to distinguish a source blob from a chunk blob or a canary blob by its ID.

## Version Negotiation

If a client encounters `"v": 2` (or higher) in an envelope:
1. Do not attempt to decrypt
2. Log a warning: "Unsupported envelope version"
3. Prompt the user to update the app
4. Do not delete or modify the blob

This ensures forward compatibility — a newer client can write v2 blobs that older clients safely ignore.

## Test Vectors

Fixed key and nonce for reproducible test outputs. **These values are for testing only — never use fixed nonces in production.**

### Input

```
Master Key (hex):    000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f

HKDF mode:           Extract+Expand (RFC 5869)
HKDF salt (hex):     (empty — zero-length byte string, per Standard/Enhanced tier)
HKDF info (CEK):     "chaoskb-content"
HKDF info (CKY):     "chaoskb-commit"
Derived CEK (hex):   [implementors: compute and verify against reference implementation]
Derived CKY (hex):   [implementors: compute and verify against reference implementation]

Blob ID:             "b_test000000000000"

Plaintext (canonical JSON):
{"type":"canary","value":"chaoskb-canary-v1"}

AAD (canonical JSON):
{"alg":"XChaCha20-Poly1305","id":"b_test000000000000","kid":"CEK","v":1}

Fixed nonce (hex):   000000000000000000000000000000000000000000000000
```

### Verification Steps

Implementors must verify:

1. **CEK derivation:** `HKDF-SHA256(Extract+Expand, salt=b"", ikm=master_key, info="chaoskb-content", len=32)` produces the expected CEK.
2. **CKY derivation:** `HKDF-SHA256(Extract+Expand, salt=b"", ikm=master_key, info="chaoskb-commit", len=32)` produces the expected CKY.
3. **Encryption with AAD:** `AEAD_Encrypt(CEK, nonce, plaintext, aad=AAD)` produces the expected ciphertext.
4. **Key commitment:** `HMAC-SHA256(CKY, "b_test000000000000" || nonce || ciphertext || auth_tag)` produces the expected commit value.
5. **ct.len** matches the byte length of `nonce || ciphertext || auth_tag`.

If your outputs match a reference implementation, your crypto layer is interoperable.

### Maximum Tier Test Vector

```
Passphrase:          "correct horse battery staple extra"
Argon2id salt (hex): b0b1b2b3b4b5b6b7b8b9babbbcbdbebf
Argon2id params:     t=3, m=65536, p=1
Master Key (hex):    (compute Argon2id with above inputs)

HKDF salt (hex):     b0b1b2b3b4b5b6b7b8b9babbbcbdbebf  (same as Argon2id salt)
HKDF info (CEK):     "chaoskb-content"
Derived CEK (hex):   [implementors: compute and verify against reference implementation]
```

This vector validates the full Maximum tier pipeline: passphrase → Argon2id → master key → HKDF (with Argon2id salt) → CEK.

A full set of test vectors (including source and chunk payloads, edge cases with emoji and empty strings, and cross-platform fixtures) will be published alongside the reference implementation.

**Reference implementation requirement:** A reference implementation (in Rust, using the `hkdf` and `chacha20poly1305` crates) must be published before open-source release. This implementation will output the concrete hex values for all test vectors. Implementors on other platforms (Dart, Swift, Node.js) verify their outputs match the reference. Without concrete expected values, cross-platform interoperability cannot be validated — this is the single highest-priority item for the pre-release checklist.
