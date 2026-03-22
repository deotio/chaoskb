import { describe, it, expect } from 'vitest';
import { EncryptionService } from '../encryption-service.js';
import type { CanaryPayload } from '../types.js';

describe('EncryptionService', () => {
  const svc = new EncryptionService();

  it('generateMasterKey returns a 32-byte SecureBuffer', () => {
    const key = svc.generateMasterKey();
    try {
      expect(key.length).toBe(32);
      expect(key.isDisposed).toBe(false);
      // Should contain non-zero bytes (random)
      const bytes = new Uint8Array(key.buffer);
      const allZero = bytes.every((b) => b === 0);
      expect(allZero).toBe(false);
    } finally {
      key.dispose();
    }
  });

  it('deriveKeys returns all 4 keys', () => {
    const masterKey = svc.generateMasterKey();
    try {
      const keys = svc.deriveKeys(masterKey);
      expect(keys.contentKey.length).toBe(32);
      expect(keys.metadataKey.length).toBe(32);
      expect(keys.embeddingKey.length).toBe(32);
      expect(keys.commitKey.length).toBe(32);

      keys.contentKey.dispose();
      keys.metadataKey.dispose();
      keys.embeddingKey.dispose();
      keys.commitKey.dispose();
    } finally {
      masterKey.dispose();
    }
  });

  it('encrypt then decrypt round-trips a canary payload', () => {
    const masterKey = svc.generateMasterKey();
    const keys = svc.deriveKeys(masterKey);

    const canary: CanaryPayload = { type: 'canary', value: 'chaoskb-canary-v1' };
    const { envelope } = svc.encrypt(canary, keys);

    expect(envelope.v).toBe(1);
    expect(envelope.id.startsWith('b_')).toBe(true);

    const { payload } = svc.decrypt(envelope, keys);
    expect(payload).toEqual(canary);

    keys.contentKey.dispose();
    keys.metadataKey.dispose();
    keys.embeddingKey.dispose();
    keys.commitKey.dispose();
    masterKey.dispose();
  });

  it('generateBlobId produces b_ prefix', () => {
    const id = svc.generateBlobId();
    expect(id.startsWith('b_')).toBe(true);
    expect(id.length).toBeGreaterThan(2);
  });
});
