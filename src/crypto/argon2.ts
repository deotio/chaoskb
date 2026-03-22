import { argon2id } from '@noble/hashes/argon2.js';

import { SecureBuffer } from './secure-buffer.js';
import type { ISecureBuffer } from './types.js';

// Argon2id parameters per spec: t=3, m=65536 (64MB), p=1, output 32 bytes
const ARGON2_TIME_COST = 3;
const ARGON2_MEMORY_COST = 65536; // in KiB = 64 MB
const ARGON2_PARALLELISM = 1;
const ARGON2_OUTPUT_LENGTH = 32;

/**
 * Derive a master key from a passphrase using Argon2id.
 * The passphrase is held in a SecureBuffer and zeroed after derivation.
 *
 * @param passphrase - User passphrase
 * @param salt - 16-byte salt (CSPRNG-generated, stored on server)
 * @returns SecureBuffer containing the 32-byte derived key
 */
export function deriveFromPassphrase(passphrase: string, salt: Uint8Array): ISecureBuffer {
  // Convert passphrase to bytes and hold in a buffer we can zero
  const passphraseBytes = Buffer.from(passphrase, 'utf-8');

  try {
    const derived = argon2id(passphraseBytes, salt, {
      t: ARGON2_TIME_COST,
      m: ARGON2_MEMORY_COST,
      p: ARGON2_PARALLELISM,
      dkLen: ARGON2_OUTPUT_LENGTH,
    });

    return SecureBuffer.from(Buffer.from(derived));
  } finally {
    // Zero passphrase memory immediately
    passphraseBytes.fill(0);
  }
}
