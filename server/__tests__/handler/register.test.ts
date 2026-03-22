import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockSsmSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockSsmSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({ send: mockSend }),
  },
  PutCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; }),
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {}),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: vi.fn().mockImplementation(function (this: any) { this.send = mockSsmSend; }),
  GetParameterCommand: vi.fn().mockImplementation(function (this: any, input: any) { this.input = input; }),
}));

import { handleRegister, _resetSignupsCache } from '../../lib/handler/routes/register.js';

const TABLE_NAME = 'chaoskb-test';
const PARAM_NAME = '/chaoskb/test/signups-enabled';
const ddb = { send: mockSend } as any;

// A valid base64 public key (32 bytes for Ed25519)
const VALID_PUBLIC_KEY = Buffer.from('a'.repeat(32)).toString('base64');

describe('POST /v1/auth/register', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSsmSend.mockReset();
    _resetSignupsCache();
  });

  it('should register successfully (201)', async () => {
    // SSM returns signups enabled
    mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: 'true' } });
    // DynamoDB PutCommand succeeds
    mockSend.mockResolvedValueOnce({});

    const body = JSON.stringify({ publicKey: VALID_PUBLIC_KEY });
    const result = await handleRegister(body, ddb, TABLE_NAME, PARAM_NAME);

    expect(result.statusCode).toBe(201);
    const parsed = JSON.parse(result.body);
    expect(parsed.tenantId).toBeDefined();
    expect(parsed.publicKey).toBe(VALID_PUBLIC_KEY);
  });

  it('should return 403 when signups disabled', async () => {
    mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: 'false' } });

    const body = JSON.stringify({ publicKey: VALID_PUBLIC_KEY });
    const result = await handleRegister(body, ddb, TABLE_NAME, PARAM_NAME);

    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toBe('signups_disabled');
  });

  it('should return 409 when already registered', async () => {
    mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: 'true' } });
    const condError = new Error('Condition not met');
    condError.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condError);

    const body = JSON.stringify({ publicKey: VALID_PUBLIC_KEY });
    const result = await handleRegister(body, ddb, TABLE_NAME, PARAM_NAME);

    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toBe('already_registered');
  });

  it('should cache SSM parameter for 5 minutes', async () => {
    mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: 'true' } });
    mockSend.mockResolvedValue({});

    const body = JSON.stringify({ publicKey: VALID_PUBLIC_KEY });

    // First call fetches from SSM
    await handleRegister(body, ddb, TABLE_NAME, PARAM_NAME);
    // Second call uses cache — SSM send should only have been called once
    // Need to reset condError for second call
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    const result = await handleRegister(body, ddb, TABLE_NAME, PARAM_NAME);

    // SSM was only called once total
    expect(mockSsmSend).toHaveBeenCalledTimes(1);
    // The second call may get 409 (already_registered) or 201, but the point is SSM was cached
    expect([201, 409]).toContain(result.statusCode);
  });
});
