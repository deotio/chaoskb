import { detectAgents } from '../agent-registry/detector.js';
import { mergeAgentConfig, removeAgentConfig } from '../agent-registry/config-merger.js';
import type { DetectedAgent } from '../agent-registry/types.js';

export interface RegisterOptions {
  agentName?: string;
  projectName?: string;
}

export async function registerCommand(options: RegisterOptions): Promise<void> {
  console.log('');
  console.log('  ChaosKB Agent Registration');
  console.log('  ==========================');
  console.log('');

  // 1. Detect installed agents
  const agents = await detectAgents();

  if (agents.length === 0) {
    console.log('  No supported agents detected.');
    console.log('');
    console.log('  You can manually add ChaosKB to any MCP-compatible agent:');
    console.log('  {');
    console.log('    "mcpServers": {');
    console.log('      "chaoskb": {');
    console.log('        "command": "chaoskb-mcp",');
    console.log('        "args": []');
    console.log('      }');
    console.log('    }');
    console.log('  }');
    console.log('');
    return;
  }

  // 2. Filter to specific agent if requested
  let targetAgents: DetectedAgent[];
  if (options.agentName) {
    targetAgents = agents.filter(
      (a) =>
        a.config.name.toLowerCase() === options.agentName!.toLowerCase() ||
        a.config.displayName.toLowerCase() === options.agentName!.toLowerCase(),
    );
    if (targetAgents.length === 0) {
      console.log(`  Agent "${options.agentName}" not found.`);
      console.log('  Detected agents:');
      for (const a of agents) {
        const status = a.installed ? 'installed' : 'not installed';
        console.log(`    - ${a.config.displayName} (${status})`);
      }
      console.log('');
      return;
    }
  } else {
    targetAgents = agents.filter((a) => a.installed);
  }

  if (targetAgents.length === 0) {
    console.log('  No installed agents found to register with.');
    console.log('');
    return;
  }

  // 3. Register with each target agent
  const registered: string[] = [];
  const failed: string[] = [];

  for (const agent of targetAgents) {
    try {
      const args: string[] = [];
      if (options.projectName) {
        args.push('--project', options.projectName);
      }

      await mergeAgentConfig(agent.configFilePath, args);
      registered.push(agent.config.displayName);
      console.log(`  Registered with ${agent.config.displayName}`);
      console.log(`    Config: ${agent.configFilePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push(`${agent.config.displayName}: ${message}`);
      console.log(`  Failed to register with ${agent.config.displayName}: ${message}`);
    }
  }

  console.log('');
  if (registered.length > 0) {
    console.log(`  Successfully registered with ${registered.length} agent(s):`);
    for (const name of registered) {
      console.log(`    - ${name}`);
    }
  }
  if (failed.length > 0) {
    console.log(`  Failed to register with ${failed.length} agent(s):`);
    for (const msg of failed) {
      console.log(`    - ${msg}`);
    }
  }
  if (options.projectName) {
    console.log(`  Project: ${options.projectName}`);
  }
  console.log('');
}

export { removeAgentConfig };
