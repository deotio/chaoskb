import * as crypto from 'crypto';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../logger.js';

export interface AuthResult {
  tenantId: string;
  publicKey: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

interface ParsedAuthHeader {
  publicKey: string;
  timestamp: string;
  signature: string;
}

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

export function parseAuthHeader(header: string): ParsedAuthHeader {
  if (!header.startsWith('ChaosKB-SSH ')) {
    throw new AuthError('Invalid authorization scheme', 401);
  }

  const params = header.slice('ChaosKB-SSH '.length);
  const fields: Record<string, string> = {};

  for (const part of params.split(', ')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) {
      throw new AuthError('Malformed authorization header', 401);
    }
    const key = part.slice(0, eqIndex);
    const value = part.slice(eqIndex + 1);
    fields[key] = value;
  }

  if (!fields['pubkey'] || !fields['ts'] || !fields['sig']) {
    throw new AuthError('Missing required authorization fields (pubkey, ts, sig)', 401);
  }

  return {
    publicKey: fields['pubkey'],
    timestamp: fields['ts'],
    signature: fields['sig'],
  };
}

export function verifyTimestamp(timestamp: string): void {
  const requestTime = new Date(timestamp).getTime();
  if (isNaN(requestTime)) {
    throw new AuthError('Invalid timestamp format', 401);
  }

  const now = Date.now();
  const diff = Math.abs(now - requestTime);
  if (diff > TIMESTAMP_TOLERANCE_MS) {
    throw new AuthError('Request timestamp expired', 401);
  }
}

export function buildCanonicalString(
  method: string,
  path: string,
  timestamp: string,
  body?: string | null,
): string {
  const bodyHash = body
    ? crypto.createHash('sha256').update(body).digest('hex')
    : '';
  return `chaoskb-auth\n${method} ${path}\n${timestamp}\n${bodyHash}`;
}

export function verifyEd25519Signature(
  publicKeyBase64: string,
  canonicalString: string,
  signatureBase64: string,
): boolean {
  try {
    const publicKeyBuffer = Buffer.from(publicKeyBase64, 'base64');
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const data = Buffer.from(canonicalString);

    // Create Ed25519 public key object from raw bytes
    const keyObject = crypto.createPublicKey({
      key: Buffer.concat([
        // Ed25519 DER prefix for a 32-byte public key
        Buffer.from('302a300506032b6570032100', 'hex'),
        publicKeyBuffer,
      ]),
      format: 'der',
      type: 'spki',
    });

    return crypto.verify(null, data, keyObject, signatureBuffer);
  } catch {
    return false;
  }
}

function tenantIdFromPublicKey(publicKeyBase64: string): string {
  const hash = crypto.createHash('sha256').update(publicKeyBase64).digest('hex');
  return hash.slice(0, 32);
}

export async function authenticateRequest(
  event: {
    requestContext: { http: { method: string; path: string } };
    headers: Record<string, string>;
    body?: string | null;
  },
  ddb: DynamoDBDocumentClient,
  tableName: string,
): Promise<AuthResult> {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader) {
    throw new AuthError('Missing Authorization header', 401);
  }

  const parsed = parseAuthHeader(authHeader);
  verifyTimestamp(parsed.timestamp);

  const tenantId = tenantIdFromPublicKey(parsed.publicKey);

  // Look up the registered public key in DynamoDB
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': 'META',
      },
      Limit: 1,
    }),
  );

  if (!result.Items || result.Items.length === 0) {
    throw new AuthError('Unknown public key', 401);
  }

  const tenant = result.Items[0];
  if (tenant['publicKey'] !== parsed.publicKey) {
    throw new AuthError('Public key mismatch', 401);
  }

  // Verify the SSH signature
  const canonicalString = buildCanonicalString(
    event.requestContext.http.method,
    event.requestContext.http.path,
    parsed.timestamp,
    event.body,
  );

  const valid = verifyEd25519Signature(
    parsed.publicKey,
    canonicalString,
    parsed.signature,
  );

  if (!valid) {
    logger.warn('Signature verification failed', { tenantId });
    throw new AuthError('Invalid signature', 401);
  }

  return { tenantId, publicKey: parsed.publicKey };
}
