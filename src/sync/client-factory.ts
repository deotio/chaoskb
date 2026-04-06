import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SyncConfig } from './types.js';
import type { ISyncSequenceRepository } from '../storage/types.js';
import { SSHSigner } from './ssh-signer.js';
import { SyncHttpClient } from './http-client.js';
import { SequenceCounter } from './sequence.js';

/**
 * Create a SyncHttpClient from explicit config.
 *
 * Uses a file-based SequenceCounter by default. For MCP server context
 * (where ISyncSequenceRepository is available from the DB), pass it
 * as the sequence parameter.
 */
export function createSyncHttpClientFromConfig(
  config: SyncConfig,
  sequence?: ISyncSequenceRepository,
): SyncHttpClient {
  const signer = new SSHSigner(config.sshKeyPath);
  return new SyncHttpClient(config, signer, sequence ?? new SequenceCounter());
}

/**
 * Create a SyncHttpClient by loading config from disk.
 *
 * For use in CLI commands and MCP tool handlers that don't have
 * access to the database's ISyncSequenceRepository.
 */
export async function createSyncHttpClient(): Promise<{
  client: SyncHttpClient;
  config: SyncConfig;
}> {
  const { loadConfig } = await import('../cli/commands/setup.js');
  const config = await loadConfig();

  if (!config?.endpoint) {
    throw new Error('Sync is not configured. Run `chaoskb-mcp setup-sync` first.');
  }

  const endpoint = config.endpoint;
  const sshKeyPath = config.sshKeyPath ?? join(homedir(), '.ssh', 'id_ed25519');
  const syncConfig: SyncConfig = { endpoint, sshKeyPath };

  const client = createSyncHttpClientFromConfig(syncConfig);
  return { client, config: syncConfig };
}
