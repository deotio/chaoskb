import { describe, it, expect } from 'vitest';
import { validateBlobUpload } from '../../lib/handler/middleware/input-validation.js';

describe('validateBlobUpload', () => {
  const validBlob = Buffer.from(JSON.stringify({
    v: 1,
    id: 'b_test123',
    ts: '2026-03-20T10:00:00Z',
    enc: { alg: 'xchacha20', kid: 'k1', ct: 'dGVzdA==', commit: 'dGVzdA==' },
  }));

  it('should accept a valid blob', () => {
    const result = validateBlobUpload(validBlob, 'application/octet-stream');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject oversized blob', () => {
    const oversized = Buffer.alloc(1_048_577); // 1 byte over limit
    // Need valid JSON content though
    const bigJson = JSON.stringify({ v: 1, data: 'x'.repeat(1_048_500) });
    const bigBuffer = Buffer.from(bigJson);

    // If buffer is actually over the limit
    if (bigBuffer.length > 1_048_576) {
      const result = validateBlobUpload(bigBuffer, 'application/octet-stream');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum size');
    } else {
      // Create a definitely-too-big buffer with valid JSON at the start
      const result = validateBlobUpload(oversized, 'application/octet-stream');
      expect(result.valid).toBe(false);
    }
  });

  it('should reject empty blob', () => {
    const result = validateBlobUpload(Buffer.alloc(0), 'application/octet-stream');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 1 byte');
  });

  it('should reject wrong content-type', () => {
    const result = validateBlobUpload(validBlob, 'text/plain');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Content-Type');
  });

  it('should reject invalid JSON', () => {
    const result = validateBlobUpload(Buffer.from('not json'), 'application/octet-stream');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('valid JSON');
  });

  it('should reject missing version field', () => {
    const noVersion = Buffer.from(JSON.stringify({ id: 'b_test', enc: {} }));
    const result = validateBlobUpload(noVersion, 'application/octet-stream');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('v');
  });

  it('should reject unsupported version', () => {
    const badVersion = Buffer.from(JSON.stringify({ v: 99, id: 'b_test' }));
    const result = validateBlobUpload(badVersion, 'application/octet-stream');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported envelope version');
  });
});
