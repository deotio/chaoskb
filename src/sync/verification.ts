import type { ISyncHttpClient } from './types.js';

/** Result of a blob count verification. */
export interface VerifyCountResult {
  match: boolean;
  localCount: number;
  serverCount: number;
  /** If mismatch exceeds 10%, suggests a full sync. */
  suggestFullSync?: boolean;
}

/**
 * Verify that the local blob count matches the server count.
 *
 * If the mismatch exceeds 10%, the result includes a suggestion
 * to run a full sync.
 */
export async function verifyBlobCount(
  client: ISyncHttpClient,
  localCount: number,
): Promise<VerifyCountResult> {
  const response = await client.get('/v1/blobs/count');
  if (!response.ok) {
    throw new Error(`Failed to get server blob count: HTTP ${response.status}`);
  }

  const data = (await response.json()) as { count: number };
  const serverCount = data.count;
  const match = localCount === serverCount;

  let suggestFullSync: boolean | undefined;
  if (!match) {
    const maxCount = Math.max(localCount, serverCount);
    const diff = Math.abs(localCount - serverCount);
    if (maxCount > 0 && diff / maxCount > 0.1) {
      suggestFullSync = true;
    }
  }

  return { match, localCount, serverCount, suggestFullSync };
}
