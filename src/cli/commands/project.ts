import * as readline from 'node:readline';
import { loadConfig, saveConfig } from './setup.js';

export interface ProjectOptions {
  action: 'create' | 'list' | 'delete';
  name?: string;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

export async function projectCommand(options: ProjectOptions): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.error('ChaosKB is not set up. Run `chaoskb-mcp setup` first.');
    process.exit(1);
    return; // unreachable, but helps TypeScript
  }

  switch (options.action) {
    case 'create':
      await createProject(options.name!, config);
      break;
    case 'list':
      await listProjects(config);
      break;
    case 'delete':
      await deleteProject(options.name!, config);
      break;
  }
}

async function createProject(
  name: string,
  config: Awaited<ReturnType<typeof loadConfig>> & object,
): Promise<void> {
  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error('Project name must contain only letters, numbers, hyphens, and underscores.');
    process.exit(1);
  }

  // Check for duplicates
  const existing = config.projects.find(
    (p: { name: string }) => p.name === name,
  );
  if (existing) {
    console.error(`Project "${name}" already exists.`);
    process.exit(1);
  }

  console.log('');
  console.log(`  Creating project KB: ${name}`);

  const { DatabaseManager } = await import('../../storage/database-manager.js');
  const dbManager = new DatabaseManager();
  dbManager.getProjectDb(name); // Creates the project DB
  dbManager.closeAll();

  config.projects.push({ name, createdAt: new Date().toISOString() });
  await saveConfig(config);

  console.log(`  Project "${name}" created.`);
  console.log('');
  console.log('  To use with agents:');
  console.log(`    chaoskb-mcp register --project ${name}`);
  console.log('');
}

async function listProjects(
  config: Awaited<ReturnType<typeof loadConfig>> & object,
): Promise<void> {
  console.log('');
  console.log('  Project KBs');
  console.log('  ===========');
  console.log('');

  if (config.projects.length === 0) {
    console.log('  No project KBs created.');
    console.log('');
    console.log('  Create one with:');
    console.log('    chaoskb-mcp project create <name>');
    console.log('');
    return;
  }

  const { DatabaseManager } = await import('../../storage/database-manager.js');
  const dbManager = new DatabaseManager();
  for (const project of config.projects) {
    let sourceCount = 0;
    try {
      const db = dbManager.getProjectDb(project.name);
      sourceCount = db.sources.count();
    } catch { /* ignore */ }
    console.log(`  ${project.name}`);
    console.log(`    Created:  ${project.createdAt}`);
    console.log(`    Articles: ${sourceCount}`);
  }
  dbManager.closeAll();
  console.log('');
}

async function deleteProject(
  name: string,
  config: Awaited<ReturnType<typeof loadConfig>> & object,
): Promise<void> {
  const index = config.projects.findIndex(
    (p: { name: string }) => p.name === name,
  );
  if (index === -1) {
    console.error(`Project "${name}" not found.`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    console.log(`  This will permanently delete project "${name}" and all its data.`);
    const answer = await prompt(rl, `  Type the project name to confirm: `);

    if (answer !== name) {
      console.log('  Confirmation failed. Deletion cancelled.');
      return;
    }

    const { DatabaseManager } = await import('../../storage/database-manager.js');
    const dbManager = new DatabaseManager();
    dbManager.deleteProject(name);
    dbManager.closeAll();

    config.projects.splice(index, 1);
    await saveConfig(config);

    console.log(`  Project "${name}" deleted.`);
    console.log('');
  } finally {
    rl.close();
  }
}
