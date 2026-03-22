import { randomBytes } from 'node:crypto';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const NONCE_LENGTH = 24;
const TAG_LENGTH = 16;

export interface AeadResult {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

/**
 * Encrypt using XChaCha20-Poly1305.
 * Generates a random 24-byte nonce.
 * Returns separate nonce, ciphertext, and authentication tag.
 */
export function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): AeadResult {
  const nonce = new Uint8Array(randomBytes(NONCE_LENGTH));
  return aeadEncryptWithNonce(key, nonce, plaintext, aad);
}

/**
 * Encrypt with a specified nonce (for testing only).
 */
export function aeadEncryptWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): AeadResult {
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Nonce must be ${NONCE_LENGTH} bytes, got ${nonce.length}`);
  }

  const cipher = xchacha20poly1305(key, nonce, aad);
  const sealed = cipher.encrypt(plaintext);

  // noble/ciphers returns ciphertext || tag concatenated
  const ciphertext = sealed.slice(0, sealed.length - TAG_LENGTH);
  const tag = sealed.slice(sealed.length - TAG_LENGTH);

  return { nonce, ciphertext, tag };
}

/**
 * Decrypt using XChaCha20-Poly1305.
 * Throws if authentication fails.
 */
export function aeadDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Nonce must be ${NONCE_LENGTH} bytes, got ${nonce.length}`);
  }

  // noble/ciphers expects ciphertext || tag concatenated
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);

  const cipher = xchacha20poly1305(key, nonce, aad);
  return cipher.decrypt(sealed);
}
