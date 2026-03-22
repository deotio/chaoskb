import { randomBytes } from 'node:crypto';

import { deriveFromPassphrase as argon2Derive } from '../argon2.js';
import type { ISecureBuffer } from '../types.js';

const SALT_LENGTH = 16;

/**
 * Maximum tier: Argon2id passphrase derivation.
 *
 * The master key is derived from a user-chosen passphrase.
 * No recovery path — if the passphrase is lost, data is lost.
 */

/**
 * Derive a master key from a passphrase using Argon2id.
 *
 * @param passphrase - User passphrase
 * @param salt - Optional 16-byte salt. If not provided, a random one is generated.
 * @returns Object with the derived master key and the salt (for server storage)
 */
export function deriveFromPassphrase(
  passphrase: string,
  salt?: Uint8Array,
): { masterKey: ISecureBuffer; salt: Uint8Array } {
  const actualSalt = salt ?? new Uint8Array(randomBytes(SALT_LENGTH));

  if (actualSalt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes, got ${actualSalt.length}`);
  }

  const masterKey = argon2Derive(passphrase, actualSalt);

  return { masterKey, salt: actualSalt };
}
