import type { QuotaInfo } from './types.js';

/**
 * Parse a 413 (Payload Too Large / Quota Exceeded) response into QuotaInfo.
 *
 * Expects the response body to contain `{ used: number, limit: number }`
 * where both values are in bytes.
 *
 * @returns QuotaInfo if the response could be parsed, null otherwise.
 */
export async function parseQuotaError(response: Response): Promise<QuotaInfo | null> {
  if (response.status !== 413) {
    return null;
  }

  try {
    const data = (await response.json()) as { used?: number; limit?: number };
    if (typeof data.used !== 'number' || typeof data.limit !== 'number') {
      return null;
    }
    const percentage = data.limit > 0 ? Math.round((data.used / data.limit) * 100) : 100;
    return {
      used: data.used,
      limit: data.limit,
      percentage,
    };
  } catch {
    return null;
  }
}

/**
 * Get a user-facing warning string based on quota usage.
 *
 * @returns A warning message, or null if usage is below the warning threshold.
 */
export function getQuotaWarning(quota: QuotaInfo): string | null {
  const usedMB = Math.round(quota.used / (1024 * 1024));
  const limitMB = Math.round(quota.limit / (1024 * 1024));

  if (quota.percentage >= 100) {
    return 'Storage limit reached. Articles are stored locally only and not synced.';
  }
  if (quota.percentage >= 95) {
    return `Storage is nearly full (${usedMB}MB / ${limitMB}MB). New articles will be stored locally only.`;
  }
  if (quota.percentage >= 80) {
    return `Storage is 80% full (${usedMB}MB / ${limitMB}MB)`;
  }
  return null;
}
