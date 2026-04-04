import * as crypto from 'node:crypto';
import sodium from 'sodium-native';

import { aeadEncrypt, aeadDecrypt } from '../aead.js';
import { SecureBuffer } from '../secure-buffer.js';
import { ed25519ToX25519PublicKey, ed25519ToX25519SecretKey } from '../ssh-keys.js';
import type { ISecureBuffer, SSHKeyInfo } from '../types.js';

const RSA_MIN_BITS = 2048;

/**
 * Standard tier: SSH key wrapping.
 *
 * For Ed25519 keys: crypto_box_seal (ephemeral X25519 ECDH + XSalsa20-Poly1305)
 * For RSA keys: RSA-OAEP-SHA256 KEM + XChaCha20-Poly1305 DEM
 */

/**
 * Wrap a master key with an SSH public key.
 * Ed25519: uses crypto_box_seal after converting to X25519.
 * RSA: uses RSA-OAEP KEM + XChaCha20-Poly1305 DEM.
 */
export function wrapMasterKey(masterKey: ISecureBuffer, sshPublicKey: SSHKeyInfo): Uint8Array {
  if (sshPublicKey.type === 'ed25519') {
    return wrapWithEd25519(masterKey, sshPublicKey.publicKeyBytes);
  } else if (sshPublicKey.type === 'rsa') {
    return wrapWithRSA(masterKey, sshPublicKey.publicKeyBytes);
  }
  throw new Error(`Unsupported SSH key type: ${sshPublicKey.type}`);
}

/**
 * Unwrap a master key with an SSH private key (Ed25519).
 * @param wrappedKey - The sealed box
 * @param ed25519SecretKey - The 64-byte Ed25519 secret key
 */
export function unwrapMasterKeyEd25519(
  wrappedKey: Uint8Array,
  ed25519SecretKey: Uint8Array,
  ed25519PublicKey: Uint8Array,
): ISecureBuffer {
  const x25519Sk = ed25519ToX25519SecretKey(ed25519SecretKey);
  const x25519Pk = ed25519ToX25519PublicKey(ed25519PublicKey);

  const skBuf = Buffer.from(x25519Sk);
  const pkBuf = Buffer.from(x25519Pk);
  const plaintext = Buffer.alloc(wrappedKey.length - sodium.crypto_box_SEALBYTES);
  try {
    sodium.crypto_box_seal_open(
      plaintext,
      Buffer.from(wrappedKey),
      pkBuf,
      skBuf,
    );
    return SecureBuffer.from(plaintext);
  } finally {
    sodium.sodium_memzero(skBuf);
    sodium.sodium_memzero(pkBuf);
  }
}

/**
 * Unwrap a master key wrapped with RSA-OAEP KEM + DEM.
 * @param wrappedKey - Serialized [4-byte wrappedWKLen][wrappedWK][nonce][ct][tag]
 * @param rsaPrivateKey - RSA private key in PEM or DER format
 */
