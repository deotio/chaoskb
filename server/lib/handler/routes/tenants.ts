import * as crypto from 'crypto';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger.js';

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export async function handleCreateTenant(
  body: string | null | undefined,
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  if (!body) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', message: 'Request body is required' }),
    };
  }

  let request: { name?: string };
  try {
    request = JSON.parse(body);
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
    };
  }

  if (!request.name || typeof request.name !== 'string') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'invalid_request', message: 'name is required' }),
    };
  }

  const projectTenantId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date().toISOString();

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `PROJECT#${request.name}`,
          projectTenantId,
          name: request.name,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'already_exists', message: 'A project with this name already exists' }),
      };
    }
    throw err;
  }

  logger.info('Tenant project created', { tenantId, operation: 'CREATE_TENANT' });

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: projectTenantId, name: request.name }),
  };
}

export async function handleListTenants(
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
        ':prefix': 'PROJECT#',
      },
    }),
  );

  const tenants = (result.Items ?? []).map((item) => ({
    tenantId: item['projectTenantId'] as string,
    name: item['name'] as string,
    createdAt: item['createdAt'] as string,
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenants }),
  };
}

export async function handleDeleteTenant(
  projectTenantId: string,
  tenantId: string,
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<HandlerResponse> {
  // First find the project record
  const projects = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'PROJECT#',
      },
    }),
  );

  const projectItem = (projects.Items ?? []).find(
    (item) => item['projectTenantId'] === projectTenantId,
  );

  if (!projectItem) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'not_found', message: 'Tenant not found' }),
    };
  }

  // Delete all blobs in the project tenant's partition
  const blobsResult = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${projectTenantId}`,
      },
      ProjectionExpression: 'PK, SK',
    }),
  );

  const blobItems = blobsResult.Items ?? [];

  // Batch delete in groups of 25
  for (let i = 0; i < blobItems.length; i += 25) {
    const batch = blobItems.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((item) => ({
            DeleteRequest: {
              Key: { PK: item['PK'], SK: item['SK'] },
            },
          })),
        },
      }),
    );
  }

  // Delete the project record itself
  await ddb.send(
    new BatchWriteCommand({
      RequestItems: {
        [tableName]: [
          {
            DeleteRequest: {
              Key: { PK: projectItem['PK'], SK: projectItem['SK'] },
            },
          },
        ],
      },
    }),
  );

  logger.info('Tenant deleted', { tenantId, operation: 'DELETE_TENANT' });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deleted: true }),
  };
}
