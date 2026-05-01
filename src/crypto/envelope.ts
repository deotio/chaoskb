import { decryptV1, encryptV1 } from '@de-otio/crypto-envelope';
import type {
  DecryptResult,
  DerivedKeySet,
  EncryptResult,
  Envelope,
  KeyId,
  Payload,
} from './types.js';

/**
 * chaoskb's envelope API, adapted to delegate to `@de-otio/crypto-envelope`.
 *
 * The package takes explicit `cek` and `commitKey` bytes; chaoskb's callers
 * still pass a `DerivedKeySet` and a `KeyId`, so this adapter unpacks the
 * right key by `kid` and validates the chaoskb-specific payload type on
 * decrypt.
 */

function getKey(keys: DerivedKeySet, kid: KeyId): Uint8Array {
  switch (kid) {
    case 'CEK':
      return new Uint8Array(keys.contentKey.buffer);
    case 'MEK':
      return new Uint8Array(keys.metadataKey.buffer);
    case 'EEK':
      return new Uint8Array(keys.embeddingKey.buffer);
    default: {
      const _exhaustive: never = kid;
      throw new Error(`Unknown key identifier: ${_exhaustive}`);
    }
  }
}

export function encryptPayload(
  payload: Payload,
  keys: DerivedKeySet,
  kid: KeyId = 'CEK',
): EncryptResult {
  const envelope = encryptV1({
    payload: payload as unknown as Record<string, unknown>,
    cek: getKey(keys, kid),
    commitKey: new Uint8Array(keys.commitKey.buffer),
    kid,
  }) as Envelope;

  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  return { envelope, bytes };
}

function toKeyId(kid: string): KeyId {
  if (kid === 'CEK' || kid === 'MEK' || kid === 'EEK') {
    return kid;
  }
  throw new Error(`Unknown key identifier: ${kid}`);
}

export function decryptEnvelope(envelope: Envelope, keys: DerivedKeySet): DecryptResult {
  const plaintext = decryptV1(
    envelope,
    getKey(keys, toKeyId(envelope.enc.kid)),
    new Uint8Array(keys.commitKey.buffer),
  ) as unknown as Payload;

  // chaoskb-specific payload-type validation — the generic envelope
  // package doesn't know which payload shapes chaoskb considers valid.
  if (
    !plaintext.type ||
    !['source', 'chunk', 'canary'].includes(plaintext.type)
  ) {
    throw new Error(
      `Invalid payload type: ${(plaintext as unknown as Record<string, unknown>).type}`,
    );
  }

  return { payload: plaintext, envelope };
}
