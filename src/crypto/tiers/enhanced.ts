import * as bip39 from 'bip39';

import { SecureBuffer } from '../secure-buffer.js';
import type { ISecureBuffer } from '../types.js';

// Re-export standard tier wrapping for dual-path recovery
export { wrapMasterKey, unwrapMasterKeyEd25519, unwrapMasterKeyRSA } from './standard.js';

/**
 * Enhanced tier: BIP39 24-word recovery key.
 *
 * The master key is a 256-bit random value which maps directly to a 24-word
 * BIP39 mnemonic. Either the mnemonic or the SSH-wrapped key can recover.
 */

/**
 * Encode a 256-bit master key as a 24-word BIP39 mnemonic.
 * The master key bytes are used directly as the entropy.
 */
export function generateRecoveryKey(masterKey: ISecureBuffer): string {
  if (masterKey.length !== 32) {
    throw new Error(`Master key must be 32 bytes (256 bits), got ${masterKey.length}`);
  }

  const entropy = Buffer.from(masterKey.buffer).toString('hex');
  const mnemonic = bip39.entropyToMnemonic(entropy);
  return mnemonic;
}

/**
 * Decode a 24-word BIP39 mnemonic back to the 256-bit master key.
 * Returns a SecureBuffer containing the recovered key.
 */
export function recoverFromMnemonic(mnemonic: string): ISecureBuffer {
  const trimmed = mnemonic.trim().toLowerCase();

  if (!bip39.validateMnemonic(trimmed)) {
    throw new Error('Invalid BIP39 mnemonic');
  }

  const words = trimmed.split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`Expected 24-word mnemonic, got ${words.length} words`);
  }

  const entropyHex = bip39.mnemonicToEntropy(trimmed);
  const entropyBytes = Buffer.from(entropyHex, 'hex');

  if (entropyBytes.length !== 32) {
    throw new Error(`Recovered entropy must be 32 bytes, got ${entropyBytes.length}`);
  }

  return SecureBuffer.from(entropyBytes);
}
