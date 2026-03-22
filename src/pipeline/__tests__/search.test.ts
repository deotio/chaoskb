import { describe, expect, it } from 'vitest';
import { cosineSimilarity, searchEmbeddings } from '../search.js';

/** Helper: create a Float32Array from regular numbers. */
function vec(...values: number[]): Float32Array {
  return new Float32Array(values);
}

/** Helper: create a random unit vector of given dimension. */
function randomUnitVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let mag = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() - 0.5;
    mag += v[i] * v[i];
  }
  mag = Math.sqrt(mag);
  for (let i = 0; i < dim; i++) {
    v[i] /= mag;
  }
  return v;
}

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = vec(1, 2, 3);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
  });

  it('returns 1.0 for parallel vectors (different magnitude)', () => {
    const a = vec(1, 2, 3);
    const b = vec(2, 4, 6);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = vec(1, 2, 3);
    const b = vec(-1, -2, -3);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = vec(1, 0, 0);
    const b = vec(0, 1, 0);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns 0.0 when one vector is zero', () => {
    const a = vec(1, 2, 3);
    const b = vec(0, 0, 0);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('is symmetric: sim(a,b) === sim(b,a)', () => {
    const a = vec(1, 3, -2);
    const b = vec(-1, 2, 4);
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });

  it('throws on dimension mismatch', () => {
    const a = vec(1, 2, 3);
    const b = vec(1, 2);
    expect(() => cosineSimilarity(a, b)).toThrow('dimension mismatch');
  });

  it('works with 384-dimensional vectors', () => {
    const a = randomUnitVector(384);
    const b = randomUnitVector(384);
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1.0);
    expect(sim).toBeLessThanOrEqual(1.0);
  });

  it('self-similarity of unit vector is 1.0', () => {
    const a = randomUnitVector(384);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1.0, 5);
  });
});

describe('searchEmbeddings', () => {
  it('returns empty array for empty embeddings', () => {
    const query = vec(1, 0, 0);
    expect(searchEmbeddings(query, [], 5)).toEqual([]);
  });

  it('returns empty array for topK = 0', () => {
    const query = vec(1, 0, 0);
    const embeddings = [vec(1, 0, 0)];
    expect(searchEmbeddings(query, embeddings, 0)).toEqual([]);
  });

  it('returns the most similar embedding first', () => {
    const query = vec(1, 0, 0);
    const embeddings = [
      vec(0, 1, 0), // orthogonal
      vec(1, 0, 0), // identical
      vec(0, 0, 1), // orthogonal
    ];

    const results = searchEmbeddings(query, embeddings, 3);
    expect(results[0].index).toBe(1);
    expect(results[0].score).toBeCloseTo(1.0, 5);
  });

  it('returns at most topK results', () => {
    const query = vec(1, 0, 0);
    const embeddings = Array.from({ length: 10 }, () => randomUnitVector(3));

    const results = searchEmbeddings(query, embeddings, 3);
    expect(results).toHaveLength(3);
  });

  it('returns all embeddings if topK > count', () => {
    const query = vec(1, 0, 0);
    const embeddings = [vec(1, 0, 0), vec(0, 1, 0)];

    const results = searchEmbeddings(query, embeddings, 10);
    expect(results).toHaveLength(2);
  });

  it('results are sorted by score descending', () => {
    const query = vec(1, 0, 0);
    const embeddings = [
      vec(0, 1, 0),   // score ~ 0
      vec(-1, 0, 0),  // score ~ -1
      vec(1, 0.1, 0), // score ~ 0.995
      vec(0.5, 0.5, 0), // score ~ 0.707
    ];

    const results = searchEmbeddings(query, embeddings, 4);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('correctly identifies top-K from many embeddings', () => {
    const dim = 384;
    const query = randomUnitVector(dim);

    // Create 100 random embeddings
    const embeddings = Array.from({ length: 100 }, () => randomUnitVector(dim));

    // Set one to be identical to query
    embeddings[42] = new Float32Array(query);

    const results = searchEmbeddings(query, embeddings, 5);
    expect(results[0].index).toBe(42);
    expect(results[0].score).toBeCloseTo(1.0, 5);
    expect(results).toHaveLength(5);
  });

  it('handles single embedding', () => {
    const query = vec(1, 0, 0);
    const embeddings = [vec(0.5, 0.5, 0)];

    const results = searchEmbeddings(query, embeddings, 1);
    expect(results).toHaveLength(1);
    expect(results[0].index).toBe(0);
    expect(results[0].score).toBeGreaterThan(0);
  });
});
