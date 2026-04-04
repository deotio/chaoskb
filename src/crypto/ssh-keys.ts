import { createHash } from 'node:crypto';
import sodium from 'sodium-native';

import type { SSHKeyInfo, SSHKeyType } from './types.js';

/**
 * Parse an OpenSSH public key from authorized_keys / .pub file format.
 * Supports ssh-ed25519 and ssh-rsa key types.
 *
 * Format: <key-type> <base64-blob> [comment]
 */
export function parseSSHPublicKey(keyString: string): SSHKeyInfo {
  const trimmed = keyString.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length < 2) {
    throw new Error('Invalid SSH public key format: expected "<type> <base64> [comment]"');
  }

  const typeStr = parts[0];
  const base64Blob = parts[1];
  const comment = parts.length > 2 ? parts.slice(2).join(' ') : undefined;

  let type: SSHKeyType;
  if (typeStr === 'ssh-ed25519') {
    type = 'ed25519';
  } else if (typeStr === 'ssh-rsa') {
    type = 'rsa';
  } else {
    throw new Error(`Unsupported SSH key type: ${typeStr}`);
  }

  // Base64-decode the key blob
  const blob = Buffer.from(base64Blob, 'base64');

  // Parse the SSH wire format: length-prefixed strings
  const publicKeyBytes = extractPublicKeyFromBlob(blob, type);

  // Compute SHA-256 fingerprint
  const hash = createHash('sha256').update(blob).digest();
  const fingerprint = 'SHA256:' + hash.toString('base64').replace(/=+$/, '');

  return {
    type,
    publicKeyBytes,
    fingerprint,
    ...(comment !== undefined && { comment }),
  };
}

/**
 * Parse the SSH wire format blob and extract the raw public key bytes.
 *
 * SSH wire format: repeated [4-byte big-endian length][data]
 * - For ed25519: [type string][32-byte public key]
 * - For RSA: [type string][exponent][modulus]
 */
function extractPublicKeyFromBlob(blob: Buffer, type: SSHKeyType): Uint8Array {
  let offset = 0;

  function readString(): Buffer {
    if (offset + 4 > blob.length) {
      throw new Error('SSH key blob: unexpected end of data reading length');
    }
    const len = blob.readUInt32BE(offset);
    offset += 4;
    if (offset + len > blob.length) {
      throw new Error('SSH key blob: unexpected end of data reading string');
    }
    const data = blob.subarray(offset, offset + len);
    offset += len;
    return data;
  }

  // First field: key type string
  const typeField = readString().toString('ascii');

  if (type === 'ed25519') {
    if (typeField !== 'ssh-ed25519') {
      throw new Error(`SSH key type mismatch: expected ssh-ed25519, got ${typeField}`);
    }
    // Second field: 32-byte public key
    const pubkey = readString();
    if (pubkey.length !== 32) {
      throw new Error(`Ed25519 public key must be 32 bytes, got ${pubkey.length}`);
    }
    return new Uint8Array(pubkey);
  } else if (type === 'rsa') {
    if (typeField !== 'ssh-rsa') {
      throw new Error(`SSH key type mismatch: expected ssh-rsa, got ${typeField}`);
    }
    // RSA blob: [exponent][modulus]
    // For RSA we return the full blob (exponent + modulus) since RSA operations
    // need the full public key structure. The raw blob minus type prefix.
    const exponent = readString();
    const modulus = readString();

    // Build a buffer with the exponent and modulus in SSH wire format
    // This is what Node.js crypto needs for RSA operations
    const result = Buffer.alloc(4 + exponent.length + 4 + modulus.length);
    let pos = 0;
    result.writeUInt32BE(exponent.length, pos);
    pos += 4;
    exponent.copy(result, pos);
    pos += exponent.length;
    result.writeUInt32BE(modulus.length, pos);
    pos += 4;
    modulus.copy(result, pos);
    return new Uint8Array(result);
  }

  throw new Error(`Unsupported key type: ${type}`);
}

/**
 * Convert an Ed25519 public key to X25519 (Curve25519) public key.
 * Uses sodium crypto_sign_ed25519_pk_to_curve25519.
 */
export function ed25519ToX25519PublicKey(ed25519PublicKey: Uint8Array): Uint8Array {
  const x25519PublicKey = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  const ed25519Buffer = Buffer.from(ed25519PublicKey);
  sodium.crypto_sign_ed25519_pk_to_curve25519(x25519PublicKey, ed25519Buffer);
  return new Uint8Array(x25519PublicKey);
}

/**
 * Convert an Ed25519 secret key to X25519 (Curve25519) secret key.
 * Uses sodium crypto_sign_ed25519_sk_to_curve25519.
 */
export function ed25519ToX25519SecretKey(ed25519SecretKey: Uint8Array): Uint8Array {
  const x25519SecretKey = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES);
  const ed25519Buffer = Buffer.from(ed25519SecretKey);
  sodium.crypto_sign_ed25519_sk_to_curve25519(x25519SecretKey, ed25519Buffer);
  sodium.sodium_memzero(ed25519Buffer);
  return new Uint8Array(x25519SecretKey);
}
