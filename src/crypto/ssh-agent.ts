import * as net from 'node:net';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

import type { SSHKeyInfo, SSHKeyType } from './types.js';

// SSH agent protocol constants
const SSH2_AGENTC_REQUEST_IDENTITIES = 11;
const SSH2_AGENT_IDENTITIES_ANSWER = 12;
const SSH_AGENTC_SIGN_REQUEST = 13;
const SSH_AGENT_SIGN_RESPONSE = 14;
const SSH_AGENT_FAILURE = 5;

// Signature flags
const SSH_AGENT_FLAG_ED25519 = 0; // no special flags for ed25519

/**
 * Connect to the SSH agent and send a message, returning the response.
 */
function agentRequest(message: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env['SSH_AUTH_SOCK'];
    if (!socketPath) {
      reject(new Error('SSH_AUTH_SOCK environment variable is not set'));
      return;
    }

    const client = net.createConnection(socketPath);
    const chunks: Buffer[] = [];
    let expectedLength = -1;

    client.on('connect', () => {
      // Send message with 4-byte length prefix
      const lengthPrefix = Buffer.alloc(4);
      lengthPrefix.writeUInt32BE(message.length, 0);
      client.write(Buffer.concat([lengthPrefix, message]));
    });

    client.on('data', (data: Buffer) => {
      chunks.push(data);
      const combined = Buffer.concat(chunks);

      // Read the response length from the first 4 bytes
      if (expectedLength === -1 && combined.length >= 4) {
        expectedLength = combined.readUInt32BE(0);
      }

      // Check if we have the full response
      if (expectedLength !== -1 && combined.length >= expectedLength + 4) {
        client.end();
        resolve(combined.subarray(4, 4 + expectedLength));
      }
    });

    client.on('error', (err: Error) => {
      reject(new Error(`SSH agent connection error: ${err.message}`));
    });

    client.on('end', () => {
      const combined = Buffer.concat(chunks);
      if (combined.length >= 4) {
        const len = combined.readUInt32BE(0);
        resolve(combined.subarray(4, 4 + len));
      } else {
        reject(new Error('SSH agent returned empty response'));
      }
    });

    // Timeout after 10 seconds
    client.setTimeout(10_000, () => {
      client.destroy();
      reject(new Error('SSH agent connection timed out'));
    });
  });
}

/**
 * Write a string (length-prefixed bytes) into a buffer at an offset.
 * Returns new offset.
 */
function writeString(buf: Buffer, data: Buffer | Uint8Array, offset: number): number {
  buf.writeUInt32BE(data.length, offset);
  offset += 4;
  Buffer.from(data).copy(buf, offset);
  return offset + data.length;
}

/**
 * Read a length-prefixed string from a buffer at offset.
 * Returns [data, newOffset].
 */
function readString(buf: Buffer, offset: number): [Buffer, number] {
  if (offset + 4 > buf.length) {
    throw new Error('Unexpected end of SSH agent response reading string length');
  }
  const len = buf.readUInt32BE(offset);
  offset += 4;
  if (offset + len > buf.length) {
    throw new Error('Unexpected end of SSH agent response reading string data');
  }
  return [buf.subarray(offset, offset + len), offset + len];
}

/**
 * Determine SSH key type from a type string.
 */
function parseKeyType(typeStr: string): SSHKeyType | null {
  if (typeStr === 'ssh-ed25519') return 'ed25519';
  if (typeStr === 'ssh-rsa') return 'rsa';
  return null;
}

/**
 * List all keys available in the SSH agent.
 */
