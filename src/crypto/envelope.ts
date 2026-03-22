import { aeadDecrypt, aeadEncrypt } from './aead.js';
import { constructAAD } from './aad.js';
import { generateBlobId } from './blob-id.js';
import { canonicalJson } from './canonical-json.js';
import { computeCommitment, verifyCommitment } from './commitment.js';
import type {
  Algorithm,
  DerivedKeySet,
  DecryptResult,
  EncryptResult,
  Envelope,
  KeyId,
  Payload,
} from './types.js';

// Algorithm parameters: nonce size and tag size
const ALG_PARAMS: Record<Algorithm, { nonceSize: number; tagSize: number }> = {
  'XChaCha20-Poly1305': { nonceSize: 24, tagSize: 16 },
  'AES-256-GCM': { nonceSize: 12, tagSize: 16 },
};

/**
 * Look up the encryption key for a given key identifier.
 */
function getKey(keys: DerivedKeySet, kid: KeyId): Uint8Array {
  switch (kid) {
    case 'CEK':
      return new Uint8Array(keys.contentKey.buffer);
    case 'MEK':
      return new Uint8Array(keys.metadataKey.buffer);
    case 'EEK':
      return new Uint8Array(keys.embeddingKey.buffer);
    default:
      throw new Error(`Unknown key identifier: ${kid}`);
  }
}

/**
 * Encrypt a payload into an envelope (v1).
 *
 * Steps per the envelope spec:
 *  1. Serialize payload to canonical JSON, convert to UTF-8 bytes
 *  2. Generate blob ID
 *  3. Select key by kid (default CEK)
 *  4. Construct AAD
 *  5. Encrypt with AEAD
 *  6. Concatenate: rawCt = nonce || ciphertext || tag
 *  7. Compute commitment: HMAC-SHA256(commitKey, blobId || rawCt)
 *  8. Verify-after-encrypt: decrypt rawCt, compare with original plaintext
 *  9. Base64-encode ct and commit
 * 10. Assemble Envelope object
 * 11. Return EncryptResult with envelope and serialized JSON bytes
 */
export function encryptPayload(
  payload: Payload,
  keys: DerivedKeySet,
  kid: KeyId = 'CEK',
): EncryptResult {
  const alg: Algorithm = 'XChaCha20-Poly1305';

  // 1. Serialize to canonical JSON
  const json = canonicalJson(payload as unknown as Record<string, unknown>);
  const plaintextBytes = new TextEncoder().encode(json);

  // 2. Generate blob ID
  const blobId = generateBlobId();

  // 3. Select encryption key
  const encKey = getKey(keys, kid);

  // 4. Construct AAD
  const aad = constructAAD(alg, blobId, kid, 1);

  // 5. Encrypt
  const { nonce, ciphertext, tag } = aeadEncrypt(encKey, plaintextBytes, aad);

  // 6. Concatenate: rawCt = nonce || ciphertext || tag
  const rawCt = new Uint8Array(nonce.length + ciphertext.length + tag.length);
  rawCt.set(nonce, 0);
  rawCt.set(ciphertext, nonce.length);
  rawCt.set(tag, nonce.length + ciphertext.length);

  // 7. Compute key commitment
  const commitKey = new Uint8Array(keys.commitKey.buffer);
  const commitment = computeCommitment(commitKey, blobId, rawCt);

  // 8. Verify-after-encrypt: decrypt and compare
  const recovered = aeadDecrypt(encKey, nonce, ciphertext, tag, aad);
  if (!constantTimeEqual(recovered, plaintextBytes)) {
    throw new Error('Verify-after-encrypt failed: decrypted plaintext does not match original');
  }

  // 9. Base64-encode
  const ctBase64 = Buffer.from(rawCt).toString('base64');
  const commitBase64 = Buffer.from(commitment).toString('base64');

  // 10. Assemble envelope
  const envelope: Envelope = {
    v: 1,
    id: blobId,
    ts: new Date().toISOString(),
    enc: {
      alg,
      kid,
      ct: ctBase64,
      'ct.len': rawCt.length,
      commit: commitBase64,
    },
  };

  // 11. Serialize envelope to bytes
  const envelopeJson = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(envelopeJson);

  return { envelope, bytes };
}

/**
 * Decrypt an envelope into a payload.
 *
 * Steps per the envelope spec:
 *  1. Check v == 1
 *  2. Base64-decode ct
 *  3. Verify ct.len matches decoded length
 *  4. Verify key commitment
 *  5. Construct AAD
 *  6. Split rawCt into nonce, ciphertext, tag
 *  7. Decrypt
 *  8. Parse plaintext as JSON, validate type field
 *  9. Return DecryptResult
 */
export function decryptEnvelope(envelope: Envelope, keys: DerivedKeySet): DecryptResult {
  // 1. Check version
  if (envelope.v !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.v}. Please update the app.`);
  }

  const alg = envelope.enc.alg;
  const params = ALG_PARAMS[alg];
  if (!params) {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  // 2. Base64-decode ct
  const rawCt = new Uint8Array(Buffer.from(envelope.enc.ct, 'base64'));

  // Verify minimum length
  const minLength = params.nonceSize + params.tagSize + 1;
  if (rawCt.length < minLength) {
    throw new Error(`Truncated ciphertext: expected at least ${minLength} bytes, got ${rawCt.length}`);
  }

  // 3. Verify ct.len
  if (envelope.enc['ct.len'] !== undefined && rawCt.length !== envelope.enc['ct.len']) {
    throw new Error(
      `Ciphertext length mismatch: ct.len=${envelope.enc['ct.len']}, actual=${rawCt.length}`,
    );
  }

  // 4. Verify key commitment
  const commitKey = new Uint8Array(keys.commitKey.buffer);
  const expectedCommit = new Uint8Array(Buffer.from(envelope.enc.commit, 'base64'));
  if (!verifyCommitment(commitKey, envelope.id, rawCt, expectedCommit)) {
    throw new Error('Key commitment verification failed');
  }

  // 5. Construct AAD
  const aad = constructAAD(alg, envelope.id, envelope.enc.kid, envelope.v);

  // 6. Split rawCt into nonce, ciphertext, tag
  const nonce = rawCt.slice(0, params.nonceSize);
  const ciphertext = rawCt.slice(params.nonceSize, rawCt.length - params.tagSize);
  const tag = rawCt.slice(rawCt.length - params.tagSize);

  // 7. Decrypt
  const encKey = getKey(keys, envelope.enc.kid);
  const plaintext = aeadDecrypt(encKey, nonce, ciphertext, tag, aad);

  // 8. Parse plaintext as JSON
  const json = new TextDecoder().decode(plaintext);
  const payload = JSON.parse(json) as Payload;

  // Validate type field exists
  if (!payload.type || !['source', 'chunk', 'canary'].includes(payload.type)) {
    throw new Error(`Invalid payload type: ${(payload as unknown as Record<string, unknown>).type}`);
  }

  // 9. Return result
  return { payload, envelope };
}

/** Constant-time comparison of two byte arrays. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
