import { describe, it, expect, vi } from 'vitest';
import { verifyCanary } from '../canary.js';
import type { ISyncHttpClient } from '../types.js';
import type { IEncryptionService, DerivedKeySet, CanaryPayload, Envelope } from '../../crypto/types.js';

function createMockKeys(): DerivedKeySet {
  const buf = { buffer: Buffer.alloc(32), length: 32, isDisposed: false, dispose: vi.fn() };
  return {
    contentKey: buf,
    metadataKey: buf,
    embeddingKey: buf,
    commitKey: buf,
  };
}

function createMockEncryptionService(decryptedPayload?: unknown): IEncryptionService {
  const canaryPayload: CanaryPayload = { type: 'canary', value: 'chaoskb-canary-v1' };
  const envelope: Envelope = {
    v: 1,
    id: 'b_canary_test',
    ts: '2026-03-20T10:00:00Z',
    enc: {
      alg: 'XChaCha20-Poly1305',
      kid: 'CEK',
      ct: 'base64data',
      'ct.len': 64,
      commit: 'base64commit',
    },
  };

  return {
    generateMasterKey: vi.fn(),
    deriveKeys: vi.fn(),
    generateBlobId: vi.fn().mockReturnValue('b_canary_test'),
    encrypt: vi.fn().mockReturnValue({
      envelope,
      bytes: new TextEncoder().encode(JSON.stringify(envelope)),
    }),
    decrypt: vi.fn().mockReturnValue({
      payload: decryptedPayload ?? canaryPayload,
      envelope,
    }),
  };
}

describe('verifyCanary', () => {
  it('should return true on successful canary verification', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => {
          const envelope = {
            v: 1, id: 'b_canary_test', ts: '2026-03-20T10:00:00Z',
            enc: { alg: 'XChaCha20-Poly1305', kid: 'CEK', ct: 'x', 'ct.len': 1, commit: 'y' },
          };
          return Promise.resolve(new TextEncoder().encode(JSON.stringify(envelope)).buffer);
        },
      }),
      put: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
      delete: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      post: vi.fn(),
    };

    const encryptionService = createMockEncryptionService();
    const keys = createMockKeys();

    const result = await verifyCanary(client, encryptionService, keys);

    expect(result).toBe(true);
    expect(client.put).toHaveBeenCalledWith('/v1/blobs/b_canary_test', expect.any(Uint8Array));
    expect(client.get).toHaveBeenCalledWith('/v1/blobs/b_canary_test');
    // Should clean up
    expect(client.delete).toHaveBeenCalledWith('/v1/blobs/b_canary_test');
  });

  it('should return false when decrypted payload does not match', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn().mockResolvedValue({
        ok: true, status: 200,
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{}').buffer),
      }),
      put: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
      delete: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      post: vi.fn(),
    };

    // Return wrong payload on decrypt
    const encryptionService = createMockEncryptionService({
      type: 'canary',
      value: 'wrong-value',
    });
    const keys = createMockKeys();

    const result = await verifyCanary(client, encryptionService, keys);

    expect(result).toBe(false);
    // Should still clean up
    expect(client.delete).toHaveBeenCalled();
  });

  it('should return false on network error and still clean up', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn().mockRejectedValue(new Error('Network error')),
      put: vi.fn().mockResolvedValue({ ok: true, status: 201 }),
      delete: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      post: vi.fn(),
    };

    const encryptionService = createMockEncryptionService();
    const keys = createMockKeys();

    const result = await verifyCanary(client, encryptionService, keys);

    expect(result).toBe(false);
    expect(client.delete).toHaveBeenCalledWith('/v1/blobs/b_canary_test');
  });

  it('should return false when upload fails', async () => {
    const client: ISyncHttpClient = {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
      delete: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
      post: vi.fn(),
    };

    const encryptionService = createMockEncryptionService();
    const keys = createMockKeys();

    const result = await verifyCanary(client, encryptionService, keys);

    expect(result).toBe(false);
  });
});
