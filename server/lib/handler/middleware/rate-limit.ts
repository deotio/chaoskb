import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

const LIMITS: Record<string, number> = {
  PUT: 100,
  GET: 300,
  DELETE: 50,
  LIST: 10,
};

const WINDOW_SECONDS = 60;

export async function checkRateLimit(
  tenantId: string,
  operation: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<RateLimitResult> {
  const limit = LIMITS[operation] ?? 300;
  const now = Math.floor(Date.now() / 1000);
  const windowKey = Math.floor(now / WINDOW_SECONDS);
  const ttl = windowKey * WINDOW_SECONDS + WINDOW_SECONDS + 120; // window + 2 min buffer

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `RATE#${tenantId}`,
        SK: `${operation}#${windowKey}`,
      },
      UpdateExpression: 'SET #count = if_not_exists(#count, :zero) + :one, #ttl = :ttl',
      ExpressionAttributeNames: {
        '#count': 'count',
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':one': 1,
        ':ttl': ttl,
      },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

  const currentCount = (result.Attributes?.['count'] as number) ?? 1;
  const remaining = Math.max(0, limit - currentCount);

  if (currentCount > limit) {
    const windowEnd = (windowKey + 1) * WINDOW_SECONDS;
    const retryAfter = Math.max(1, windowEnd - now);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed && result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }
  return headers;
}
