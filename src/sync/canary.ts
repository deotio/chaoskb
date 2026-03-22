import type { ISyncHttpClient } from './types.js';
import type { IEncryptionService, DerivedKeySet, CanaryPayload } from '../crypto/types.js';

/**
 * Verify encryption keys by writing, reading, and verifying a canary blob.
 *
 * This is used on first sync to confirm that the local encryption keys
 * can successfully round-trip through the server. The canary blob is
 * deleted after verification.
 *
 * @returns true if the canary was written, read back, decrypted, and
 *          verified successfully; false otherwise.
 */
export async function verifyCanary(
  client: ISyncHttpClient,
  encryptionService: IEncryptionService,
  keys: DerivedKeySet,
): Promise<boolean> {
  const canaryPayload: CanaryPayload = {
    type: 'canary',
    value: 'chaoskb-canary-v1',
  };

  const blobId = encryptionService.generateBlobId();

  try {
    // Encrypt the canary payload
    const { bytes } = encryptionService.encrypt(canaryPayload, keys);

    // Upload to server
    const putResponse = await client.put(`/v1/blobs/${blobId}`, bytes);
    if (!putResponse.ok && putResponse.status !== 201) {
      return false;
    }

    // Download back from server
    const getResponse = await client.get(`/v1/blobs/${blobId}`);
    if (!getResponse.ok) {
      return false;
    }

    // Decrypt
    const downloadedBytes = new Uint8Array(await getResponse.arrayBuffer());
    const envelope = JSON.parse(new TextDecoder().decode(downloadedBytes));
    const { payload } = encryptionService.decrypt(envelope, keys);

    // Verify
    if (payload.type !== 'canary' || (payload as CanaryPayload).value !== 'chaoskb-canary-v1') {
      return false;
    }

    return true;
  } catch {
    return false;
  } finally {
    // Always attempt to clean up the canary blob
    try {
      await client.delete(`/v1/blobs/${blobId}`);
    } catch {
      // Best-effort cleanup — ignore failures
    }
  }
}
