import { describe, it, expect, vi } from 'vitest';
import { parseQuotaError, getQuotaWarning } from '../quota.js';
import type { QuotaInfo } from '../types.js';

function createMockResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe('parseQuotaError', () => {
  it('should parse a valid 413 response', async () => {
    const response = createMockResponse(413, {
      used: 40 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
    });

    const result = await parseQuotaError(response);

    expect(result).not.toBeNull();
    expect(result!.used).toBe(40 * 1024 * 1024);
    expect(result!.limit).toBe(50 * 1024 * 1024);
    expect(result!.percentage).toBe(80);
  });

  it('should return null for non-413 status', async () => {
    const response = createMockResponse(200, { used: 100, limit: 200 });
    const result = await parseQuotaError(response);
    expect(result).toBeNull();
  });

  it('should return null for invalid body', async () => {
    const response = createMockResponse(413, { error: 'quota_exceeded' });
    const result = await parseQuotaError(response);
    expect(result).toBeNull();
  });

  it('should return null when json parsing fails', async () => {
    const response = {
      status: 413,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    } as unknown as Response;
    const result = await parseQuotaError(response);
    expect(result).toBeNull();
  });

  it('should handle 100% usage', async () => {
    const response = createMockResponse(413, {
      used: 50 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
    });

    const result = await parseQuotaError(response);
    expect(result!.percentage).toBe(100);
  });

  it('should handle zero limit', async () => {
    const response = createMockResponse(413, { used: 0, limit: 0 });
    const result = await parseQuotaError(response);
    expect(result!.percentage).toBe(100);
  });
});

describe('getQuotaWarning', () => {
  it('should return null below 80%', () => {
    const quota: QuotaInfo = {
      used: 30 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 60,
    };
    expect(getQuotaWarning(quota)).toBeNull();
  });

  it('should return warning at 80%', () => {
    const quota: QuotaInfo = {
      used: 40 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 80,
    };
    const warning = getQuotaWarning(quota);
    expect(warning).toContain('80% full');
    expect(warning).toContain('40MB');
    expect(warning).toContain('50MB');
  });

  it('should return nearly full warning at 95%', () => {
    const quota: QuotaInfo = {
      used: 47.5 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 95,
    };
    const warning = getQuotaWarning(quota);
    expect(warning).toContain('nearly full');
    expect(warning).toContain('stored locally only');
  });

  it('should return limit reached at 100%', () => {
    const quota: QuotaInfo = {
      used: 50 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 100,
    };
    const warning = getQuotaWarning(quota);
    expect(warning).toContain('Storage limit reached');
    expect(warning).toContain('not synced');
  });

  it('should return null at 79%', () => {
    const quota: QuotaInfo = {
      used: 39.5 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 79,
    };
    expect(getQuotaWarning(quota)).toBeNull();
  });

  it('should handle percentage between 95 and 100', () => {
    const quota: QuotaInfo = {
      used: 49 * 1024 * 1024,
      limit: 50 * 1024 * 1024,
      percentage: 98,
    };
    const warning = getQuotaWarning(quota);
    expect(warning).toContain('nearly full');
  });
});
