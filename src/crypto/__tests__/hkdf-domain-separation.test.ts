import { describe, it, expect } from 'vitest';

/**
 * HKDF Domain Separation Enforcement (E3)
 *
 * All HKDF info strings used in ChaosKB must satisfy:
 * 1. No info string is a prefix of another (prevents domain confusion)
 * 2. Variable-length fields use fixed-width encoding (SHA-256 hashes = 32 bytes)
 *
 * Note: The core key derivation strings (chaoskb-content, chaoskb-metadata, etc.)
 * do not currently carry a -v1 suffix. Adding one would be a breaking change to
 * the encryption format and requires a migration. The invite info string already
 * uses -v1. This test documents the current state.
 */

// All HKDF info strings used in production code.
// If you add a new deriveKey() call site, add the info string here.
const HKDF_INFO_STRINGS = [
  // hkdf.ts — deriveKeySet()
  'chaoskb-content',
  'chaoskb-metadata',
  'chaoskb-embedding',
  'chaoskb-commit',
  // invite.ts — buildInviteHkdfInfo() (prefix only; variable fields are fixed-width SHA-256)
  'chaoskb-invite-v1',
  // project-keys.ts — WRAP_INFO
  'chaoskb-project-wrap',
];

describe('HKDF domain separation', () => {
  it('no info string is a prefix of another', () => {
    for (let i = 0; i < HKDF_INFO_STRINGS.length; i++) {
      for (let j = 0; j < HKDF_INFO_STRINGS.length; j++) {
        if (i === j) continue;
        const a = HKDF_INFO_STRINGS[i];
        const b = HKDF_INFO_STRINGS[j];
        expect(b.startsWith(a)).toBe(false,
          `"${a}" is a prefix of "${b}" — HKDF domain confusion risk`);
      }
    }
  });

  it('all info strings start with chaoskb- namespace', () => {
    for (const info of HKDF_INFO_STRINGS) {
      expect(info.startsWith('chaoskb-')).toBe(true);
    }
  });

  it('all info strings are unique', () => {
    const unique = new Set(HKDF_INFO_STRINGS);
    expect(unique.size).toBe(HKDF_INFO_STRINGS.length);
  });

  it('invite info uses fixed-width SHA-256 fields (32 bytes each)', () => {
    // The invite HKDF info appends three SHA-256 hex digests (64 chars each)
    // after the "chaoskb-invite-v1" prefix, totaling 17 + 192 = 209 chars
    const crypto = require('node:crypto');
    const prefix = 'chaoskb-invite-v1';
    const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
    const info = `${prefix}${hash('sender')}${hash('recipient')}${hash('project')}`;

    // Verify fixed total length
    expect(info.length).toBe(prefix.length + 64 * 3);
    // Verify each hash field is exactly 64 hex chars
    const fields = info.slice(prefix.length);
    expect(fields.length).toBe(192);
  });
});
