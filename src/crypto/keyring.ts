import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SecureBuffer } from './secure-buffer.js';
import type { IKeyringService, ISecureBuffer } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * OS keyring integration via shell commands.
 * Uses execFile (not exec) to prevent shell injection.
 *
 * macOS:  security add-generic-password / find-generic-password / delete-generic-password
 * Linux:  secret-tool store / lookup / clear
 * Windows: cmdkey /add: / /list: / /delete:
 */
export class KeyringService implements IKeyringService {
  private readonly platform: NodeJS.Platform;

  constructor(platform?: NodeJS.Platform) {
    this.platform = platform ?? process.platform;
  }

  /**
   * Store a secret in the OS keyring.
   */
  async store(service: string, account: string, secret: ISecureBuffer): Promise<void> {
    const secretHex = secret.buffer.toString('hex');

    try {
      switch (this.platform) {
        case 'darwin':
          await this.storeMacOS(service, account, secretHex);
          break;
        case 'linux':
          await this.storeLinux(service, account, secretHex);
          break;
        case 'win32':
          await this.storeWindows(service, account, secretHex);
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
    } finally {
      // We can't zero the hex string (JS strings are immutable),
      // but we at least don't hold onto it.
    }
  }

  /**
   * Retrieve a secret from the OS keyring.
   * Returns null if not found.
   */
  async retrieve(service: string, account: string): Promise<ISecureBuffer | null> {
    try {
      let secretHex: string;

      switch (this.platform) {
        case 'darwin':
          secretHex = await this.retrieveMacOS(service, account);
          break;
        case 'linux':
          secretHex = await this.retrieveLinux(service, account);
          break;
        case 'win32':
          secretHex = await this.retrieveWindows(service, account);
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }

      const bytes = Buffer.from(secretHex.trim(), 'hex');
      return SecureBuffer.from(bytes);
    } catch {
      return null;
    }
  }

  /**
   * Delete a secret from the OS keyring.
   * Returns true if deleted, false if not found.
   */
  async delete(service: string, account: string): Promise<boolean> {
    try {
      switch (this.platform) {
        case 'darwin':
          await this.deleteMacOS(service, account);
          break;
        case 'linux':
          await this.deleteLinux(service, account);
          break;
        case 'win32':
          await this.deleteWindows(service, account);
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  // --- macOS ---

  private async storeMacOS(service: string, account: string, secret: string): Promise<void> {
    // Delete existing entry first (update = delete + add)
    try {
      await execFileAsync('security', [
        'delete-generic-password',
        '-s', service,
        '-a', account,
      ]);
    } catch {
      // Ignore if not found
    }

    await execFileAsync('security', [
      'add-generic-password',
      '-s', service,
      '-a', account,
      '-w', secret,
      '-U', // update if exists
    ]);
  }

  private async retrieveMacOS(service: string, account: string): Promise<string> {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s', service,
      '-a', account,
      '-w', // output password only
    ]);
    return stdout.trim();
  }

  private async deleteMacOS(service: string, account: string): Promise<void> {
    await execFileAsync('security', [
      'delete-generic-password',
      '-s', service,
      '-a', account,
    ]);
  }

  // --- Linux ---

  private async storeLinux(service: string, account: string, secret: string): Promise<void> {
    // secret-tool reads from stdin
    const child = execFileAsync('secret-tool', [
      'store',
      '--label', `${service}/${account}`,
      'service', service,
      'account', account,
    ]);

    // Write secret to stdin
    if (child.child.stdin) {
      child.child.stdin.write(secret);
      child.child.stdin.end();
    }

    await child;
  }

  private async retrieveLinux(service: string, account: string): Promise<string> {
    const { stdout } = await execFileAsync('secret-tool', [
      'lookup',
      'service', service,
      'account', account,
    ]);
    return stdout;
  }

  private async deleteLinux(service: string, account: string): Promise<void> {
    await execFileAsync('secret-tool', [
      'clear',
      'service', service,
      'account', account,
    ]);
  }

  // --- Windows ---

  private async storeWindows(service: string, account: string, secret: string): Promise<void> {
    const target = `${service}/${account}`;
    await execFileAsync('cmdkey', [
      `/add:${target}`,
      `/user:${account}`,
      `/pass:${secret}`,
    ]);
  }

  private async retrieveWindows(service: string, account: string): Promise<string> {
    const target = `${service}/${account}`;
    const { stdout } = await execFileAsync('cmdkey', [
      `/list:${target}`,
    ]);

    // Parse cmdkey output to extract the password
    // Note: cmdkey /list doesn't actually output passwords; on Windows
    // we need to use the Windows Credential API via PowerShell
    // This is a fallback approach using PowerShell
    const { stdout: psOutput } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `[System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-StoredCredential -Target '${target}').Password))`,
    ]);

    if (!psOutput.trim()) {
      throw new Error(`Credential not found: ${target}`);
    }

    return psOutput.trim();
  }

  private async deleteWindows(service: string, account: string): Promise<void> {
    const target = `${service}/${account}`;
    await execFileAsync('cmdkey', [
      `/delete:${target}`,
    ]);
  }
}
