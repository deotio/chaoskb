import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, saveConfig } from './setup.js';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function setupSyncCommand(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const config = await loadConfig();
    if (!config) {
      console.error('ChaosKB is not set up. Run `chaoskb-mcp setup` first.');
      process.exit(1);
    }

    console.log('');
    console.log('  ChaosKB Sync Setup');
    console.log('  ==================');
    console.log('');

    // 1. Prompt for server endpoint
    const endpoint = await prompt(rl, '  Server endpoint URL: ');

    if (!endpoint) {
      console.log('  No endpoint provided. Setup cancelled.');
      return;
    }

    // 2. Reject non-HTTPS endpoints
    if (!endpoint.startsWith('https://')) {
      console.error('');
      console.error('  Error: Only HTTPS endpoints are supported.');
      console.error('  The endpoint must start with https://');
      console.error('');
      process.exit(1);
    }

    // 3. Test connection
    console.log('');
    console.log('  Testing connection...');

    try {
      const healthUrl = new URL('/health', endpoint).href;
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`  Server returned status ${response.status}. Check the endpoint and try again.`);
        process.exit(1);
      }
      console.log('  Connection successful.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Connection failed: ${message}`);
      console.error('  Check the endpoint and try again.');
      process.exit(1);
    }

    // 4. Register SSH public key
    console.log('');
    console.log('  Registering SSH public key...');

    const sshPubKeyPath = findSSHPublicKey();
    if (!sshPubKeyPath) {
      console.error('  No SSH public key found. Ensure you have ~/.ssh/id_ed25519.pub or ~/.ssh/id_rsa.pub');
      process.exit(1);
    }

    const pubKey = fs.readFileSync(sshPubKeyPath, 'utf-8').trim();

    try {
      const registerUrl = new URL('/v1/auth/register', endpoint).href;
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: pubKey }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`  Registration failed (${response.status}): ${body}`);
        process.exit(1);
      }
      console.log('  SSH public key registered.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Registration failed: ${message}`);
      process.exit(1);
    }

    // 5. Write config
    config.endpoint = endpoint;
    config.sshKeyPath = sshPubKeyPath.replace('.pub', '');
    await saveConfig(config);

    console.log('');
    console.log(`  Config saved to ~/.chaoskb/config.json`);

    // 6. Canary blob verification
    console.log('');
    console.log('  Running canary blob verification...');
    try {
      const { EncryptionService } = await import('../../crypto/encryption-service.js');
      const { KeyringService } = await import('../../crypto/keyring.js');
      const keyring = new KeyringService();
      const masterKey = await keyring.retrieve('chaoskb', 'master-key');
      if (!masterKey) {
        console.error('  Master key not found. Run `chaoskb-mcp setup` first.');
        process.exit(1);
      }
      const encryption = new EncryptionService();
      const keys = encryption.deriveKeys(masterKey);
      const canary = encryption.encrypt(
        { type: 'canary', value: 'chaoskb-canary-v1' },
        keys,
      );
      // Upload canary
      const putUrl = new URL(`/v1/blobs/${canary.envelope.id}`, endpoint).href;
      const putResp = await fetch(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: canary.bytes,
        signal: AbortSignal.timeout(10000),
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed: ${putResp.status}`);
      }
      // Download and verify
      const getUrl = new URL(`/v1/blobs/${canary.envelope.id}`, endpoint).href;
      const getResp = await fetch(getUrl, { signal: AbortSignal.timeout(10000) });
      if (!getResp.ok) {
        throw new Error(`Download failed: ${getResp.status}`);
      }
      const downloaded = await getResp.arrayBuffer();
      const downloadedEnvelope = JSON.parse(new TextDecoder().decode(downloaded));
      const decrypted = encryption.decrypt(downloadedEnvelope, keys);
      if (decrypted.payload.type !== 'canary' || decrypted.payload.value !== 'chaoskb-canary-v1') {
        throw new Error('Canary payload mismatch');
      }
      masterKey.dispose();
      console.log('  Canary verification passed.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Canary verification failed: ${message}`);
      console.error('  Sync setup cancelled.');
      process.exit(1);
    }

    console.log('');
    console.log('  Sync setup complete!');
    console.log(`  Endpoint: ${endpoint}`);
    console.log('');
  } finally {
    rl.close();
  }
}

function findSSHPublicKey(): string | null {
  const sshDir = path.join(os.homedir(), '.ssh');
  const candidates = ['id_ed25519.pub', 'id_rsa.pub'];

  for (const candidate of candidates) {
    const keyPath = path.join(sshDir, candidate);
    if (fs.existsSync(keyPath)) {
      return keyPath;
    }
  }

  return null;
}
