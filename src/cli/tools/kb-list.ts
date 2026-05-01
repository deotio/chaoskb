import type { McpDependencies } from '../mcp-server.js';

export interface KbListInput {
  limit?: number;
  offset?: number;
  tags?: string[];
}

export interface KbListSourceItem {
  id: string;
  title: string;
  url: string;
  tags: string[];
  chunkCount: number;
  createdAt: string;
}

export interface KbListResult {
  sources: KbListSourceItem[];
  total: number;
}

export async function handleKbList(
  input: KbListInput,
  deps: McpDependencies,
): Promise<KbListResult> {
  const { db } = deps;
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  const filter = {
    tags: input.tags,
    includeDeleted: false,
  };

  const pagination = { limit, offset };

  const sources = db.sources.list(filter, pagination);
  const total = db.sources.count(filter);

  return {
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      tags: s.tags,
      chunkCount: s.chunkCount,
      createdAt: s.createdAt,
    })),
    total,
  };
}
