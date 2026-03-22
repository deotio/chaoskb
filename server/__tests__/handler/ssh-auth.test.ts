import { describe, it, expect } from 'vitest';
import { parseAuthHeader, verifyTimestamp, buildCanonicalString, AuthError } from '../../lib/handler/middleware/ssh-auth.js';

describe('parseAuthHeader', () => {
  it('should parse a valid auth header', () => {
    const header = 'ChaosKB-SSH pubkey=dGVzdA==, ts=2026-03-20T10:00:00Z, sig=c2lnbmF0dXJl';
    const result = parseAuthHeader(header);

    expect(result.publicKey).toBe('dGVzdA==');
    expect(result.timestamp).toBe('2026-03-20T10:00:00Z');
    expect(result.signature).toBe('c2lnbmF0dXJl');
  });

  it('should reject invalid authorization scheme', () => {
    expect(() => parseAuthHeader('Bearer token123')).toThrow(AuthError);
    expect(() => parseAuthHeader('Bearer token123')).toThrow('Invalid authorization scheme');
  });

  it('should reject missing fields', () => {
    expect(() => parseAuthHeader('ChaosKB-SSH pubkey=dGVzdA==')).toThrow(AuthError);
    expect(() => parseAuthHeader('ChaosKB-SSH pubkey=dGVzdA==')).toThrow('Missing required authorization fields');
  });

  it('should reject malformed header parts', () => {
    expect(() => parseAuthHeader('ChaosKB-SSH invalidpart')).toThrow(AuthError);
  });
});

describe('verifyTimestamp', () => {
  it('should accept timestamp within 5 minutes', () => {
    const now = new Date().toISOString();
    expect(() => verifyTimestamp(now)).not.toThrow();
  });

  it('should reject timestamp older than 5 minutes', () => {
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    expect(() => verifyTimestamp(old)).toThrow(AuthError);
    expect(() => verifyTimestamp(old)).toThrow('Request timestamp expired');
  });

  it('should reject future timestamp beyond 5 minutes', () => {
    const future = new Date(Date.now() + 6 * 60 * 1000).toISOString();
    expect(() => verifyTimestamp(future)).toThrow(AuthError);
  });

  it('should reject invalid timestamp format', () => {
    expect(() => verifyTimestamp('not-a-date')).toThrow(AuthError);
    expect(() => verifyTimestamp('not-a-date')).toThrow('Invalid timestamp format');
  });
});

describe('buildCanonicalString', () => {
  it('should build canonical string with body', () => {
    const result = buildCanonicalString('PUT', '/v1/blobs/b_123', '2026-03-20T10:00:00Z', '{"v":1}');
    const lines = result.split('\n');

    expect(lines[0]).toBe('chaoskb-auth');
    expect(lines[1]).toBe('PUT /v1/blobs/b_123');
    expect(lines[2]).toBe('2026-03-20T10:00:00Z');
    expect(lines[3]).toHaveLength(64); // SHA-256 hex digest
  });

  it('should build canonical string without body', () => {
    const result = buildCanonicalString('GET', '/v1/blobs', '2026-03-20T10:00:00Z', null);
    const lines = result.split('\n');

    expect(lines[0]).toBe('chaoskb-auth');
    expect(lines[1]).toBe('GET /v1/blobs');
    expect(lines[2]).toBe('2026-03-20T10:00:00Z');
    expect(lines[3]).toBe('');
  });
});
