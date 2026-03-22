import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchUrl } from '../fetch.js';

let server: Server;
let baseUrl: string;

function createHandler() {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    if (url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><p>Hello World</p></body></html>');
      return;
    }

    if (url === '/redirect') {
      res.writeHead(301, { Location: `${baseUrl}/ok` });
      res.end();
      return;
    }

    if (url === '/double-redirect') {
      res.writeHead(302, { Location: `${baseUrl}/redirect` });
      res.end();
      return;
    }

    if (url === '/not-found') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('Not Found');
      return;
    }

    if (url === '/server-error') {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('Internal Server Error');
      return;
    }

    if (url === '/json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"key": "value"}');
      return;
    }

    if (url === '/pdf') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end(Buffer.from([0x25, 0x50, 0x44, 0x46]));
      return;
    }

    if (url === '/slow') {
      // Intentionally don't respond for timeout testing
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>slow</body></html>');
      }, 5000);
      return;
    }

    if (url === '/xhtml') {
      res.writeHead(200, { 'Content-Type': 'application/xhtml+xml' });
      res.end('<html><body><p>XHTML content</p></body></html>');
      return;
    }

    if (url === '/check-ua') {
      const ua = req.headers['user-agent'] ?? '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>${ua}</body></html>`);
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

beforeAll(async () => {
  server = createServer(createHandler());
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('fetchUrl', () => {
  it('fetches HTML content successfully', async () => {
    const result = await fetchUrl(`${baseUrl}/ok`);
    expect(result.html).toContain('Hello World');
    expect(result.contentType).toContain('text/html');
    expect(result.finalUrl).toBe(`${baseUrl}/ok`);
  });

  it('follows redirects', async () => {
    const result = await fetchUrl(`${baseUrl}/redirect`);
    expect(result.html).toContain('Hello World');
    expect(result.finalUrl).toBe(`${baseUrl}/ok`);
  });

  it('follows multiple redirects', async () => {
    const result = await fetchUrl(`${baseUrl}/double-redirect`);
    expect(result.html).toContain('Hello World');
    expect(result.finalUrl).toBe(`${baseUrl}/ok`);
  });

  it('throws on 404', async () => {
    await expect(fetchUrl(`${baseUrl}/not-found`)).rejects.toThrow('HTTP 404 Client Error');
  });

  it('throws on 500', async () => {
    await expect(fetchUrl(`${baseUrl}/server-error`)).rejects.toThrow('HTTP 500 Server Error');
  });

  it('rejects non-HTML content (JSON)', async () => {
    await expect(fetchUrl(`${baseUrl}/json`)).rejects.toThrow('Non-HTML content type');
  });

  it('rejects non-HTML content (PDF)', async () => {
    await expect(fetchUrl(`${baseUrl}/pdf`)).rejects.toThrow('Non-HTML content type');
  });

  it('accepts XHTML content', async () => {
    const result = await fetchUrl(`${baseUrl}/xhtml`);
    expect(result.html).toContain('XHTML content');
  });

  it('times out on slow responses', async () => {
    await expect(
      fetchUrl(`${baseUrl}/slow`, { fetchTimeoutMs: 200 }),
    ).rejects.toThrow('timed out');
  });

  it('sends correct User-Agent header', async () => {
    const result = await fetchUrl(`${baseUrl}/check-ua`);
    expect(result.html).toContain('ChaosKB/0.1');
  });

  it('uses custom User-Agent when configured', async () => {
    const result = await fetchUrl(`${baseUrl}/check-ua`, {
      userAgent: 'CustomBot/2.0',
    });
    expect(result.html).toContain('CustomBot/2.0');
  });

  it('throws on DNS resolution failure', async () => {
    await expect(
      fetchUrl('http://this-domain-does-not-exist-xyz123.example.com/page'),
    ).rejects.toThrow();
  });

  it('throws on connection refused', async () => {
    // Port 1 is very unlikely to have a server
    await expect(fetchUrl('http://127.0.0.1:1/page')).rejects.toThrow();
  });
});
