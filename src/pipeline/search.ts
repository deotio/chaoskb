/**
 * Brute-force cosine similarity search over embedding vectors.
 *
 * Designed for in-memory search of up to ~50k 384-dimensional embeddings.
 * At that scale, brute-force cosine similarity is fast enough (<50ms)
 * and avoids the complexity of approximate nearest-neighbor indices.
 */

/**
 * Compute the cosine similarity between two vectors.
 *
 * cosine_similarity = (a . b) / (|a| * |b|)
 *
 * Optimized for Float32Array — no intermediate allocations.
 *
 * @param a - First vector.
 * @param b - Second vector (must be same length as `a`).
 * @returns Cosine similarity in the range [-1, 1]. Returns 0 if either
 *          vector has zero magnitude.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  const len = a.length;
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) {
    return 0;
  }

  return dot / denom;
}

/** A search result with index and similarity score. */
export interface ScoredResult {
  /** Index of the embedding in the input array. */
  index: number;
  /** Cosine similarity score. */
  score: number;
}

/**
 * Search a collection of embeddings for the top-K most similar to a query.
 *
 * @param query - The query embedding vector.
 * @param embeddings - Array of embedding vectors to search.
 * @param topK - Number of top results to return.
 * @returns Array of `{ index, score }` sorted by score descending, length <= topK.
 */
export function searchEmbeddings(
  query: Float32Array,
  embeddings: Float32Array[],
  topK: number,
): ScoredResult[] {
  if (embeddings.length === 0 || topK <= 0) {
    return [];
  }

  const k = Math.min(topK, embeddings.length);

  // Compute all similarities
  const scored: ScoredResult[] = new Array(embeddings.length);
  for (let i = 0; i < embeddings.length; i++) {
    scored[i] = { index: i, score: cosineSimilarity(query, embeddings[i]) };
  }

  // Partial sort: only need top-K. For small K relative to N,
  // a selection algorithm is faster than full sort, but for simplicity
  // and correctness we sort and slice. At 50k embeddings this is <10ms.
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}
