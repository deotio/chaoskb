import type { McpDependencies } from '../mcp-server.js';

export interface KbSummaryInput {
  period: 'week' | 'month' | 'year' | string;
}

export interface KbSummaryArticle {
  title: string;
  url: string;
  date: string;
  chunkCount: number;
  tags: string[];
  preview: string;
}

export interface KbSummaryResult {
  period: string;
  totalArticles: number;
  totalChunks: number;
  articles: KbSummaryArticle[];
}

/**
 * Calculate the date range from a period specification.
 * @returns [startDate, endDate] as ISO date strings (YYYY-MM-DD)
 */
export function calculateDateRange(period: string): { start: string; end: string; label: string } {
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];

  switch (period) {
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return {
        start: start.toISOString().split('T')[0],
        end: endDate,
        label: `${start.toISOString().split('T')[0]} to ${endDate}`,
      };
    }
    case 'month': {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return {
        start: start.toISOString().split('T')[0],
        end: endDate,
        label: `${start.toISOString().split('T')[0]} to ${endDate}`,
      };
    }
    case 'year': {
      const start = new Date(now);
      start.setFullYear(start.getFullYear() - 1);
      return {
        start: start.toISOString().split('T')[0],
        end: endDate,
        label: `${start.toISOString().split('T')[0]} to ${endDate}`,
      };
    }
    default: {
      // Custom range: "YYYY-MM-DD:YYYY-MM-DD"
      const parts = period.split(':');
      if (parts.length !== 2) {
        throw new Error(
          `Invalid period format: "${period}". Use "week", "month", "year", or "YYYY-MM-DD:YYYY-MM-DD".`,
        );
      }
      const [start, end] = parts;
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        throw new Error(
          `Invalid date format in period: "${period}". Use "YYYY-MM-DD:YYYY-MM-DD".`,
        );
      }
      return { start, end, label: `${start} to ${end}` };
    }
  }
}

export async function handleKbSummary(
  input: KbSummaryInput,
  deps: McpDependencies,
): Promise<KbSummaryResult> {
  const { db } = deps;

  const range = calculateDateRange(input.period);

  // Query sources within the date range
  const sources = db.sources.list(
    {
      since: range.start,
      includeDeleted: false,
    },
    { limit: 1000, offset: 0 },
  );

  // Filter by end date and collect results
  const endDateObj = new Date(range.end + 'T23:59:59.999Z');
  const filteredSources = sources.filter((s) => {
    const createdAt = new Date(s.createdAt);
    return createdAt <= endDateObj;
  });

  let totalChunks = 0;
  const articles: KbSummaryArticle[] = [];

  for (const source of filteredSources) {
    totalChunks += source.chunkCount;

    // Get first chunk as preview
    const chunks = db.chunks.getBySourceId(source.id);
    const firstChunk = chunks.find((c) => c.chunkIndex === 0);
    const preview = firstChunk?.content ?? '';

    articles.push({
      title: source.title,
      url: source.url,
      date: source.createdAt,
      chunkCount: source.chunkCount,
      tags: source.tags,
      preview,
    });
  }

  return {
    period: range.label,
    totalArticles: filteredSources.length,
    totalChunks,
    articles,
  };
}
