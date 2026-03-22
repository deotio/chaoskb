import { randomBytes } from 'node:crypto';

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Encode a byte array as base62.
 * Uses repeated division for exact encoding.
 */
function base62Encode(bytes: Uint8Array): string {
  // Convert bytes to a BigInt
  let num = BigInt(0);
  for (const byte of bytes) {
    num = (num << 8n) | BigInt(byte);
  }

  if (num === 0n) {
    return BASE62_ALPHABET[0];
  }

  const chars: string[] = [];
  const base = BigInt(BASE62_ALPHABET.length);
  while (num > 0n) {
    const remainder = Number(num % base);
    chars.unshift(BASE62_ALPHABET[remainder]);
    num = num / base;
  }

  return chars.join('');
}

/**
 * Generate a CSPRNG blob ID.
 * Format: b_ + base62-encoded 16 random bytes.
 */
export function generateBlobId(): string {
  const bytes = randomBytes(16);
  return 'b_' + base62Encode(bytes);
}
