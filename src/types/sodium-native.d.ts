declare module 'sodium-native' {
  export function crypto_aead_xchacha20poly1305_ietf_encrypt(
    ciphertext: Buffer,
    message: Buffer,
    ad: Buffer | null,
    nsec: null,
    nonce: Buffer,
    key: Buffer
  ): void;

  export function crypto_aead_xchacha20poly1305_ietf_decrypt(
    message: Buffer,
    nsec: null,
    ciphertext: Buffer,
    ad: Buffer | null,
    nonce: Buffer,
    key: Buffer
  ): void;

  export function crypto_pwhash(
    output: Buffer,
    password: Buffer,
    salt: Buffer,
    opslimit: number,
    memlimit: number,
    algorithm: number
  ): void;

  export function randombytes_buf(buf: Buffer): void;
  export function sodium_memzero(buf: Buffer): void;
  export function sodium_malloc(size: number): Buffer;

  export function crypto_box_seal(ciphertext: Buffer, message: Buffer, publicKey: Buffer): void;
  export function crypto_box_seal_open(message: Buffer, ciphertext: Buffer, publicKey: Buffer, secretKey: Buffer): boolean;
  export function crypto_sign_ed25519_pk_to_curve25519(curve25519Pk: Buffer, ed25519Pk: Buffer): void;
  export function crypto_sign_ed25519_sk_to_curve25519(curve25519Sk: Buffer, ed25519Sk: Buffer): void;

  export const crypto_box_PUBLICKEYBYTES: number;
  export const crypto_box_SECRETKEYBYTES: number;
  export const crypto_box_SEALBYTES: number;

  export const crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  export const crypto_aead_xchacha20poly1305_ietf_ABYTES: number;
  export const crypto_pwhash_ALG_ARGON2ID13: number;
  export const crypto_pwhash_SALTBYTES: number;
  export const crypto_pwhash_OPSLIMIT_MODERATE: number;
  export const crypto_pwhash_MEMLIMIT_MODERATE: number;
  export const crypto_pwhash_OPSLIMIT_SENSITIVE: number;
  export const crypto_pwhash_MEMLIMIT_SENSITIVE: number;
}
