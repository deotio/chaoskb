/**
 * Re-export of `SecureBuffer` from `@de-otio/crypto-envelope`. Backed by
 * `sodium_malloc` / `sodium_memzero`; same behaviour as the previous
 * chaoskb-local implementation.
 */
export { SecureBuffer } from '@de-otio/crypto-envelope';
