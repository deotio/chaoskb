import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
const { mockCwSend } = vi.hoisted(() => ({ mockCwSend: vi.fn() }));
const { mockCeSend } = vi.hoisted(() => ({ mockCeSend: vi.fn() }));

vi.hoisted(() => {
  process.env['TABLE_NAME'] = 'chaoskb-test';
  process.env['ENVIRONMENT'] = 'test';
  process.env['ALLOWED_ORIGINS'] = 'https://chaoskb.com,https://dev.chaoskb.com';
});

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  ScanCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'ScanCommand'; }),
  QueryCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'QueryCommand'; }),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {}),
}));

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn().mockImplementation(function () { return { send: mockCwSend }; }),
  DescribeAlarmsCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; }),
}));

vi.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: vi.fn().mockImplementation(function () { return { send: mockCeSend }; }),
  GetCostAndUsageCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; }),
  GetCostForecastCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; }),
}));

import { handler } from '../index.js';

function makeEvent(
  method: string,
  path: string,
  options: {
    queryStringParameters?: Record<string, string>;
    origin?: string;
  } = {},
) {
  return {
    requestContext: {
      http: { method, path },
      requestId: 'test-request-id',
    },
    headers: {
      origin: options.origin ?? 'https://chaoskb.com',
    },
    queryStringParameters: options.queryStringParameters,
    body: undefined,
    isBase64Encoded: false,
  };
}

describe('Admin Handler - Routing', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCwSend.mockReset();
    mockCeSend.mockReset();
  });

  it('should return 204 for OPTIONS preflight', async () => {
    const result = await handler(makeEvent('OPTIONS', '/admin/overview'));

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
  });

  it('should return 404 for unknown routes', async () => {
    const result = await handler(makeEvent('GET', '/admin/unknown'));

    expect(result.statusCode).toBe(404);
    const parsed = JSON.parse(result.body);
    expect(parsed.error).toBe('not_found');
    expect(parsed.message).toContain('GET /admin/unknown');
  });

  it('should return 404 for POST to read-only endpoints', async () => {
    const result = await handler(makeEvent('POST', '/admin/tenants'));

    expect(result.statusCode).toBe(404);
  });
});

describe('Admin Handler - CORS', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCwSend.mockReset();
    mockCeSend.mockReset();
  });

  it('should set CORS header for allowed origin', async () => {
    const result = await handler(makeEvent('GET', '/admin/unknown', { origin: 'https://chaoskb.com' }));

    expect(result.headers['Access-Control-Allow-Origin']).toBe('https://chaoskb.com');
  });

  it('should set CORS header for dev origin', async () => {
    const result = await handler(makeEvent('GET', '/admin/unknown', { origin: 'https://dev.chaoskb.com' }));

    expect(result.headers['Access-Control-Allow-Origin']).toBe('https://dev.chaoskb.com');
  });

  it('should reject disallowed origins', async () => {
    const result = await handler(makeEvent('GET', '/admin/unknown', { origin: 'https://evil.com' }));

    expect(result.headers['Access-Control-Allow-Origin']).toBe('none');
  });

  it('should include CORS headers on all responses', async () => {
    // Tenant list with mocked data
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const result = await handler(makeEvent('GET', '/admin/tenants', { origin: 'https://chaoskb.com' }));

    expect(result.headers['Access-Control-Allow-Origin']).toBe('https://chaoskb.com');
    expect(result.headers['Access-Control-Allow-Methods']).toContain('GET');
  });
});

describe('Admin Handler - GET /admin/tenants', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should list tenants with default pagination', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'TENANT#t1', publicKey: 'pk1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-20T00:00:00Z', storageUsedBytes: 1024 },
        { PK: 'TENANT#t2', publicKey: 'pk2', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-03-19T00:00:00Z', storageUsedBytes: 2048 },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent('GET', '/admin/tenants'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.tenants).toHaveLength(2);
    expect(parsed.total).toBe(2);
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.tenants[0].tenantId).toBe('t1');
    expect(parsed.tenants[0].storageUsedBytes).toBe(1024);
  });

  it('should paginate tenant list', async () => {
    // Create 30 tenants to test pagination
    const tenants = Array.from({ length: 30 }, (_, i) => ({
      PK: `TENANT#t${i}`,
      publicKey: `pk${i}`,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-20T00:00:00Z',
      storageUsedBytes: 100 * i,
    }));

    mockSend.mockResolvedValueOnce({
      Items: tenants,
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent('GET', '/admin/tenants', { queryStringParameters: { page: '2' } }));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.tenants).toHaveLength(5); // 30 - 25 = 5 on page 2
    expect(parsed.total).toBe(30);
    expect(parsed.page).toBe(2);
    expect(parsed.tenants[0].tenantId).toBe('t25');
  });

  it('should return empty page for out-of-range page number', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { PK: 'TENANT#t1', publicKey: 'pk1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-20T00:00:00Z', storageUsedBytes: 0 },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await handler(makeEvent('GET', '/admin/tenants', { queryStringParameters: { page: '100' } }));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.tenants).toHaveLength(0);
    expect(parsed.total).toBe(1);
    expect(parsed.page).toBe(100);
  });
});

