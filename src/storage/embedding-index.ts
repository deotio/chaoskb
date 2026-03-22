import type BetterSqlite3 from 'better-sqlite3';
import type { IEmbeddingIndex } from './types.js';

interface EmbeddingRow {
  source_id: string;
  chunk_index: number;
  embedding: Buffer | null;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

export class EmbeddingIndex implements IEmbeddingIndex {
  private readonly db: BetterSqlite3.Database;
  /** sourceId -> chunkIndex -> embedding */
  private readonly embeddings: Map<string, Map<number, Float32Array>> = new Map();
  private _size = 0;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  load(): void {
    this.embeddings.clear();
    this._size = 0;

    const stmt = this.db.prepare(
      'SELECT source_id, chunk_index, embedding FROM chunks WHERE embedding IS NOT NULL',
    );
    const rows = stmt.all() as EmbeddingRow[];

    for (const row of rows) {
      if (!row.embedding || row.embedding.length === 0) continue;

      const uint8 = new Uint8Array(row.embedding);
      const embedding = new Float32Array(uint8.buffer, uint8.byteOffset, uint8.byteLength / 4);

      let sourceMap = this.embeddings.get(row.source_id);
      if (!sourceMap) {
        sourceMap = new Map();
        this.embeddings.set(row.source_id, sourceMap);
      }
      sourceMap.set(row.chunk_index, embedding);
      this._size++;
    }
  }

  add(sourceId: string, chunks: { chunkIndex: number; embedding: Float32Array }[]): void {
    let sourceMap = this.embeddings.get(sourceId);
    if (!sourceMap) {
      sourceMap = new Map();
      this.embeddings.set(sourceId, sourceMap);
    }

    for (const chunk of chunks) {
      if (!sourceMap.has(chunk.chunkIndex)) {
        this._size++;
      }
      sourceMap.set(chunk.chunkIndex, chunk.embedding);
    }
  }

  remove(sourceId: string): void {
    const sourceMap = this.embeddings.get(sourceId);
    if (sourceMap) {
      this._size -= sourceMap.size;
      this.embeddings.delete(sourceId);
    }
  }

  search(
    query: Float32Array,
    topK: number,
  ): { sourceId: string; chunkIndex: number; score: number }[] {
    const results: { sourceId: string; chunkIndex: number; score: number }[] = [];

    for (const [sourceId, sourceMap] of this.embeddings) {
      for (const [chunkIndex, embedding] of sourceMap) {
        const score = cosineSimilarity(query, embedding);
        results.push({ sourceId, chunkIndex, score });
      }
    }

    // Sort descending by score and take top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  get size(): number {
    return this._size;
  }
}
