import { randomBytes } from 'node:crypto';

import { aeadEncrypt, aeadDecrypt } from './aead.js';
import { deriveKey } from './hkdf.js';
import { SecureBuffer } from './secure-buffer.js';
import type { ISecureBuffer } from './types.js';

const PROJECT_KEY_LENGTH = 32;
const WRAP_INFO = 'chaoskb-project-wrap';

/**
 * Create a new random project key and wrap it with the personal master key.
 *
 * Uses HKDF to derive a wrapping key from the master key, then encrypts
 * the project key with XChaCha20-Poly1305. AAD can include a project name
 * for binding.
 *
 * @param personalMasterKey - The user's personal master key
 * @param projectName - Optional project name for AAD binding
 * @returns The project key (SecureBuffer) and the wrapped (encrypted) form
 */
export function createProjectKey(
  personalMasterKey: ISecureBuffer,
  projectName?: string,
): { projectKey: ISecureBuffer; wrappedKey: Uint8Array } {
  // Generate random 32-byte project key
  const projectKeyBytes = randomBytes(PROJECT_KEY_LENGTH);

  // Derive a wrapping key via HKDF
  const wrappingKey = deriveKey(
    new Uint8Array(personalMasterKey.buffer),
    WRAP_INFO,
  );

  // AAD: project name if available, otherwise empty
  const aad = projectName
    ? new TextEncoder().encode(projectName)
    : new Uint8Array(0);

  // Encrypt project key with XChaCha20-Poly1305
  const { nonce, ciphertext, tag } = aeadEncrypt(wrappingKey, projectKeyBytes, aad);

  // Zero wrapping key and plaintext project key bytes
  wrappingKey.fill(0);

  // Serialize: nonce(24) || ciphertext || tag(16)
  const wrappedKey = new Uint8Array(nonce.length + ciphertext.length + tag.length);
  wrappedKey.set(nonce, 0);
  wrappedKey.set(ciphertext, nonce.length);
  wrappedKey.set(tag, nonce.length + ciphertext.length);

  const projectKey = SecureBuffer.from(projectKeyBytes);

  return { projectKey, wrappedKey };
}

/**
 * Unwrap a project key using the personal master key.
 *
 * @param wrappedKey - The wrapped project key (nonce || ciphertext || tag)
 * @param personalMasterKey - The user's personal master key
 * @param projectName - Optional project name for AAD binding (must match what was used during wrapping)
 * @returns The unwrapped project key as a SecureBuffer
 */
export function unwrapProjectKey(
  wrappedKey: Uint8Array,
  personalMasterKey: ISecureBuffer,
  projectName?: string,
): ISecureBuffer {
  const NONCE_SIZE = 24;
  const TAG_SIZE = 16;

  if (wrappedKey.length < NONCE_SIZE + TAG_SIZE + 1) {
    throw new Error('Wrapped key is too short');
  }

  // Derive the same wrapping key
  const wrappingKey = deriveKey(
    new Uint8Array(personalMasterKey.buffer),
    WRAP_INFO,
  );

  // Split wrapped key into nonce, ciphertext, tag
  const nonce = wrappedKey.slice(0, NONCE_SIZE);
  const ciphertext = wrappedKey.slice(NONCE_SIZE, wrappedKey.length - TAG_SIZE);
  const tag = wrappedKey.slice(wrappedKey.length - TAG_SIZE);

  // AAD: project name if available, otherwise empty
  const aad = projectName
    ? new TextEncoder().encode(projectName)
    : new Uint8Array(0);

  // Decrypt
  const projectKeyBytes = aeadDecrypt(wrappingKey, nonce, ciphertext, tag, aad);

  // Zero wrapping key
  wrappingKey.fill(0);

  return SecureBuffer.from(Buffer.from(projectKeyBytes));
}
