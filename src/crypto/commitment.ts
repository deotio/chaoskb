import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Compute HMAC-SHA256 key commitment.
 * commitment = HMAC-SHA256(commitKey, blobIdBytes || rawCt)
 * where blobIdBytes is the UTF-8 encoding of the blob ID string.
 */
export function computeCommitment(
  commitKey: Uint8Array,
  blobId: string,
  rawCt: Uint8Array,
): Uint8Array {
  const blobIdBytes = new TextEncoder().encode(blobId);
  const message = new Uint8Array(blobIdBytes.length + rawCt.length);
  message.set(blobIdBytes, 0);
  message.set(rawCt, blobIdBytes.length);
  return hmac(sha256, commitKey, message);
}

/**
 * Verify a key commitment using constant-time comparison.
 * Returns true if the commitment is valid.
 */
export function verifyCommitment(
  commitKey: Uint8Array,
  blobId: string,
  rawCt: Uint8Array,
  expected: Uint8Array,
): boolean {
  const computed = computeCommitment(commitKey, blobId, rawCt);
  return constantTimeEqual(computed, expected);
}

/**
 * Constant-time comparison of two byte arrays.
 * Always compares the full length to prevent timing side-channels.
 */
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
