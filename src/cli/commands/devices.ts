import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from './setup.js';
import { createSyncClient } from '../tools/sync-client.js';

const CHAOSKB_DIR = path.join(os.homedir(), '.chaoskb');

/** Base62 alphabet for human-friendly codes. */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Generate a random base62 string of the given length. */
function generateLinkCode(length: number): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62[bytes[i] % 62];
  }
  return code;
}

/** SHA-256 hex digest of a string. */
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `chaoskb-mcp devices add`
 *
 * On an existing device: generates a link code, sends its hash to the server,
 * displays the code, then polls until the new device's public key arrives.
 * When it does, wraps the master key with that key and uploads it.
 */
export async function devicesAddCommand(): Promise<void> {
  // 1. Generate link code
  const linkCode = generateLinkCode(10);
  const codeHash = hashCode(linkCode);

  // 2. Send hash to server
  const body = JSON.stringify({ codeHash });
  const bodyBytes = new TextEncoder().encode(body);

  const { signedFetch } = await createSyncClient();

  const createResp = await signedFetch('POST', '/v1/link-code', bodyBytes);
  if (!createResp.ok) {
    const err = await createResp.text();
    console.error(`Failed to create link code: ${createResp.status} ${err}`);
    process.exit(1);
  }

  console.log('');
  console.log(`  Link code: ${linkCode}  (expires in 5 minutes)`);
  console.log('');
  console.log('  On the new device, run:');
  console.log(`    chaoskb-mcp devices confirm ${linkCode}`);
  console.log('');
  console.log('  Waiting for new device...');

  // 3. Poll for new device's public key
  const pollPath = `/v1/link-code/${encodeURIComponent(codeHash)}/status`;
  const deadline = Date.now() + 5 * 60 * 1000;
  let newPublicKey: string | null = null;

  while (Date.now() < deadline) {
    await sleep(5000);

    const statusResp = await signedFetch('GET', pollPath);
    if (!statusResp.ok) {
      console.error(`  Poll failed: ${statusResp.status}`);
      continue;
    }

    const statusBody = await statusResp.json() as { status: string; newPublicKey?: string };
    if (statusBody.status === 'ready' && statusBody.newPublicKey) {
      newPublicKey = statusBody.newPublicKey;
      break;
    }

    process.stderr.write('.');
  }

  if (!newPublicKey) {
    console.error('\n  Timed out waiting for new device. Run the command again to generate a new code.');
    process.exit(1);
  }

  console.log('\n  New device connected. Wrapping master key...');

  // 4. Wrap master key with new device's public key and upload
  const { parseSSHPublicKey } = await import('../../crypto/ssh-keys.js');
  const { wrapMasterKey } = await import('../../crypto/tiers/standard.js');
  const { KeyringService } = await import('../../crypto/keyring.js');

  const config = await loadConfig();
  const keyring = new KeyringService();
  const masterKey = await keyring.retrieve('chaoskb', 'master-key');
  if (!masterKey) {
    // Try file-based fallback
    const fileKeyPath = path.join(CHAOSKB_DIR, 'master.key');
    if (fs.existsSync(fileKeyPath)) {
      const { SecureBuffer } = await import('../../crypto/secure-buffer.js');
      const hex = fs.readFileSync(fileKeyPath, 'utf-8').trim();
      const keyBuf = SecureBuffer.from(Buffer.from(hex, 'hex'));
      const keyInfo = parseSSHPublicKey(newPublicKey);
      const wrappedBlob = wrapMasterKey(keyBuf, keyInfo);
      keyBuf.dispose();

      const putResp = await signedFetch('PUT', '/v1/wrapped-key', wrappedBlob);
      if (!putResp.ok) {
        console.error(`  Failed to upload wrapped key: ${putResp.status}`);
        process.exit(1);
      }
    } else {
      console.error('  Master key not found. Cannot wrap key for new device.');
      process.exit(1);
    }
  } else {
    const keyInfo = parseSSHPublicKey(newPublicKey);
    const wrappedBlob = wrapMasterKey(masterKey, keyInfo);
    masterKey.dispose();

    const putResp = await signedFetch('PUT', '/v1/wrapped-key', wrappedBlob);
    if (!putResp.ok) {
      console.error(`  Failed to upload wrapped key: ${putResp.status}`);
      process.exit(1);
    }
  }

  console.log('  Device linked successfully.');
  console.log('');
}

/**
 * `chaoskb-mcp devices list`
 *
 * Lists all registered devices for this tenant.
 */
export async function devicesListCommand(): Promise<void> {
  const { signedFetch } = await createSyncClient();

  const resp = await signedFetch('GET', '/v1/devices');
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Failed to list devices: ${resp.status} ${err}`);
    process.exit(1);
  }

  const data = await resp.json() as { devices: Array<{ fingerprint: string; registeredAt: string; publicKey?: string }> };

  console.log('');
  console.log('  Registered devices');
  console.log('  ==================');
  console.log('');

  if (data.devices.length === 0) {
    console.log('  (none)');
  } else {
    for (const device of data.devices) {
      const date = new Date(device.registeredAt).toLocaleDateString();
      console.log(`  Fingerprint: ${device.fingerprint}`);
      console.log(`  Registered:  ${date}`);
      console.log('');
    }
  }
}

/**
 * `chaoskb-mcp devices remove <fingerprint>`
 *
 * Removes a device by fingerprint.
 */
export async function devicesRemoveCommand(fingerprint: string): Promise<void> {
  const { signedFetch } = await createSyncClient();

  // Show device info before removing
  const listResp = await signedFetch('GET', '/v1/devices');
  if (listResp.ok) {
    const data = await listResp.json() as { devices: Array<{ fingerprint: string; registeredAt: string }> };
    const device = data.devices.find((d) => d.fingerprint === fingerprint);
    if (device) {
      const date = new Date(device.registeredAt).toLocaleString();
      console.log('');
      console.log(`  Removing device:`);
      console.log(`    Fingerprint: ${device.fingerprint}`);
      console.log(`    Registered:  ${date}`);
    }
  }

  const resp = await signedFetch('DELETE', `/v1/devices/${encodeURIComponent(fingerprint)}`);
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`Failed to remove device: ${resp.status} ${err}`);
    process.exit(1);
  }

  console.log('');
  console.log(`  Device ${fingerprint} removed. It will stop syncing on its next attempt.`);
  console.log('');
}
