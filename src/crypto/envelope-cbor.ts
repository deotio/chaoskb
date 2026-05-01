/**
 * chaoskb's CBOR envelope helpers, aliased to the `@de-otio/crypto-envelope`
 * implementations. Preserves the historical chaoskb names
 * (`serializeEnvelopeCBOR`, `deserializeEnvelope`).
 */
export {
  serializeV2 as serializeEnvelopeCBOR,
  deserialize as deserializeEnvelope,
  upgradeToV2,
  downgradeToV1,
} from '@de-otio/crypto-envelope';
