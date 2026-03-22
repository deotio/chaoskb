import { createHash, sign as cryptoSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Signs HTTP requests with an SSH private key for ChaosKB-SSH authentication.
 *
 * Uses Ed25519 keys. Reads the private key from disk (ssh-agent fallback
 * is not implemented in this version — the key file is read directly).
 */
export class SSHSigner {
  private readonly keyPath: string;

  constructor(sshKeyPath?: string) {
    this.keyPath = sshKeyPath ?? join(homedir(), '.ssh', 'id_ed25519');
  }

  /**
   * Sign an HTTP request, returning the Authorization header value and timestamp.
   */
  async signRequest(
    method: string,
    path: string,
    body?: Uint8Array,
  ): Promise<{ authorization: string; timestamp: string }> {
    const timestamp = new Date().toISOString();
    const bodyHash = this.computeBodyHash(body);
    const canonical = this.buildCanonical(method, path, timestamp, bodyHash);

    const publicKeyRaw = await this.readPublicKey();
    const signature = await this.signCanonical(canonical);

    const base64PubKey = Buffer.from(publicKeyRaw).toString('base64');
    const base64Sig = signature.toString('base64');

    const authorization = `ChaosKB-SSH pubkey=${base64PubKey}, ts=${timestamp}, sig=${base64Sig}`;
    return { authorization, timestamp };
  }

  /**
   * Compute SHA-256 hex digest of body bytes. Empty string if no body.
   */
  computeBodyHash(body?: Uint8Array): string {
    if (!body || body.length === 0) {
      return '';
    }
    return createHash('sha256').update(body).digest('hex');
  }

  /**
   * Build the canonical string to be signed.
   */
  buildCanonical(method: string, path: string, timestamp: string, bodyHash: string): string {
    return `chaoskb-auth\n${method} ${path}\n${timestamp}\n${bodyHash}`;
  }

  /**
   * Read the SSH public key from the .pub file alongside the private key.
   * Returns the raw public key content as a UTF-8 string.
   */
  private async readPublicKey(): Promise<string> {
    const pubKeyPath = this.keyPath + '.pub';
    const content = await readFile(pubKeyPath, 'utf-8');
    return content.trim();
  }

  /**
   * Sign canonical data using the Ed25519 private key.
   *
   * Falls back to reading the private key file directly if SSH_AUTH_SOCK
   * is not available.
   */
  private async signCanonical(canonical: string): Promise<Buffer> {
    // Attempt ssh-agent if SSH_AUTH_SOCK is set
    if (process.env.SSH_AUTH_SOCK) {
      try {
        return await this.signWithAgent(canonical);
      } catch {
        // Fall through to file-based signing
      }
    }

    return this.signWithKeyFile(canonical);
  }

  /**
   * Sign using the SSH private key file on disk with Ed25519.
   */
  private async signWithKeyFile(canonical: string): Promise<Buffer> {
    const keyData = await readFile(this.keyPath, 'utf-8');
    const data = Buffer.from(canonical, 'utf-8');
    return cryptoSign(undefined, data, {
      key: keyData,
      format: 'pem',
    });
  }

  /**
   * Sign using ssh-agent via SSH_AUTH_SOCK.
   * This is a placeholder — full ssh-agent protocol implementation
   * would require a Unix socket client. For now we throw so the
   * caller falls back to file-based signing.
   */
  private async signWithAgent(_canonical: string): Promise<Buffer> {
    // ssh-agent signing requires implementing the SSH agent protocol
    // over a Unix domain socket. For Phase 1 we fall back to key file.
    throw new Error('ssh-agent signing not yet implemented');
  }
}
