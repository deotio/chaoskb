import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentConfig, AgentRegistry } from './types.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CHAOSKB_DIR = path.join(os.homedir(), '.chaoskb');
const CACHED_REGISTRY_PATH = path.join(CHAOSKB_DIR, 'agent-registry.json');
const STALENESS_THRESHOLD_DAYS = 90;

/**
 * Load the embedded registry from the bundled JSON file.
 */
export function loadEmbeddedRegistry(): AgentRegistry {
  return require('./registry.json') as AgentRegistry;
}

/**
 * Load the cached remote registry from ~/.chaoskb/agent-registry.json, if it exists.
 */
export function loadCachedRegistry(): AgentRegistry | null {
  try {
    const raw = fs.readFileSync(CACHED_REGISTRY_PATH, 'utf-8');
    return JSON.parse(raw) as AgentRegistry;
  } catch {
    return null;
  }
}

/**
 * Check if the cached registry is stale (>90 days old).
 */
export function isRegistryStale(registry: AgentRegistry): boolean {
  const updatedAt = new Date(registry.updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - updatedAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > STALENESS_THRESHOLD_DAYS;
}

/**
 * Merge embedded and cached registries. Remote takes precedence if newer.
 * Returns the merged list of agent configs and warns if the cache is stale.
 */
export function loadAgentRegistry(): { agents: AgentConfig[]; staleWarning: boolean } {
  const embedded = loadEmbeddedRegistry();
  const cached = loadCachedRegistry();

  let staleWarning = false;

  if (!cached) {
    return { agents: embedded.agents, staleWarning: false };
  }

  // Check staleness of cached registry
  if (isRegistryStale(cached)) {
    staleWarning = true;
  }

  // If cached is newer, use it as the base and merge
  if (cached.version > embedded.version) {
    // Cached is newer: use cached agents, but keep any embedded-only agents
    const cachedNames = new Set(cached.agents.map((a) => a.name));
    const embeddedOnly = embedded.agents.filter((a) => !cachedNames.has(a.name));
    return {
      agents: [...cached.agents, ...embeddedOnly],
      staleWarning,
    };
  }

  // Embedded is same version or newer: use embedded as base, overlay cached extras
  const embeddedNames = new Set(embedded.agents.map((a) => a.name));
  const cachedOnly = cached.agents.filter((a) => !embeddedNames.has(a.name));
  return {
    agents: [...embedded.agents, ...cachedOnly],
    staleWarning,
  };
}

/**
 * Save a fetched registry to the cache file.
 */
export function saveCachedRegistry(registry: AgentRegistry): void {
  fs.mkdirSync(CHAOSKB_DIR, { recursive: true });
  fs.writeFileSync(CACHED_REGISTRY_PATH, JSON.stringify(registry, null, 2));
}