export function unwrapMasterKeyRSA(
  wrappedKey: Uint8Array,
  rsaPrivateKey: crypto.KeyObject,
): ISecureBuffer {
  const buf = Buffer.from(wrappedKey);
  let offset = 0;

  // Read wrapped wrapping key length
  const wrappedWKLen = buf.readUInt32BE(offset);
  offset += 4;

  // Read wrapped wrapping key
  const wrappedWK = buf.subarray(offset, offset + wrappedWKLen);
  offset += wrappedWKLen;

  // Remaining is AEAD encrypted master key: nonce(24) || ciphertext || tag(16)
  const aeadPayload = buf.subarray(offset);
  const nonce = aeadPayload.subarray(0, 24);
  const ciphertext = aeadPayload.subarray(24, aeadPayload.length - 16);
  const tag = aeadPayload.subarray(aeadPayload.length - 16);

  // Decrypt wrapping key with RSA-OAEP
  const wrappingKey = crypto.privateDecrypt(
    {
      key: rsaPrivateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedWK,
  );

  // Decrypt master key with XChaCha20-Poly1305
  const emptyAAD = new Uint8Array(0);
  const masterKeyBytes = aeadDecrypt(
    new Uint8Array(wrappingKey),
    new Uint8Array(nonce),
    new Uint8Array(ciphertext),
    new Uint8Array(tag),
    emptyAAD,
  );

  // Zero the wrapping key
  wrappingKey.fill(0);

  return SecureBuffer.from(Buffer.from(masterKeyBytes));
}

// --- Internal helpers ---

function wrapWithEd25519(masterKey: ISecureBuffer, ed25519PublicKey: Uint8Array): Uint8Array {
  const x25519Pk = ed25519ToX25519PublicKey(ed25519PublicKey);

  const sealed = Buffer.alloc(masterKey.length + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(sealed, masterKey.buffer, Buffer.from(x25519Pk));

  return new Uint8Array(sealed);
}

function wrapWithRSA(masterKey: ISecureBuffer, rsaPublicKeyBytes: Uint8Array): Uint8Array {
  // Parse the RSA public key bytes (SSH wire format: exponent + modulus)
  const rsaPubKey = rsaPublicKeyBytesToKeyObject(rsaPublicKeyBytes);

  // Check minimum key size
  const keyDetail = (rsaPubKey as unknown as { asymmetricKeySize?: number }).asymmetricKeySize;
  if (keyDetail !== undefined && keyDetail * 8 < RSA_MIN_BITS) {
    throw new Error(`RSA key too small: ${keyDetail * 8} bits (minimum ${RSA_MIN_BITS})`);
  }

  // Generate random 32-byte wrapping key
  const wrappingKey = crypto.randomBytes(32);

  // RSA-OAEP encrypt the wrapping key
  const wrappedWK = crypto.publicEncrypt(
    {
      key: rsaPubKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappingKey,
  );

  // XChaCha20-Poly1305 encrypt the master key with the wrapping key
  const emptyAAD = new Uint8Array(0);
  const { nonce, ciphertext, tag } = aeadEncrypt(
    new Uint8Array(wrappingKey),
    new Uint8Array(masterKey.buffer),
    emptyAAD,
  );

  // Zero the wrapping key
  wrappingKey.fill(0);

  // Serialize: [4-byte wrappedWK length][wrappedWK][nonce][ciphertext][tag]
  const totalLen = 4 + wrappedWK.length + nonce.length + ciphertext.length + tag.length;
  const result = Buffer.alloc(totalLen);
  let offset = 0;

  result.writeUInt32BE(wrappedWK.length, offset);
  offset += 4;
  wrappedWK.copy(result, offset);
  offset += wrappedWK.length;
  Buffer.from(nonce).copy(result, offset);
  offset += nonce.length;
  Buffer.from(ciphertext).copy(result, offset);
  offset += ciphertext.length;
  Buffer.from(tag).copy(result, offset);

  return new Uint8Array(result);
}

/**
 * Convert SSH wire format RSA public key bytes to a Node.js KeyObject.
 * Input: [4-byte exponent length][exponent][4-byte modulus length][modulus]
 */
function rsaPublicKeyBytesToKeyObject(rsaBytes: Uint8Array): crypto.KeyObject {
  const buf = Buffer.from(rsaBytes);
  let offset = 0;

  const eLen = buf.readUInt32BE(offset);
  offset += 4;
  const e = buf.subarray(offset, offset + eLen);
  offset += eLen;

  const nLen = buf.readUInt32BE(offset);
  offset += 4;
  const n = buf.subarray(offset, offset + nLen);

  // Build a DER-encoded RSA public key (PKCS#1)
  // Use Node.js crypto to create from JWK
  const jwk = {
    kty: 'RSA',
    n: bufferToBase64Url(stripLeadingZero(n)),
    e: bufferToBase64Url(stripLeadingZero(e)),
  };

  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

function stripLeadingZero(buf: Buffer): Buffer {
  // SSH wire format may have a leading zero byte for sign
  if (buf[0] === 0 && buf.length > 1) {
    return buf.subarray(1);
  }
  return buf;
}

function bufferToBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
