import type { McpDependencies } from '../mcp-server.js';

export interface KbQueryInput {
  query: string;
  limit?: number;
}

export interface KbQueryResultItem {
  sourceId: string;
  title: string;
  url: string;
  content: string;
  score: number;
  chunkIndex: number;
}

export interface KbQueryResult {
  results: KbQueryResultItem[];
}

export async function handleKbQuery(
  input: KbQueryInput,
  deps: McpDependencies,
): Promise<KbQueryResult> {
  const { db, pipeline } = deps;
  const limit = input.limit ?? 10;

  // 1. Embed the query using the pipeline embedder
  const queryEmbedding = await pipeline.embed(input.query);

  // 2. Search the embedding index for top-K matches
  const matches = db.embeddingIndex.search(queryEmbedding, limit);

  // 3. For each match, load the chunk content and source metadata
  const results: KbQueryResultItem[] = [];
  for (const match of matches) {
    const source = db.sources.getById(match.sourceId);
    if (!source || source.deletedAt) continue;

    const chunks = db.chunks.getBySourceId(match.sourceId);
    const chunk = chunks.find((c) => c.chunkIndex === match.chunkIndex);
    if (!chunk) continue;

    // Update last accessed timestamp
    db.sources.updateLastAccessed(match.sourceId);

    results.push({
      sourceId: match.sourceId,
      title: source.title,
      url: source.url,
      content: chunk.content,
      score: match.score,
      chunkIndex: match.chunkIndex,
    });
  }

  return { results };
}