export async function listSSHAgentKeys(): Promise<SSHKeyInfo[]> {
  const request = Buffer.alloc(1);
  request[0] = SSH2_AGENTC_REQUEST_IDENTITIES;

  const response = await agentRequest(request);

  if (response[0] === SSH_AGENT_FAILURE) {
    throw new Error('SSH agent returned failure');
  }

  if (response[0] !== SSH2_AGENT_IDENTITIES_ANSWER) {
    throw new Error(`Unexpected SSH agent response type: ${response[0]}`);
  }

  let offset = 1;
  if (offset + 4 > response.length) {
    throw new Error('Truncated identities response');
  }
  const numKeys = response.readUInt32BE(offset);
  offset += 4;

  const keys: SSHKeyInfo[] = [];

  for (let i = 0; i < numKeys; i++) {
    // Read key blob
    const [keyBlob, afterBlob] = readString(response, offset);
    offset = afterBlob;

    // Read comment
    const [commentBuf, afterComment] = readString(response, offset);
    offset = afterComment;

    const comment = commentBuf.toString('utf-8');

    // Parse key blob to get type and public key
    let blobOffset = 0;
    const [typeField, afterType] = readString(keyBlob, blobOffset);
    blobOffset = afterType;
    const typeStr = typeField.toString('ascii');
    const keyType = parseKeyType(typeStr);

    if (!keyType) {
      continue; // skip unsupported key types
    }

    let publicKeyBytes: Uint8Array;
    if (keyType === 'ed25519') {
      const [pubkey] = readString(keyBlob, blobOffset);
      publicKeyBytes = new Uint8Array(pubkey);
    } else {
      // RSA: exponent + modulus
      const [exponent, afterExp] = readString(keyBlob, blobOffset);
      const [modulus] = readString(keyBlob, afterExp);
      const result = Buffer.alloc(4 + exponent.length + 4 + modulus.length);
      let pos = 0;
      result.writeUInt32BE(exponent.length, pos);
      pos += 4;
      exponent.copy(result, pos);
      pos += exponent.length;
      result.writeUInt32BE(modulus.length, pos);
      pos += 4;
      modulus.copy(result, pos);
      publicKeyBytes = new Uint8Array(result);
    }

    // Compute fingerprint
    const hash = crypto.createHash('sha256').update(keyBlob).digest();
    const fingerprint = 'SHA256:' + hash.toString('base64').replace(/=+$/, '');

    keys.push({
      type: keyType,
      publicKeyBytes,
      fingerprint,
      ...(comment ? { comment } : {}),
    });
  }

  return keys;
}

/**
 * Sign data using a key available in the SSH agent.
 * Returns the raw signature bytes (Ed25519: 64 bytes, RSA: variable).
 */
export async function signWithSSHAgent(
  data: Uint8Array,
  publicKeyBlob: Uint8Array,
): Promise<Uint8Array> {
  // Build the sign request
  // Format: byte SSH_AGENTC_SIGN_REQUEST, string key_blob, string data, uint32 flags
  const totalLen = 1 + 4 + publicKeyBlob.length + 4 + data.length + 4;
  const request = Buffer.alloc(totalLen);
  let offset = 0;

  request[offset] = SSH_AGENTC_SIGN_REQUEST;
  offset += 1;

  offset = writeString(request, publicKeyBlob, offset);
  offset = writeString(request, data, offset);

  // Flags (0 for default)
  request.writeUInt32BE(SSH_AGENT_FLAG_ED25519, offset);

  const response = await agentRequest(request);

  if (response[0] === SSH_AGENT_FAILURE) {
    throw new Error('SSH agent refused to sign (key not found or agent denied request)');
  }

  if (response[0] !== SSH_AGENT_SIGN_RESPONSE) {
    throw new Error(`Unexpected SSH agent response type: ${response[0]}`);
  }

  // Parse signature: string signature_blob
  const [sigBlob] = readString(response, 1);

  // Signature blob format: string sig_type, string sig_data
  let sigOffset = 0;
  const [, afterSigType] = readString(sigBlob, sigOffset);
  sigOffset = afterSigType;
  const [sigData] = readString(sigBlob, sigOffset);

  return new Uint8Array(sigData);
}

/**
 * Sign data using a private key file directly.
 * Supports OpenSSH private key format.
 */
export async function signWithKeyFile(
  data: Uint8Array,
  keyPath: string,
  passphrase?: string,
): Promise<Uint8Array> {
  const keyContent = fs.readFileSync(keyPath, 'utf-8');

  const privateKey = crypto.createPrivateKey({
    key: keyContent,
    format: 'pem',
    ...(passphrase ? { passphrase } : {}),
  });

  const keyType = privateKey.asymmetricKeyType;

  if (keyType === 'ed25519') {
    const sign = crypto.sign(null, Buffer.from(data), privateKey);
    return new Uint8Array(sign);
  } else if (keyType === 'rsa') {
    const sign = crypto.sign('sha256', Buffer.from(data), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    });
    return new Uint8Array(sign);
  }

  throw new Error(`Unsupported key type: ${keyType}`);
}
