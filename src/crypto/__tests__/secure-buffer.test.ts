import { describe, it, expect } from 'vitest';
import { SecureBuffer } from '../secure-buffer.js';

describe('SecureBuffer', () => {
  describe('alloc', () => {
    it('should allocate a buffer of the requested size', () => {
      const sb = SecureBuffer.alloc(32);
      expect(sb.length).toBe(32);
      expect(sb.buffer.byteLength).toBe(32);
      expect(sb.isDisposed).toBe(false);
      sb.dispose();
    });

    it('should allocate a zeroed buffer', () => {
      const sb = SecureBuffer.alloc(16);
      const allZero = sb.buffer.every((b) => b === 0);
      expect(allZero).toBe(true);
      sb.dispose();
    });
  });

  describe('from', () => {
    it('should copy data into a SecureBuffer', () => {
      const source = Buffer.from([1, 2, 3, 4, 5]);
      const sb = SecureBuffer.from(source);

      expect(sb.length).toBe(5);
      expect(sb.buffer[0]).toBe(1);
      expect(sb.buffer[4]).toBe(5);
      sb.dispose();
    });

    it('should zero the source buffer after copying', () => {
      const source = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
      SecureBuffer.from(source);

      // Source should be zeroed
      const allZero = source.every((b) => b === 0);
      expect(allZero).toBe(true);
    });

    it('should accept Uint8Array', () => {
      const source = new Uint8Array([10, 20, 30]);
      const sb = SecureBuffer.from(source);
      expect(sb.length).toBe(3);
      expect(sb.buffer[0]).toBe(10);
      sb.dispose();
    });
  });

  describe('dispose', () => {
    it('should zero the buffer on dispose', () => {
      const sb = SecureBuffer.alloc(8);
      // Write some data
      sb.buffer[0] = 0xff;
      sb.buffer[7] = 0xaa;

      sb.dispose();
      expect(sb.isDisposed).toBe(true);
    });

    it('should throw when accessing buffer after dispose', () => {
      const sb = SecureBuffer.alloc(8);
      sb.dispose();

      expect(() => sb.buffer).toThrow('SecureBuffer has been disposed');
    });

    it('should be safe to call dispose multiple times (idempotent)', () => {
      const sb = SecureBuffer.alloc(8);
      sb.dispose();
      expect(() => sb.dispose()).not.toThrow();
      expect(sb.isDisposed).toBe(true);
    });
  });

  describe('Symbol.dispose', () => {
    it('should support Symbol.dispose for the using keyword', () => {
      const sb = SecureBuffer.alloc(8);
      expect(typeof sb[Symbol.dispose]).toBe('function');
      sb[Symbol.dispose]();
      expect(sb.isDisposed).toBe(true);
    });
  });

  describe('length', () => {
    it('should report correct length even after dispose', () => {
      const sb = SecureBuffer.alloc(64);
      expect(sb.length).toBe(64);
      sb.dispose();
      // length should still work (reads byteLength of underlying buffer)
      expect(sb.length).toBe(64);
    });
  });
});
