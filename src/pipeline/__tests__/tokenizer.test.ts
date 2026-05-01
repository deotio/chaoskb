import { describe, expect, it } from 'vitest';
import { countTokens } from '../tokenizer.js';

describe('countTokens', () => {
  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countTokens('   \n\t  ')).toBe(0);
  });

  it('counts tokens for a simple sentence', () => {
    const count = countTokens('Hello world');
    expect(count).toBeGreaterThan(0);
    // "Hello" and "world" = 2 words, ~2.6 tokens, rounded up = 3
    expect(count).toBe(3);
  });

  it('counts tokens for a longer sentence', () => {
    const count = countTokens('The quick brown fox jumps over the lazy dog');
    // 9 words * 1.3 = 11.7, rounded up = 12
    expect(count).toBe(12);
  });

  it('handles punctuation as token boundaries', () => {
    const count = countTokens('Hello, world! How are you?');
    // Words: Hello, world, How, are, you = 5 words * 1.3 = 6.5, rounded up = 7
    expect(count).toBe(7);
  });

  it('handles text with mixed punctuation', () => {
    const count = countTokens('Dr. Smith (PhD) said: "Yes!"');
    // Words after splitting: Dr, Smith, PhD, said, Yes = 5 * 1.3 = 6.5 -> 7
    expect(count).toBe(7);
  });

  it('handles hyphenated words', () => {
    const count = countTokens('well-known state-of-the-art');
    // Splits on hyphens: well, known, state, of, the, art = 6 * 1.3 = 7.8 -> 8
    expect(count).toBe(8);
  });

  it('handles multiple spaces between words', () => {
    const count = countTokens('hello    world');
    // 2 words
    expect(count).toBe(3); // 2 * 1.3 = 2.6 -> 3
  });

  it('returns consistent results for same input', () => {
    const text = 'Quantum computing uses qubits for parallel computation.';
    const count1 = countTokens(text);
    const count2 = countTokens(text);
    expect(count1).toBe(count2);
  });

  it('scales approximately with text length', () => {
    const short = countTokens('Hello world');
    const long = countTokens('Hello world this is a much longer sentence with many more words');
    expect(long).toBeGreaterThan(short);
  });
});
