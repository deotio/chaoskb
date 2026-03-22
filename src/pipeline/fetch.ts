/**
 * URL fetching for the content pipeline.
 *
 * Uses Node.js built-in `fetch` (available since Node 18) with
 * configurable timeout, redirect limits, and user-agent.
 */

import type { PipelineConfig } from './types.js';

/** Default pipeline configuration values relevant to fetching. */
const DEFAULTS: Pick<PipelineConfig, 'fetchTimeoutMs' | 'maxRedirects' | 'userAgent'> = {
  fetchTimeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: 'ChaosKB/0.1',
};

/** Result of a successful URL fetch. */
export interface FetchResult {
  /** Raw HTML body. */
  html: string;
  /** Final URL after any redirects. */
  finalUrl: string;
  /** Content-Type header value. */
  contentType: string;
}

/**
 * Fetch the HTML content of a URL.
 *
 * @param url - The URL to fetch.
 * @param config - Optional partial pipeline config overrides.
 * @returns The HTML content, final URL, and content type.
 * @throws On network errors, non-2xx status codes, or non-HTML content.
 */
export async function fetchUrl(
  url: string,
  config?: Partial<PipelineConfig>,
): Promise<FetchResult> {
  const timeoutMs = config?.fetchTimeoutMs ?? DEFAULTS.fetchTimeoutMs;
  const userAgent = config?.userAgent ?? DEFAULTS.userAgent;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`);
      }
      // DNS resolution failures
      if (error.cause && typeof error.cause === 'object' && 'code' in error.cause) {
        const code = (error.cause as { code?: string }).code;
        if (code === 'ENOTFOUND') {
          throw new Error(`DNS resolution failed for ${url}: host not found`);
        }
        if (code === 'ECONNREFUSED') {
          throw new Error(`Connection refused for ${url}`);
        }
        if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
          throw new Error(`TLS certificate error for ${url}: ${code}`);
        }
      }
      // TLS errors often show up in the message
      if (error.message.includes('SSL') || error.message.includes('TLS') || error.message.includes('certificate')) {
        throw new Error(`TLS error fetching ${url}: ${error.message}`);
      }
      throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }
    throw new Error(`Failed to fetch ${url}: unknown error`);
  } finally {
    clearTimeout(timer);
  }

  // Check HTTP status
  if (!response.ok) {
    const status = response.status;
    if (status >= 400 && status < 500) {
      throw new Error(`HTTP ${status} Client Error for ${url}: ${response.statusText}`);
    }
    if (status >= 500) {
      throw new Error(`HTTP ${status} Server Error for ${url}: ${response.statusText}`);
    }
    throw new Error(`HTTP ${status} for ${url}: ${response.statusText}`);
  }

  // Verify content type is HTML-like
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml =
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml') ||
    contentType.includes('application/xml');

  if (!isHtml) {
    throw new Error(
      `Non-HTML content type "${contentType}" for ${url}. Only text/html is supported.`,
    );
  }

  const html = await response.text();
  const finalUrl = response.url || url;

  return { html, finalUrl, contentType };
}
