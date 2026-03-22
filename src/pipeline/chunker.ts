/**
 * Text chunking for the content pipeline.
 *
 * Splits extracted text into overlapping chunks of approximately
 * `maxTokens` tokens, breaking on sentence boundaries where possible.
 */

import { countTokens } from './tokenizer.js';
import type { Chunk } from './types.js';

/** Configuration for the chunker. */
export interface ChunkConfig {
  /** Maximum tokens per chunk (default: 500). */
  maxTokens: number;
  /** Token overlap between consecutive chunks (default: 50). */
  overlapTokens: number;
}

const DEFAULT_CONFIG: ChunkConfig = {
  maxTokens: 500,
  overlapTokens: 50,
};

/**
 * Sentence-boundary regex. Matches `.`, `!`, or `?` followed by
 * whitespace or end of string. Keeps the punctuation with the sentence.
 */
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+/;

/**
 * Split text into overlapping chunks of approximately `maxTokens` tokens.
 *
 * Splitting is performed on sentence boundaries where possible. If a
 * single sentence exceeds `maxTokens`, it is included as-is in its own
 * chunk (no mid-sentence splitting).
 *
 * @param text - The text to split into chunks.
 * @param config - Optional chunking configuration.
 * @returns Array of chunks with content, index, token count, and byte offset.
 */
export function chunkText(text: string, config?: Partial<ChunkConfig>): Chunk[] {
  const maxTokens = config?.maxTokens ?? DEFAULT_CONFIG.maxTokens;
  const overlapTokens = config?.overlapTokens ?? DEFAULT_CONFIG.overlapTokens;

  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split into sentences
  const sentences = text.split(SENTENCE_BOUNDARY_RE).filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return [];
  }

  // Pre-compute token counts for each sentence
  const sentenceTokens = sentences.map((s) => countTokens(s));

  const chunks: Chunk[] = [];
  let sentenceIdx = 0;

  while (sentenceIdx < sentences.length) {
    // Build a chunk by accumulating sentences up to maxTokens
    const chunkSentences: string[] = [];
    let chunkTokenCount = 0;
    const startSentenceIdx = sentenceIdx;

    while (sentenceIdx < sentences.length) {
      const stc = sentenceTokens[sentenceIdx];

      // If adding this sentence would exceed max and we already have content,
      // stop (unless the chunk is empty — always include at least one sentence).
      if (chunkTokenCount + stc > maxTokens && chunkSentences.length > 0) {
        break;
      }

      chunkSentences.push(sentences[sentenceIdx]);
      chunkTokenCount += stc;
      sentenceIdx++;
    }

    const content = chunkSentences.join(' ');

    // Compute byte offset: sum of byte lengths of all sentences before startSentenceIdx
    // plus the separator spaces between them
    const byteOffset = computeByteOffset(sentences, startSentenceIdx);

    chunks.push({
      content,
      index: chunks.length,
      tokenCount: countTokens(content),
      byteOffset,
    });

    // Apply overlap: back up by enough sentences to cover overlapTokens
    if (sentenceIdx < sentences.length) {
      let overlapCount = 0;
      let backtrack = sentenceIdx - 1;
      while (backtrack > startSentenceIdx && overlapCount < overlapTokens) {
        overlapCount += sentenceTokens[backtrack];
        backtrack--;
      }
      // sentenceIdx should start from backtrack + 1 (the first overlap sentence)
      sentenceIdx = backtrack + 1;
    }
  }

  return chunks;
}

/**
 * Compute the byte offset of the sentence at the given index
 * within the original text (assuming sentences are joined by single spaces).
 */
function computeByteOffset(sentences: string[], targetIdx: number): number {
  let offset = 0;
  for (let i = 0; i < targetIdx; i++) {
    offset += Buffer.byteLength(sentences[i], 'utf-8');
    // Account for the whitespace separator between sentences
    offset += 1; // The space that was split on
  }
  return offset;
}
