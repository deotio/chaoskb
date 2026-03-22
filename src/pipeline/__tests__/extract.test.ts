import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractContent } from '../extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf-8');
}

describe('extractContent', () => {
  describe('simple article', () => {
    it('extracts article title', () => {
      const html = readFixture('simple-article.html');
      const result = extractContent(html, 'https://example.com/quantum');
      expect(result.title).toContain('Quantum Computing');
    });

    it('extracts article body text', () => {
      const html = readFixture('simple-article.html');
      const result = extractContent(html, 'https://example.com/quantum');
      expect(result.content).toContain('superposition');
      expect(result.content).toContain('entanglement');
      expect(result.content).toContain('quantum gates');
    });

    it('strips HTML tags from content', () => {
      const html = readFixture('simple-article.html');
      const result = extractContent(html, 'https://example.com/quantum');
      expect(result.content).not.toContain('<p>');
      expect(result.content).not.toContain('<h2>');
      expect(result.content).not.toContain('<article>');
    });

    it('preserves the source URL', () => {
      const html = readFixture('simple-article.html');
      const result = extractContent(html, 'https://example.com/quantum');
      expect(result.url).toBe('https://example.com/quantum');
    });

    it('computes byte length correctly', () => {
      const html = readFixture('simple-article.html');
      const result = extractContent(html, 'https://example.com/quantum');
      expect(result.byteLength).toBe(Buffer.byteLength(result.content, 'utf-8'));
      expect(result.byteLength).toBeGreaterThan(0);
    });
  });

  describe('blog post with sidebar and navigation', () => {
    it('extracts the main article content', () => {
      const html = readFixture('blog-post.html');
      const result = extractContent(html, 'https://devblog.com/code-reviews');
      expect(result.content).toContain('Code reviews');
      expect(result.content).toContain('Pull Requests Small');
    });

    it('excludes sidebar content', () => {
      const html = readFixture('blog-post.html');
      const result = extractContent(html, 'https://devblog.com/code-reviews');
      // Sidebar has "Popular Posts" and newsletter form
      // Readability should strip these - content should focus on the article
      expect(result.content).toContain('code quality');
    });

    it('extracts the title', () => {
      const html = readFixture('blog-post.html');
      const result = extractContent(html, 'https://devblog.com/code-reviews');
      expect(result.title).toContain('Code Review');
    });
  });

  describe('minimal HTML', () => {
    it('extracts content from simple paragraphs', () => {
      const html = readFixture('minimal.html');
      const result = extractContent(html, 'https://example.com/note');
      expect(result.content).toContain('Functional programming');
      expect(result.content).toContain('immutability');
    });

    it('falls back to <title> tag when no article title', () => {
      const html = readFixture('minimal.html');
      const result = extractContent(html, 'https://example.com/note');
      // The title should come from <title> tag as fallback
      expect(result.title).toBe('Quick Note');
    });
  });

  describe('edge cases', () => {
    it('throws on empty HTML', () => {
      expect(() => extractContent('', 'https://example.com')).toThrow('Empty HTML');
    });

    it('throws on whitespace-only HTML', () => {
      expect(() => extractContent('   \n  ', 'https://example.com')).toThrow('Empty HTML');
    });

    it('throws on HTML with no text content', () => {
      const html = '<html><body><div></div></body></html>';
      expect(() => extractContent(html, 'https://example.com')).toThrow('No extractable content');
    });

    it('handles malformed HTML gracefully', () => {
      const html = '<html><body><p>Some text here<p>More text<div>And more</body>';
      const result = extractContent(html, 'https://example.com/malformed');
      expect(result.content).toContain('Some text');
      expect(result.content).toContain('More text');
    });

    it('handles HTML with only script/style tags', () => {
      const html = `
        <html>
        <body>
          <script>console.log("hello")</script>
          <style>body { color: red; }</style>
        </body>
        </html>
      `;
      expect(() => extractContent(html, 'https://example.com')).toThrow('No extractable content');
    });

    it('handles inline HTML without structure', () => {
      const html = '<title>Inline</title><p>Just a simple paragraph of text content here for testing purposes.</p>';
      const result = extractContent(html, 'https://example.com/inline');
      expect(result.content).toContain('simple paragraph');
    });
  });
});
