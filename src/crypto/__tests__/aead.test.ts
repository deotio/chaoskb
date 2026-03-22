import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { aeadEncrypt, aeadDecrypt, aeadEncryptWithNonce } from '../aead.js';

describe('AEAD (XChaCha20-Poly1305)', () => {
  const key = randomBytes(32);
  const plaintext = new TextEncoder().encode('Hello, World!');
  const aad = new TextEncoder().encode('associated data');

  describe('encrypt/decrypt round-trip', () => {
    it('should encrypt and decrypt successfully', () => {
      const { nonce, ciphertext, tag } = aeadEncrypt(key, plaintext, aad);

      expect(nonce.length).toBe(24);
      expect(tag.length).toBe(16);
      expect(ciphertext.length).toBe(plaintext.length);

      const decrypted = aeadDecrypt(key, nonce, ciphertext, tag, aad);
      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different nonces each time', () => {
      const result1 = aeadEncrypt(key, plaintext, aad);
      const result2 = aeadEncrypt(key, plaintext, aad);

      expect(Buffer.from(result1.nonce).equals(Buffer.from(result2.nonce))).toBe(false);
    });

    it('should produce different ciphertexts with different nonces', () => {
      const result1 = aeadEncrypt(key, plaintext, aad);
      const result2 = aeadEncrypt(key, plaintext, aad);

      expect(Buffer.from(result1.ciphertext).equals(Buffer.from(result2.ciphertext))).toBe(false);
    });
  });

  describe('wrong key rejection', () => {
    it('should fail to decrypt with a wrong key', () => {
      const { nonce, ciphertext, tag } = aeadEncrypt(key, plaintext, aad);
      const wrongKey = randomBytes(32);

      expect(() => aeadDecrypt(wrongKey, nonce, ciphertext, tag, aad)).toThrow();
    });
  });

  describe('AAD tampering rejection', () => {
    it('should fail to decrypt with wrong AAD', () => {
      const { nonce, ciphertext, tag } = aeadEncrypt(key, plaintext, aad);
      const wrongAad = new TextEncoder().encode('tampered data');

      expect(() => aeadDecrypt(key, nonce, ciphertext, tag, wrongAad)).toThrow();
    });

    it('should fail with empty AAD when original had AAD', () => {
      const { nonce, ciphertext, tag } = aeadEncrypt(key, plaintext, aad);

      expect(() => aeadDecrypt(key, nonce, ciphertext, tag, new Uint8Array(0))).toThrow();
    });
  });

  describe('nonce validation', () => {
    it('should reject nonces that are not 24 bytes', () => {
      expect(() => aeadEncryptWithNonce(key, new Uint8Array(12), plaintext, aad)).toThrow(
        'Nonce must be 24 bytes',
      );

      const { ciphertext, tag } = aeadEncrypt(key, plaintext, aad);
      expect(() => aeadDecrypt(key, new Uint8Array(12), ciphertext, tag, aad)).toThrow(
        'Nonce must be 24 bytes',
      );
    });
  });

  describe('deterministic encryption with fixed nonce', () => {
    it('should produce the same ciphertext with the same nonce', () => {
      const fixedNonce = new Uint8Array(24); // all zeros
      const result1 = aeadEncryptWithNonce(key, fixedNonce, plaintext, aad);
      const result2 = aeadEncryptWithNonce(key, fixedNonce, plaintext, aad);

      expect(Buffer.from(result1.ciphertext)).toEqual(Buffer.from(result2.ciphertext));
      expect(Buffer.from(result1.tag)).toEqual(Buffer.from(result2.tag));
    });
  });

  describe('empty plaintext', () => {
    it('should handle empty plaintext', () => {
      const empty = new Uint8Array(0);
      const { nonce, ciphertext, tag } = aeadEncrypt(key, empty, aad);

      expect(ciphertext.length).toBe(0);
      expect(tag.length).toBe(16);

      const decrypted = aeadDecrypt(key, nonce, ciphertext, tag, aad);
      expect(decrypted.length).toBe(0);
    });
  });

  describe('large plaintext', () => {
    it('should handle large payloads', () => {
      const large = randomBytes(100_000);
      const { nonce, ciphertext, tag } = aeadEncrypt(key, large, aad);

      const decrypted = aeadDecrypt(key, nonce, ciphertext, tag, aad);
      expect(Buffer.from(decrypted)).toEqual(large);
    });
  });
});
