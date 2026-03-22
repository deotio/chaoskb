import { chunkText } from './chunker.js';
import type { Embedder } from './embedder.js';
import { extractContent } from './extract.js';
import { fetchUrl } from './fetch.js';
import { searchEmbeddings } from './search.js';
import type {
  Chunk,
  EmbeddedChunk,
  EmbeddingVector,
  ExtractedContent,
  IContentPipeline,
  PipelineConfig,
} from './types.js';

/**
 * Concrete implementation of IContentPipeline.
 *
 * Orchestrates fetching, extraction, chunking, embedding, and search
 * by delegating to the standalone pipeline functions and an injected Embedder.
 */
export class ContentPipeline implements IContentPipeline {
  private readonly config: Partial<PipelineConfig>;
  private readonly embedder: Embedder;

  constructor(config: Partial<PipelineConfig>, embedder: Embedder) {
    this.config = config;
    this.embedder = embedder;
  }

  /** Fetch a URL and extract its main article content. */
  async fetchAndExtract(url: string): Promise<ExtractedContent> {
    const result = await fetchUrl(url, this.config);
    return extractContent(result.html, result.finalUrl);
  }

  /** Split text into overlapping chunks. */
  chunk(text: string): Chunk[] {
    return chunkText(text, {
      maxTokens: this.config.maxChunkTokens ?? 500,
      overlapTokens: this.config.overlapTokens ?? 50,
    });
  }

  /** Embed a single text string. */
  async embed(text: string): Promise<EmbeddingVector> {
    return this.embedder.embed(text);
  }

  /** Embed multiple chunks and zip results into EmbeddedChunk[]. */
  async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const vectors = await this.embedder.embedBatch(chunks.map((c) => c.content));
    return chunks.map((chunk, i) => ({
      ...chunk,
      embedding: vectors[i],
      model: 'snowflake-arctic-embed-s@384',
    }));
  }

  /** Search embeddings for the top-K most similar, returning their indices. */
  search(query: EmbeddingVector, embeddings: EmbeddingVector[], topK: number): number[] {
    const results = searchEmbeddings(query, embeddings, topK);
    return results.map((r) => r.index);
  }
}
