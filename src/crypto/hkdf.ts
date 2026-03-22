import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { SecureBuffer } from './secure-buffer.js';
import type { DerivedKeySet } from './types.js';

const DEFAULT_KEY_LENGTH = 32;

/**
 * Derive a key using HKDF-SHA256 (Extract+Expand per RFC 5869).
 * @param ikm - Input keying material
 * @param info - Context/application-specific info string
 * @param salt - Optional salt (defaults to empty Uint8Array)
 * @param length - Output key length in bytes (default 32)
 */
export function deriveKey(
  ikm: Uint8Array,
  info: string,
  salt?: Uint8Array,
  length?: number,
): Uint8Array {
  const infoBytes = new TextEncoder().encode(info);
  return hkdf(sha256, ikm, salt ?? new Uint8Array(0), infoBytes, length ?? DEFAULT_KEY_LENGTH);
}

/**
 * Derive the complete set of subkeys from a master key.
 * Returns SecureBuffer-wrapped keys for:
 *   CEK (content), MEK (metadata), EEK (embedding), CKY (commit)
 */
export function deriveKeySet(masterKey: Uint8Array, salt?: Uint8Array): DerivedKeySet {
  const cekBytes = deriveKey(masterKey, 'chaoskb-content', salt);
  const mekBytes = deriveKey(masterKey, 'chaoskb-metadata', salt);
  const eekBytes = deriveKey(masterKey, 'chaoskb-embedding', salt);
  const ckyBytes = deriveKey(masterKey, 'chaoskb-commit', salt);

  return {
    contentKey: SecureBuffer.from(Buffer.from(cekBytes)),
    metadataKey: SecureBuffer.from(Buffer.from(mekBytes)),
    embeddingKey: SecureBuffer.from(Buffer.from(eekBytes)),
    commitKey: SecureBuffer.from(Buffer.from(ckyBytes)),
  };
}
