import { detectAgents } from '../agent-registry/detector.js';
import { removeAgentConfig } from '../agent-registry/config-merger.js';

export async function unregisterCommand(): Promise<void> {
  console.log('');
  console.log('  ChaosKB Agent Unregistration');
  console.log('  ============================');
  console.log('');

  // 1. Detect agents that have ChaosKB registered
  const agents = await detectAgents();
  const registeredAgents = agents.filter((a) => a.registered);

  if (registeredAgents.length === 0) {
    console.log('  ChaosKB is not registered with any agents.');
    console.log('');
    return;
  }

  // 2. Remove from all registered agents
  const removed: string[] = [];
  const failed: string[] = [];

  for (const agent of registeredAgents) {
    try {
      await removeAgentConfig(agent.configFilePath);
      removed.push(agent.config.displayName);
      console.log(`  Removed from ${agent.config.displayName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(`${agent.config.displayName}: ${message}`);
      console.log(`  Failed to remove from ${agent.config.displayName}: ${message}`);
    }
  }

  console.log('');
  if (removed.length > 0) {
    console.log(`  Removed from ${removed.length} agent(s):`);
    for (const name of removed) {
      console.log(`    - ${name}`);
    }
  }
  if (failed.length > 0) {
    console.log(`  Failed to remove from ${failed.length} agent(s):`);
    for (const msg of failed) {
      console.log(`    - ${msg}`);
    }
  }
  console.log('');
}
