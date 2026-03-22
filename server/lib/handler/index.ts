import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logger } from './logger.js';
import { authenticateRequest, AuthError } from './middleware/ssh-auth.js';
import { handleHealth } from './routes/health.js';
import { handleRegister } from './routes/register.js';
import {
  handlePutBlob,
  handleGetBlob,
  handleDeleteBlob,
  handleListBlobs,
  handleCountBlobs,
} from './routes/blobs.js';
import { handleRestore } from './routes/restore.js';
import { handleCreateTenant, handleListTenants, handleDeleteTenant } from './routes/tenants.js';
import { handleExport } from './routes/export.js';

interface LambdaFunctionURLEvent {
  requestContext: {
    http: { method: string; path: string };
    requestId: string;
  };
  headers: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded: boolean;
}

interface LambdaFunctionURLResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

const TABLE_NAME = process.env['TABLE_NAME'] ?? '';
const SIGNUPS_ENABLED_PARAM = process.env['SIGNUPS_ENABLED_PARAM'] ?? '';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'none',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function response(
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
  isBase64Encoded = false,
): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, ...headers },
    body,
    isBase64Encoded,
  };
}

export const handler = async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => {
  const startTime = Date.now();
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const requestId = event.requestContext.requestId;

  logger.info('Request received', { requestId, operation: `${method} ${path}` });

  try {
    // OPTIONS (CORS preflight)
    if (method === 'OPTIONS') {
      return response(204, '', {});
    }

    // Health check — no auth
    if (method === 'GET' && path === '/health') {
      const result = handleHealth();
      return response(result.statusCode, result.body, result.headers);
    }

    // Register — no auth
    if (method === 'POST' && path === '/v1/auth/register') {
      const result = await handleRegister(event.body, ddb, TABLE_NAME, SIGNUPS_ENABLED_PARAM);
      return response(result.statusCode, result.body, result.headers);
    }

    // All other routes require authentication
    const auth = await authenticateRequest(event, ddb, TABLE_NAME);
    const tenantId = auth.tenantId;

    // Blob routes
    const blobMatch = path.match(/^\/v1\/blobs\/([^/]+)$/);
    const restoreMatch = path.match(/^\/v1\/blobs\/([^/]+)\/restore$/);

    if (restoreMatch && method === 'POST') {
      const blobId = restoreMatch[1];
      const result = await handleRestore(blobId, tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    if (path === '/v1/blobs/count' && method === 'GET') {
      const result = await handleCountBlobs(tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    if (blobMatch) {
      const blobId = blobMatch[1];

      if (method === 'PUT') {
        const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
        const result = await handlePutBlob(
          blobId,
          tenantId,
          event.body,
          event.isBase64Encoded,
          contentType,
          ddb,
          TABLE_NAME,
        );
        if (result.statusCode === 200 && result.headers['Content-Type'] === 'application/octet-stream') {
          return response(result.statusCode, result.body, result.headers, true);
        }
        return response(result.statusCode, result.body, result.headers);
      }

      if (method === 'GET') {
        const result = await handleGetBlob(blobId, tenantId, ddb, TABLE_NAME);
        if (result.statusCode === 200 && result.headers['Content-Type'] === 'application/octet-stream') {
          return response(result.statusCode, result.body, result.headers, true);
        }
        return response(result.statusCode, result.body, result.headers);
      }

      if (method === 'DELETE') {
        const result = await handleDeleteBlob(blobId, tenantId, ddb, TABLE_NAME);
        return response(result.statusCode, result.body, result.headers);
      }
    }

    if (path === '/v1/blobs' && method === 'GET') {
      const since = event.queryStringParameters?.['since'];
      const result = await handleListBlobs(tenantId, since, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    // Tenant routes
    const tenantDeleteMatch = path.match(/^\/v1\/tenants\/([^/]+)$/);

    if (path === '/v1/tenants' && method === 'POST') {
      const result = await handleCreateTenant(event.body, tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    if (path === '/v1/tenants' && method === 'GET') {
      const result = await handleListTenants(tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    if (tenantDeleteMatch && method === 'DELETE') {
      const projectTenantId = tenantDeleteMatch[1];
      const result = await handleDeleteTenant(projectTenantId, tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    // Export
    if (path === '/v1/export' && method === 'GET') {
      const result = await handleExport(tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, result.headers);
    }

    // Not found
    return response(404, JSON.stringify({ error: 'not_found', message: `No route for ${method} ${path}` }), {
      'Content-Type': 'application/json',
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;

    if (err instanceof AuthError) {
      logger.warn('Auth failed', { requestId, durationMs, error: err.message });
      return response(err.statusCode, JSON.stringify({ error: 'auth_error', message: err.message }), {
        'Content-Type': 'application/json',
      });
    }

    logger.error('Unhandled error', { requestId, durationMs, error: String(err) });
    return response(500, JSON.stringify({ error: 'internal_error', message: 'Internal server error' }), {
      'Content-Type': 'application/json',
    });
  }
};
