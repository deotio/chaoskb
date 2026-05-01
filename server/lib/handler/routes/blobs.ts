import * as crypto from 'crypto';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { validateBlobUpload } from '../middleware/input-validation.js';
import { checkRateLimit, rateLimitHeaders } from '../middleware/rate-limit.js';
import { logger } from '../logger.js';

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

const QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB

export async function handlePutBlob(
  blobId: string,
  tenantId: string,
  rawBody: string | null | undefined,
  isBase64Encoded: boolean,
  contentType: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  // Rate limit check
  const rateResult = await checkRateLimit(tenantId, 'PUT', ddb, tableName);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
    };
  }

  if (!rawBody) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'invalid_request', message: 'Request body is required' }),
    };
  }

  const bodyBuffer = isBase64Encoded
    ? Buffer.from(rawBody, 'base64')
    : Buffer.from(rawBody, 'utf-8');

  // Validate input
  const validation = validateBlobUpload(bodyBuffer, contentType);
  if (!validation.valid) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'invalid_request', message: validation.error }),
    };
  }

  // Check quota
  const tenantMeta = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: 'META' },
      ProjectionExpression: 'storageUsedBytes',
    }),
  );

  const currentUsage = (tenantMeta.Item?.['storageUsedBytes'] as number) ?? 0;
  if (currentUsage + bodyBuffer.length > QUOTA_BYTES) {
    return {
      statusCode: 413,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({
        error: 'quota_exceeded',
        message: 'Storage quota exceeded (50 MB)',
        currentUsage,
        limit: QUOTA_BYTES,
      }),
    };
  }

  const now = new Date().toISOString();
  const sha256 = crypto.createHash('sha256').update(bodyBuffer).digest('base64');

  // Write-if-absent
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `BLOB#${blobId}`,
          data: bodyBuffer,
          size: bodyBuffer.length,
          createdAt: now,
          updatedAt: now,
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
        body: JSON.stringify({ error: 'blob_exists', id: blobId }),
      };
    }
    throw err;
  }

  // Atomic increment storage used
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: 'META' },
      UpdateExpression: 'SET storageUsedBytes = storageUsedBytes + :size',
      ExpressionAttributeValues: { ':size': bodyBuffer.length },
    }),
  );

  logger.info('Blob uploaded', { tenantId, operation: 'PUT', blobCount: 1 });

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
    body: JSON.stringify({ id: blobId, size: bodyBuffer.length, ts: now, sha256 }),
  };
}

export async function handleGetBlob(
  blobId: string,
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  const rateResult = await checkRateLimit(tenantId, 'GET', ddb, tableName);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
    };
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `BLOB#${blobId}` },
    }),
  );

  if (!result.Item || result.Item['deletedAt']) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'not_found', message: 'Blob not found' }),
    };
  }

  const data = result.Item['data'] as Buffer;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      ...rateLimitHeaders(rateResult),
    },
    body: Buffer.from(data).toString('base64'),
  };
}

export async function handleDeleteBlob(
  blobId: string,
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  const rateResult = await checkRateLimit(tenantId, 'DELETE', ddb, tableName);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
    };
  }

  const now = new Date().toISOString();
  const ttlEpoch = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days

  // Get blob size for decrementing storage
  const existing = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `BLOB#${blobId}` },
      ProjectionExpression: '#s',
      ExpressionAttributeNames: { '#s': 'size' },
    }),
  );

  if (!existing.Item) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'not_found', message: 'Blob not found' }),
    };
  }

  const blobSize = (existing.Item['size'] as number) ?? 0;

  // Soft delete
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `BLOB#${blobId}` },
      UpdateExpression: 'SET deletedAt = :deletedAt, expiresAt = :expiresAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':deletedAt': now,
        ':expiresAt': ttlEpoch,
        ':updatedAt': now,
      },
    }),
  );

  // Decrement storage used
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `TENANT#${tenantId}`, SK: 'META' },
      UpdateExpression: 'SET storageUsedBytes = storageUsedBytes - :size',
      ExpressionAttributeValues: { ':size': blobSize },
    }),
  );

  logger.info('Blob soft-deleted', { tenantId, operation: 'DELETE' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
    body: JSON.stringify({ id: blobId, deleted: true }),
  };
}

export async function handleListBlobs(
  tenantId: string,
  since: string | undefined,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  const rateResult = await checkRateLimit(tenantId, 'LIST', ddb, tableName);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
      body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests' }),
    };
  }

  let items: Record<string, unknown>[] = [];

  if (since) {
    // Use GSI for incremental sync
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'updatedAt-index',
        KeyConditionExpression: 'PK = :pk AND updatedAt > :since',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':since': since,
        },
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
  } else {
    // Full list — query base table
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':prefix': 'BLOB#',
        },
        ProjectionExpression: 'SK, #s, updatedAt, deletedAt',
        ExpressionAttributeNames: { '#s': 'size' },
      }),
    );
    items = (result.Items ?? []) as Record<string, unknown>[];
  }

  const blobs: { id: string; size: number; ts: string }[] = [];
  const tombstones: { id: string; deleted_at: string }[] = [];

  for (const item of items) {
    const sk = item['SK'] as string;
    const blobId = sk.startsWith('BLOB#') ? sk.slice(5) : sk;

    if (item['deletedAt']) {
      tombstones.push({
        id: blobId,
        deleted_at: item['deletedAt'] as string,
      });
    } else {
      blobs.push({
        id: blobId,
        size: item['size'] as number,
        ts: item['updatedAt'] as string,
      });
    }
  }

  logger.info('Blobs listed', { tenantId, operation: 'LIST', blobCount: blobs.length });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', ...rateLimitHeaders(rateResult) },
    body: JSON.stringify({ blobs, tombstones }),
  };
}

export async function handleCountBlobs(
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'BLOB#',
      },
      FilterExpression: 'attribute_not_exists(deletedAt)',
      Select: 'COUNT',
    }),
  );

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: result.Count ?? 0 }),
  };
}
