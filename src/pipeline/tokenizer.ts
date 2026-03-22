/**
 * Approximate token counting for snowflake-arctic-embed-s.
 *
 * This is a lightweight heuristic that splits on whitespace and punctuation
 * to approximate WordPiece tokenization. The ratio ~1.3 tokens per
 * whitespace-delimited word is applied to better match actual sub-word
 * tokenizer output.
 *
 * This module will be replaced with a real WordPiece tokenizer in a future
 * iteration once we bundle the model vocabulary.
 */

/** Punctuation characters that act as token boundaries. */
const PUNCTUATION_RE = /[\s.,;:!?()\[\]{}'"\-\u2014\u2013\u2026]+/;

/**
 * Approximate multiplier to account for sub-word splitting.
 * WordPiece / BPE tokenizers typically produce ~1.3x the number of
 * whitespace-delimited words.
 */
const SUBWORD_MULTIPLIER = 1.3;

/**
 * Count the approximate number of tokens in a text string.
 *
 * The count is an estimate suitable for chunking decisions. For actual
 * embedding input, the ONNX model's tokenizer handles precise tokenization.
 *
 * @param text - The input text to count tokens for.
 * @returns Approximate token count (always >= 0).
 */
export function countTokens(text: string): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  const words = text.split(PUNCTUATION_RE).filter((w) => w.length > 0);
  return Math.ceil(words.length * SUBWORD_MULTIPLIER);
}
