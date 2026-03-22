import { canonicalJson } from './canonical-json.js';
import type { Algorithm, KeyId } from './types.js';

/**
 * Construct AAD (Associated Authenticated Data) for AEAD encryption.
 * Per the envelope spec: AAD = UTF-8 bytes of canonicalJson({alg, id, kid, v})
 * Keys are sorted alphabetically by RFC 8785.
 */
export function constructAAD(alg: Algorithm, id: string, kid: KeyId, v: number): Uint8Array {
  const json = canonicalJson({ alg, id, kid, v });
  return new TextEncoder().encode(json);
}
