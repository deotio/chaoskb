import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger.js';

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleExport(
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  const allBlobs: { id: string; data: string; size: number; ts: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':prefix': 'BLOB#',
        },
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const sk = item['SK'] as string;
      const blobId = sk.slice(5); // Remove 'BLOB#' prefix
      const data = item['data'] as Buffer;

      allBlobs.push({
        id: blobId,
        data: Buffer.from(data).toString('base64'),
        size: item['size'] as number,
        ts: item['updatedAt'] as string,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  logger.info('Export completed', { tenantId, operation: 'EXPORT', blobCount: allBlobs.length });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blobs: allBlobs }),
  };
}
