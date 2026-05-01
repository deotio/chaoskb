/**
 * Re-export of RFC 8785 canonical JSON from `@de-otio/crypto-envelope`.
 * The implementation moved out of chaoskb when the crypto primitives were
 * extracted into a standalone package; this file keeps chaoskb's internal
 * imports stable.
 */
export { canonicalJson } from '@de-otio/crypto-envelope';
