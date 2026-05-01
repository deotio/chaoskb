import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../handler/logger.js';

interface RouteResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

const PAGE_SIZE = 25;

export async function handleListTenants(
  page: number,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<RouteResult> {
  try {
    const validPage = Math.max(1, page);

    // Scan for all META records to get tenant list
    const allTenants: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'SK = :sk',
          ExpressionAttributeValues: { ':sk': 'META' },
          ProjectionExpression: 'PK, publicKey, createdAt, updatedAt, storageUsedBytes',
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      if (result.Items) {
        allTenants.push(...result.Items);
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const total = allTenants.length;
    const startIndex = (validPage - 1) * PAGE_SIZE;
    const paginatedTenants = allTenants.slice(startIndex, startIndex + PAGE_SIZE).map((item) => ({
      tenantId: (item['PK'] as string).replace('TENANT#', ''),
      publicKey: item['publicKey'],
      createdAt: item['createdAt'],
      updatedAt: item['updatedAt'],
      storageUsedBytes: item['storageUsedBytes'] ?? 0,
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        tenants: paginatedTenants,
        total,
        page: validPage,
        pageSize: PAGE_SIZE,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to list tenants', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to list tenants' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}

export async function handleGetTenantDetail(
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<RouteResult> {
  try {
    // Query for the META record
    const metaResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': 'META',
        },
      }),
    );

    if (!metaResult.Items || metaResult.Items.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'not_found', message: 'Tenant not found' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const meta = metaResult.Items[0];

    // Count blobs for this tenant
    const blobResult = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':sk': 'BLOB#',
        },
        Select: 'COUNT',
      }),
    );

    const blobCount = blobResult.Count ?? 0;

    return {
      statusCode: 200,
      body: JSON.stringify({
        tenantId,
        publicKey: meta['publicKey'],
        createdAt: meta['createdAt'],
        updatedAt: meta['updatedAt'],
        storageUsedBytes: meta['storageUsedBytes'] ?? 0,
        blobCount,
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    logger.error('Failed to get tenant detail', { error: String(err) });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'internal_error', message: 'Failed to get tenant detail' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}
