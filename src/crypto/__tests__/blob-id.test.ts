import { describe, it, expect } from 'vitest';
import { generateBlobId } from '../blob-id.js';

const BASE62_REGEX = /^b_[0-9a-zA-Z]+$/;

describe('generateBlobId', () => {
  it('should start with b_ prefix', () => {
    const id = generateBlobId();
    expect(id.startsWith('b_')).toBe(true);
  });

  it('should only contain base62 characters after prefix', () => {
    const id = generateBlobId();
    expect(BASE62_REGEX.test(id)).toBe(true);
  });

  it('should have sufficient length (21-22 chars after prefix)', () => {
    // 16 bytes = 128 bits -> base62 encoding produces ~21-22 characters
    const id = generateBlobId();
    const body = id.slice(2);
    expect(body.length).toBeGreaterThanOrEqual(20);
    expect(body.length).toBeLessThanOrEqual(23);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateBlobId());
    }
    expect(ids.size).toBe(1000);
  });

  it('should not contain type information in the ID', () => {
    // IDs should be opaque — no 'source', 'chunk', 'canary' prefixes
    const id = generateBlobId();
    expect(id).not.toContain('source');
    expect(id).not.toContain('chunk');
    expect(id).not.toContain('canary');
  });
});
