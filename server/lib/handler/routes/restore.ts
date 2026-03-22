import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger.js';

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleRestore(
  blobId: string,
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  // Get the blob to verify it exists and is deleted
  const existing = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `BLOB#${blobId}` },
      ProjectionExpression: 'deletedAt, #s',
      ExpressionAttributeNames: { '#s': 'size' },
    }),
  );

  if (!existing.Item) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'not_found', message: 'Blob not found' }),
    };
  }

  if (!existing.Item['deletedAt']) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'not_deleted', message: 'Blob is not deleted' }),
    };
  }

  const blobSize = (existing.Item['size'] as number) ?? 0;
  const now = new Date().toISOString();

  // Remove deletedAt and ttl
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `BLOB#${blobId}` },
      UpdateExpression: 'REMOVE deletedAt, #ttl SET updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':updatedAt': now },
    }),
  );

  // Re-increment storage used
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: 'META' },
      UpdateExpression: 'SET storageUsedBytes = storageUsedBytes + :size',
      ExpressionAttributeValues: { ':size': blobSize },
    }),
  );

  logger.info('Blob restored', { tenantId, operation: 'RESTORE' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: blobId, restored: true }),
  };
}
