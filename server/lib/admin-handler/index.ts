import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { logger } from '../handler/logger.js';
import { handleListTenants, handleGetTenantDetail } from './routes/tenants.js';
import { handleUsageMetrics, handleHealthMetrics, handleCostMetrics } from './routes/metrics.js';
import { handleOverview } from './routes/overview.js';

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
const ENVIRONMENT = process.env['ENVIRONMENT'] ?? 'dev';
const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'https://chaoskb.com,https://dev.chaoskb.com').split(',');

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

function getCorsHeaders(origin?: string): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'none';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function response(
  statusCode: number,
  body: string,
  corsHeaders: Record<string, string>,
  headers: Record<string, string> = {},
): LambdaFunctionURLResult {
  return {
    statusCode,
    headers: { ...corsHeaders, ...headers },
    body,
  };
}

export const handler = async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => {
  const startTime = Date.now();
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;
  const requestId = event.requestContext.requestId;
  const origin = event.headers['origin'] || event.headers['Origin'];
  const cors = getCorsHeaders(origin);

  logger.info('Admin request received', { requestId, operation: `${method} ${path}` });

  try {
    // OPTIONS (CORS preflight)
    if (method === 'OPTIONS') {
      return response(204, '', cors);
    }

    // Overview
    if (method === 'GET' && path === '/admin/overview') {
      const result = await handleOverview(ddb, TABLE_NAME, ENVIRONMENT);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Tenant detail
    const tenantDetailMatch = path.match(/^\/admin\/tenants\/([^/]+)$/);
    if (tenantDetailMatch && method === 'GET') {
      const tenantId = tenantDetailMatch[1];
      const result = await handleGetTenantDetail(tenantId, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Tenant list
    if (method === 'GET' && path === '/admin/tenants') {
      const page = parseInt(event.queryStringParameters?.['page'] ?? '1', 10);
      const result = await handleListTenants(page, ddb, TABLE_NAME);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Metrics: usage
    if (method === 'GET' && path === '/admin/metrics/usage') {
      const result = await handleUsageMetrics(ddb, TABLE_NAME, ENVIRONMENT);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Metrics: health
    if (method === 'GET' && path === '/admin/metrics/health') {
      const result = await handleHealthMetrics(ENVIRONMENT);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Metrics: cost
    if (method === 'GET' && path === '/admin/metrics/cost') {
      const result = await handleCostMetrics(ENVIRONMENT);
      return response(result.statusCode, result.body, cors, result.headers);
    }

    // Not found
    return response(404, JSON.stringify({ error: 'not_found', message: `No route for ${method} ${path}` }), cors, {
      'Content-Type': 'application/json',
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    logger.error('Unhandled error', { requestId, durationMs, error: String(err) });
    return response(500, JSON.stringify({ error: 'internal_error', message: 'Internal server error' }), cors, {
      'Content-Type': 'application/json',
    });
  }
};