describe('Admin Handler - GET /admin/tenants/{id}', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should return tenant detail', async () => {
    // META record query
    mockSend.mockResolvedValueOnce({
      Items: [{
        PK: 'TENANT#t1',
        SK: 'META',
        publicKey: 'pk1',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-03-20T00:00:00Z',
        storageUsedBytes: 4096,
      }],
    });
    // Blob count query
    mockSend.mockResolvedValueOnce({ Count: 42 });

    const result = await handler(makeEvent('GET', '/admin/tenants/t1'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.tenantId).toBe('t1');
    expect(parsed.blobCount).toBe(42);
    expect(parsed.storageUsedBytes).toBe(4096);
    expect(parsed.publicKey).toBe('pk1');
  });

  it('should return 404 for non-existent tenant', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent('GET', '/admin/tenants/nonexistent'));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('not_found');
  });
});

describe('Admin Handler - GET /admin/metrics/usage', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should return usage metrics', async () => {
    // META scan
    mockSend.mockResolvedValueOnce({
      Items: [
        { storageUsedBytes: 1000, updatedAt: new Date().toISOString() },
        { storageUsedBytes: 2000, updatedAt: '2025-01-01T00:00:00Z' },
      ],
      LastEvaluatedKey: undefined,
    });
    // BLOB count scan
    mockSend.mockResolvedValueOnce({ Count: 15, LastEvaluatedKey: undefined });

    const result = await handler(makeEvent('GET', '/admin/metrics/usage'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.totalTenants).toBe(2);
    expect(parsed.totalBlobs).toBe(15);
    expect(parsed.totalStorageBytes).toBe(3000);
    expect(parsed.active7d).toBe(1);
    expect(parsed.active30d).toBe(1);
    expect(parsed.charts).toBeDefined();
    expect(parsed.charts.dailySyncRequests).toHaveLength(7);
  });
});

describe('Admin Handler - GET /admin/metrics/health', () => {
  beforeEach(() => {
    mockCwSend.mockReset();
  });

  it('should return health metrics with alarms', async () => {
    mockCwSend.mockResolvedValueOnce({
      MetricAlarms: [
        { AlarmName: 'chaoskb-test-api-errors', StateValue: 'OK', StateReason: 'All good' },
        { AlarmName: 'chaoskb-test-latency', StateValue: 'ALARM', StateReason: 'High latency' },
      ],
    });

    const result = await handler(makeEvent('GET', '/admin/metrics/health'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.services).toHaveLength(2);
    expect(parsed.services[0].status).toBe('healthy');
    expect(parsed.services[1].status).toBe('unhealthy');
    expect(parsed.incidents).toEqual([]);
  });

  it('should return default services when no alarms exist', async () => {
    mockCwSend.mockResolvedValueOnce({ MetricAlarms: [] });

    const result = await handler(makeEvent('GET', '/admin/metrics/health'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.services).toHaveLength(2);
    expect(parsed.services[0].name).toBe('api');
    expect(parsed.services[1].name).toBe('database');
  });
});

describe('Admin Handler - GET /admin/metrics/cost', () => {
  beforeEach(() => {
    mockCeSend.mockReset();
  });

  it('should return cost metrics', async () => {
    // GetCostAndUsage
    mockCeSend.mockResolvedValueOnce({
      ResultsByTime: [
        {
          TimePeriod: { Start: '2026-03-01' },
          Groups: [
            { Keys: ['Amazon DynamoDB'], Metrics: { UnblendedCost: { Amount: '1.50' } } },
            { Keys: ['AWS Lambda'], Metrics: { UnblendedCost: { Amount: '0.25' } } },
          ],
        },
      ],
    });
    // GetCostForecast
    mockCeSend.mockResolvedValueOnce({
      Total: { Amount: '5.00', Unit: 'USD' },
    });

    const result = await handler(makeEvent('GET', '/admin/metrics/cost'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.monthlySpend).toHaveLength(1);
    expect(parsed.spendByService).toHaveLength(2);
    expect(parsed.forecast).toBeDefined();
    expect(parsed.forecast.forecastedTotal).toBe('5.00');
  });
});

describe('Admin Handler - GET /admin/overview', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCwSend.mockReset();
    mockCeSend.mockReset();
  });

  it('should return composite overview', async () => {
    // META scan
    mockSend.mockResolvedValueOnce({
      Items: [
        { storageUsedBytes: 5000 },
        { storageUsedBytes: 3000 },
      ],
      LastEvaluatedKey: undefined,
    });
    // BLOB count scan
    mockSend.mockResolvedValueOnce({ Count: 20, LastEvaluatedKey: undefined });
    // CloudWatch alarms
    mockCwSend.mockResolvedValueOnce({ MetricAlarms: [] });
    // Cost Explorer
    mockCeSend.mockResolvedValueOnce({
      ResultsByTime: [
        { Total: { UnblendedCost: { Amount: '2.50' } } },
      ],
    });

    const result = await handler(makeEvent('GET', '/admin/overview'));

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.totalTenants).toBe(2);
    expect(parsed.totalBlobs).toBe(20);
    expect(parsed.totalStorageBytes).toBe(8000);
    expect(parsed.healthStatus).toBe('healthy');
    expect(parsed.environment).toBe('test');
  });
});
