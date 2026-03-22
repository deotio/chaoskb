import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentConfig, DetectedAgent } from './types.js';
import { loadAgentRegistry } from './index.js';

/**
 * Expand ~ to the user's home directory in a path.
 */
function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/**
 * Check if a path exists on the filesystem.
 * Handles glob-style wildcards in win32 paths by checking the literal path only.
 */
function pathExists(p: string): boolean {
  try {
    const expanded = expandHome(p);
    fs.accessSync(expanded, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an agent is installed by checking its install paths for the current platform.
 */
function isAgentInstalled(agent: AgentConfig): boolean {
  const platform = process.platform as string;
  const paths = agent.installPaths[platform];

  if (!paths || paths.length === 0) {
    // For agents like Continue.dev with no install paths,
    // check if the config file exists instead
    const configPath = agent.configPath[platform];
    if (configPath) {
      return pathExists(configPath);
    }
    return false;
  }

  return paths.some((p) => pathExists(p));
}

/**
 * Get the resolved config file path for an agent on the current platform.
 */
function getConfigFilePath(agent: AgentConfig): string {
  const platform = process.platform as string;
  const configPath = agent.configPath[platform];
  if (!configPath) {
    return '';
  }
  return expandHome(configPath);
}

/**
 * Check if ChaosKB is already registered in an agent's config file.
 */
function isChaosKBRegistered(configFilePath: string): boolean {
  try {
    const raw = fs.readFileSync(configFilePath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
    return mcpServers !== undefined && 'chaoskb' in mcpServers;
  } catch {
    return false;
  }
}

/**
 * Detect all installed agents and their registration status.
 * Filters by the current platform.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const { agents, staleWarning } = loadAgentRegistry();

  if (staleWarning) {
    console.warn(
      '  Warning: Agent registry cache is over 90 days old. Run `chaoskb-mcp setup` to refresh.',
    );
  }

  const platform = process.platform as 'darwin' | 'linux' | 'win32';
  const detected: DetectedAgent[] = [];

  for (const agent of agents) {
    // Skip agents not available on this platform
    if (!agent.platforms.includes(platform)) {
      continue;
    }

    const configFilePath = getConfigFilePath(agent);
    const installed = isAgentInstalled(agent);
    const configExists = configFilePath ? pathExists(configFilePath) : false;
    const registered = configExists ? isChaosKBRegistered(configFilePath) : false;

    detected.push({
      config: agent,
      installed,
      configExists,
      configFilePath,
      registered,
    });
  }

  return detected;
}
