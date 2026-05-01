import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'PutCommand'; }),
  GetCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'GetCommand'; }),
  UpdateCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'UpdateCommand'; }),
  QueryCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; this._type = 'QueryCommand'; }),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {}),
}));

import {
  handlePutBlob,
  handleGetBlob,
  handleDeleteBlob,
  handleListBlobs,
  handleCountBlobs,
} from '../../lib/handler/routes/blobs.js';

const TABLE_NAME = 'chaoskb-test';
const TENANT_ID = 'test-tenant-123';
const ddb = { send: mockSend } as any;

function makeValidBlob(): string {
  return JSON.stringify({ v: 1, id: 'b_test123', ts: '2026-03-20T10:00:00Z', enc: { alg: 'xchacha20', kid: 'k1', ct: 'dGVzdA==', commit: 'dGVzdA==' } });
}

describe('PUT /v1/blobs/{id}', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should upload a blob successfully', async () => {
    // Rate limit check
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // Quota check
    mockSend.mockResolvedValueOnce({ Item: { storageUsedBytes: 0 } });
    // PutCommand (write-if-absent)
    mockSend.mockResolvedValueOnce({});
    // Update storage
    mockSend.mockResolvedValueOnce({});

    const body = makeValidBlob();
    const result = await handlePutBlob(
      'b_test123',
      TENANT_ID,
      body,
      false,
      'application/octet-stream',
      ddb,
      TABLE_NAME,
    );

    expect(result.statusCode).toBe(201);
    const parsed = JSON.parse(result.body);
    expect(parsed.id).toBe('b_test123');
    expect(parsed.size).toBeGreaterThan(0);
    expect(parsed.sha256).toBeDefined();
    expect(parsed.ts).toBeDefined();
  });

  it('should return 413 when quota exceeded', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // Quota check — already at limit
    mockSend.mockResolvedValueOnce({ Item: { storageUsedBytes: 50 * 1024 * 1024 } });

    const body = makeValidBlob();
    const result = await handlePutBlob(
      'b_test123',
      TENANT_ID,
      body,
      false,
      'application/octet-stream',
      ddb,
      TABLE_NAME,
    );

    expect(result.statusCode).toBe(413);
    expect(JSON.parse(result.body).error).toBe('quota_exceeded');
  });

  it('should return 409 when blob already exists', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // Quota check
    mockSend.mockResolvedValueOnce({ Item: { storageUsedBytes: 0 } });
    // PutCommand fails with condition check
    const condError = new Error('Condition not met');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condError);

    const body = makeValidBlob();
    const result = await handlePutBlob(
      'b_test123',
      TENANT_ID,
      body,
      false,
      'application/octet-stream',
      ddb,
      TABLE_NAME,
    );

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('blob_exists');
  });

  it('should return 400 for invalid input', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });

    const result = await handlePutBlob(
      'b_test123',
      TENANT_ID,
      'not valid json',
      false,
      'application/octet-stream',
      ddb,
      TABLE_NAME,
    );

    expect(result.statusCode).toBe(400);
  });

  it('should return 400 for wrong content-type', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });

    const body = makeValidBlob();
    const result = await handlePutBlob(
      'b_test123',
      TENANT_ID,
      body,
      false,
      'text/plain',
      ddb,
      TABLE_NAME,
    );

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Content-Type');
  });
});

describe('GET /v1/blobs/{id}', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should download a blob successfully', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // GetCommand
    mockSend.mockResolvedValueOnce({
      Item: {
        PK: `TENANT#${TENANT_ID}`,
        SK: 'BLOB#b_test123',
        data: Buffer.from('test data'),
        size: 9,
        updatedAt: '2026-03-20T10:00:00Z',
      },
    });

    const result = await handleGetBlob('b_test123', TENANT_ID, ddb, TABLE_NAME);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/octet-stream');
  });

  it('should return 404 when blob not found', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // GetCommand — empty
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const result = await handleGetBlob('b_notfound', TENANT_ID, ddb, TABLE_NAME);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBe('not_found');
  });
});

describe('DELETE /v1/blobs/{id}', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should soft delete a blob successfully', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // GetCommand (get size)
    mockSend.mockResolvedValueOnce({ Item: { size: 1024 } });
    // UpdateCommand (soft delete)
    mockSend.mockResolvedValueOnce({});
    // UpdateCommand (decrement storage)
    mockSend.mockResolvedValueOnce({});

    const result = await handleDeleteBlob('b_test123', TENANT_ID, ddb, TABLE_NAME);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).deleted).toBe(true);
  });
});

describe('GET /v1/blobs (list)', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should list blobs without since parameter', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // QueryCommand
    mockSend.mockResolvedValueOnce({
      Items: [
        { SK: 'BLOB#b_1', size: 100, updatedAt: '2026-03-20T10:00:00Z' },
        { SK: 'BLOB#b_2', size: 200, updatedAt: '2026-03-20T10:00:01Z', deletedAt: '2026-03-20T11:00:00Z' },
      ],
    });

    const result = await handleListBlobs(TENANT_ID, undefined, ddb, TABLE_NAME);

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.blobs).toHaveLength(1);
    expect(parsed.tombstones).toHaveLength(1);
    expect(parsed.blobs[0].id).toBe('b_1');
    expect(parsed.tombstones[0].id).toBe('b_2');
  });

  it('should list blobs with since parameter', async () => {
    // Rate limit
    mockSend.mockResolvedValueOnce({ Attributes: { count: 1 } });
    // QueryCommand (GSI)
    mockSend.mockResolvedValueOnce({
      Items: [
        { SK: 'BLOB#b_3', size: 300, updatedAt: '2026-03-20T12:00:00Z' },
      ],
    });

    const result = await handleListBlobs(TENANT_ID, '2026-03-20T11:00:00Z', ddb, TABLE_NAME);

    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.blobs).toHaveLength(1);
  });
});

describe('GET /v1/blobs/count', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('should return correct count', async () => {
    mockSend.mockResolvedValueOnce({ Count: 42 });

    const result = await handleCountBlobs(TENANT_ID, ddb, TABLE_NAME);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).count).toBe(42);
  });
});
