/**
 * Content extraction from HTML using Mozilla Readability.
 *
 * Parses HTML with `linkedom` and runs it through Readability to pull out
 * the main article content, stripped of navigation, ads, and boilerplate.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { ExtractedContent } from './types.js';

/**
 * Extract the main article content from an HTML string.
 *
 * @param html - The raw HTML string to extract content from.
 * @param url - The source URL (used for resolving relative links and metadata).
 * @returns Extracted content with title, plain text, URL, and byte length.
 * @throws If no article content can be extracted.
 */
export function extractContent(html: string, url: string): ExtractedContent {
  if (!html || html.trim().length === 0) {
    throw new Error(`Empty HTML content from ${url}`);
  }

  const { document } = parseHTML(html);

  // Attempt Readability extraction
  const reader = new Readability(document as any);
  const article = reader.parse();

  let title: string;
  let rawContent: string;

  if (article && article.textContent && article.textContent.trim().length > 0) {
    title = article.title || '';
    rawContent = article.textContent;
  } else {
    // Fallback: extract text from body (strip script/style first)
    // Wrap in a full HTML document to ensure linkedom creates a body element
    const wrappedHtml = html.includes('<body') ? html : `<html><body>${html}</body></html>`;
    const { document: fallbackDoc } = parseHTML(wrappedHtml);
    for (const el of fallbackDoc.querySelectorAll('script, style')) {
      el.remove();
    }
    const body = fallbackDoc.querySelector('body');
    rawContent = body ? body.textContent ?? '' : '';

    if (rawContent.trim().length === 0) {
      throw new Error(`No extractable content from ${url}`);
    }

    title = '';
  }

  // Fallback title: try <title> tag from a fresh parse
  if (!title) {
    const { document: titleDoc } = parseHTML(html);
    const titleEl = titleDoc.querySelector('title');
    title = titleEl?.textContent?.trim() ?? '';
  }

  // Clean up the text: collapse whitespace runs, trim lines
  const content = cleanText(rawContent);

  if (content.length === 0) {
    throw new Error(`No extractable content from ${url}`);
  }

  const byteLength = Buffer.byteLength(content, 'utf-8');

  return { title, content, url, byteLength };
}

/**
 * Clean extracted text by collapsing whitespace and trimming.
 */
function cleanText(text: string): string {
  return text
    .replace(/[\t ]+/g, ' ')       // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')    // collapse excessive newlines
    .replace(/^ +| +$/gm, '')      // trim each line
    .trim();
}
