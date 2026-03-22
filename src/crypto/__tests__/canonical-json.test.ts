import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../canonical-json.js';

describe('canonicalJson', () => {
  describe('key sorting', () => {
    it('should sort keys alphabetically', () => {
      const result = canonicalJson({ z: 1, a: 2, m: 3 });
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should sort keys recursively in nested objects', () => {
      const result = canonicalJson({ b: { z: 1, a: 2 }, a: 1 });
      expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
    });

    it('should sort keys in objects within arrays', () => {
      const result = canonicalJson({ arr: [{ z: 1, a: 2 }] } as any);
      expect(result).toBe('{"arr":[{"a":2,"z":1}]}');
    });
  });

  describe('no whitespace', () => {
    it('should produce compact output with no whitespace', () => {
      const result = canonicalJson({ key: 'value', num: 42 });
      expect(result).not.toContain(' ');
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\t');
    });
  });

  describe('string escaping', () => {
    it('should escape control characters', () => {
      const result = canonicalJson({ s: '\x00\x01\x1f' });
      expect(result).toBe('{"s":"\\u0000\\u0001\\u001f"}');
    });

    it('should escape backslash', () => {
      const result = canonicalJson({ s: 'a\\b' });
      expect(result).toBe('{"s":"a\\\\b"}');
    });

    it('should escape double quotes', () => {
      const result = canonicalJson({ s: 'a"b' });
      expect(result).toBe('{"s":"a\\"b"}');
    });

    it('should use short escapes for special characters', () => {
      const result = canonicalJson({ s: '\b\t\n\f\r' });
      expect(result).toBe('{"s":"\\b\\t\\n\\f\\r"}');
    });

    it('should pass through non-BMP characters (emoji) literally', () => {
      const result = canonicalJson({ s: 'hello \u{1F600}' });
      // Emoji should be passed through as-is (surrogate pairs)
      expect(result).toContain('\u{1F600}');
    });
  });

  describe('number serialization', () => {
    it('should serialize integers without decimal point', () => {
      expect(canonicalJson({ n: 42 })).toBe('{"n":42}');
    });

    it('should serialize negative zero as 0', () => {
      expect(canonicalJson({ n: -0 })).toBe('{"n":0}');
    });

    it('should serialize floats', () => {
      expect(canonicalJson({ n: 3.14 })).toBe('{"n":3.14}');
    });

    it('should reject NaN', () => {
      expect(() => canonicalJson({ n: NaN })).toThrow('Non-finite');
    });

    it('should reject Infinity', () => {
      expect(() => canonicalJson({ n: Infinity })).toThrow('Non-finite');
    });
  });

  describe('null and boolean', () => {
    it('should serialize null', () => {
      expect(canonicalJson({ v: null })).toBe('{"v":null}');
    });

    it('should serialize booleans', () => {
      expect(canonicalJson({ t: true, f: false })).toBe('{"f":false,"t":true}');
    });
  });

  describe('arrays', () => {
    it('should serialize arrays', () => {
      expect(canonicalJson({ a: [1, 2, 3] })).toBe('{"a":[1,2,3]}');
    });

    it('should serialize empty arrays', () => {
      expect(canonicalJson({ a: [] })).toBe('{"a":[]}');
    });
  });

  describe('undefined values', () => {
    it('should omit undefined values', () => {
      expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
    });
  });

  describe('RFC 8785 compliance', () => {
    it('should match the envelope spec AAD example', () => {
      const result = canonicalJson({
        alg: 'XChaCha20-Poly1305',
        id: 'b_test000000000000',
        kid: 'CEK',
        v: 1,
      });
      expect(result).toBe(
        '{"alg":"XChaCha20-Poly1305","id":"b_test000000000000","kid":"CEK","v":1}',
      );
    });

    it('should match the canary payload example', () => {
      const result = canonicalJson({
        type: 'canary',
        value: 'chaoskb-canary-v1',
      });
      expect(result).toBe('{"type":"canary","value":"chaoskb-canary-v1"}');
    });
  });
});
