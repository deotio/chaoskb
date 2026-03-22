import sodium from 'sodium-native';

import type { ISecureBuffer } from './types.js';

/**
 * Memory-locked buffer for sensitive key material.
 * Uses sodium_malloc (mlock'd pages) and sodium_memzero on dispose.
 */
export class SecureBuffer implements ISecureBuffer {
  private _buffer: Buffer;
  private _disposed = false;

  private constructor(length: number) {
    this._buffer = sodium.sodium_malloc(length);
  }

  /** Read the buffer contents. Throws if disposed. */
  get buffer(): Buffer {
    if (this._disposed) {
      throw new Error('SecureBuffer has been disposed');
    }
    return this._buffer;
  }

  /** Byte length of the buffer. */
  get length(): number {
    return this._buffer.byteLength;
  }

  /** Whether the buffer has been zeroed and disposed. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Zero the buffer contents and mark as disposed.
   * Safe to call multiple times (idempotent).
   */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    sodium.sodium_memzero(this._buffer);
    this._disposed = true;
  }

  /** Support `using` keyword (TC39 Explicit Resource Management). */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Copy data into a new SecureBuffer and zero the source.
   * The source buffer is zeroed after copying regardless of type.
   */
  static from(data: Buffer | Uint8Array): SecureBuffer {
    const sb = new SecureBuffer(data.byteLength);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    buf.copy(sb._buffer);
    // Zero the source
    sodium.sodium_memzero(buf);
    return sb;
  }

  /** Allocate a new zeroed SecureBuffer of the given length. */
  static alloc(length: number): SecureBuffer {
    const sb = new SecureBuffer(length);
    sodium.sodium_memzero(sb._buffer);
    return sb;
  }
}
