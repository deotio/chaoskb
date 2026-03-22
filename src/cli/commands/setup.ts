import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import type { ChaosKBConfig } from '../mcp-server.js';
import { SecurityTier } from '../../crypto/types.js';

const CHAOSKB_DIR = path.join(os.homedir(), '.chaoskb');
const CONFIG_PATH = path.join(CHAOSKB_DIR, 'config.json');

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function loadConfig(): Promise<ChaosKBConfig | null> {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as ChaosKBConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: ChaosKBConfig): Promise<void> {
  fs.mkdirSync(CHAOSKB_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export async function setupCommand(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    console.log('  ChaosKB Setup');
    console.log('  =============');
    console.log('');

    // 1. Create ~/.chaoskb/ directory
    if (fs.existsSync(CHAOSKB_DIR)) {
      console.log(`  Directory exists: ${CHAOSKB_DIR}`);
    } else {
      fs.mkdirSync(CHAOSKB_DIR, { recursive: true, mode: 0o700 });
      console.log(`  Created directory: ${CHAOSKB_DIR}`);
    }

    // Ensure correct permissions
    fs.chmodSync(CHAOSKB_DIR, 0o700);

    // Create models subdirectory
    const modelsDir = path.join(CHAOSKB_DIR, 'models');
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true, mode: 0o700 });
    }

    // 2. Prompt for security tier
    console.log('');
    console.log('  Security Tiers:');
    console.log('  1) Standard  - SSH key wrapping (recommended)');
    console.log('  2) Enhanced  - BIP39 recovery key + SSH key');
    console.log('  3) Maximum   - Argon2id passphrase derivation');
    console.log('');

    let tierChoice = '';
    while (!['1', '2', '3'].includes(tierChoice)) {
      tierChoice = await prompt(rl, '  Select security tier [1/2/3]: ');
    }

    const tierMap: Record<string, SecurityTier> = {
      '1': SecurityTier.Standard,
      '2': SecurityTier.Enhanced,
      '3': SecurityTier.Maximum,
    };

    const tier = tierMap[tierChoice];
    console.log(`  Selected: ${tier}`);

    // 3. Generate master key based on tier
    // In production, this calls into the crypto module.
    // Here we show the flow and store the tier in config.

    switch (tier) {
      case SecurityTier.Standard: {
        console.log('');
        console.log('  Generating master key...');
        const { EncryptionService } = await import('../../crypto/encryption-service.js');
        const { KeyringService } = await import('../../crypto/keyring.js');
        const encryption = new EncryptionService();
        const keyring = new KeyringService();
        const masterKey = encryption.generateMasterKey();
        await keyring.store('chaoskb', 'master-key', masterKey);
        masterKey.dispose();
        console.log('  Master key generated and stored in OS keyring.');
        break;
      }
      case SecurityTier.Enhanced: {
        console.log('');
        console.log('  Generating master key...');
        const { EncryptionService } = await import('../../crypto/encryption-service.js');
        const { KeyringService } = await import('../../crypto/keyring.js');
        const encryption = new EncryptionService();
        const keyring = new KeyringService();
        const masterKey = encryption.generateMasterKey();
        // BIP39 recovery key display is deferred — store key directly
        console.log('');
        console.log('  Note: BIP39 recovery key display not yet implemented.');
        console.log('  Using Standard-tier key storage for now.');
        console.log('');
        await keyring.store('chaoskb', 'master-key', masterKey);
        masterKey.dispose();
        console.log('  Master key generated and stored in OS keyring.');
        break;
      }
      case SecurityTier.Maximum: {
        console.log('');
        const passphrase = await prompt(rl, '  Enter master passphrase: ');
        if (!passphrase || passphrase.length < 8) {
          console.log('  Passphrase must be at least 8 characters. Setup cancelled.');
          return;
        }
        const confirm = await prompt(rl, '  Confirm passphrase: ');
        if (passphrase !== confirm) {
          console.log('  Passphrases do not match. Setup cancelled.');
          return;
        }
        console.log('  Deriving key with Argon2id (this may take a moment)...');
        const { randomBytes } = await import('node:crypto');
        const { argon2Derive } = await import('../../crypto/index.js');
        const { KeyringService } = await import('../../crypto/keyring.js');
        const salt = randomBytes(32);
        const masterKey = argon2Derive(passphrase, salt);
        const keyring = new KeyringService();
        await keyring.store('chaoskb', 'master-key', masterKey);
        masterKey.dispose();
        console.log('  Master key derived and stored in OS keyring.');
        break;
      }
    }

    // 4. Initialize database
    console.log('');
    console.log('  Initializing local database...');
    const { DatabaseManager } = await import('../../storage/database-manager.js');
    const dbManager = new DatabaseManager();
    const db = dbManager.getPersonalDb();
    console.log(`  Database: ${path.join(CHAOSKB_DIR, 'local.db')}`);
    db.close();
    dbManager.closeAll();

    // 5. Save config
    const config: ChaosKBConfig = {
      securityTier: tier,
      projects: [],
    };
    await saveConfig(config);

    console.log('');
    console.log('  Setup complete!');
    console.log('');
    console.log('  Next steps:');
    console.log('    chaoskb-mcp register     Register with your chat agents');
    console.log('    chaoskb-mcp setup sync   Configure server sync (optional)');
    console.log('');
  } finally {
    rl.close();
  }
}

export { CHAOSKB_DIR, CONFIG_PATH };
