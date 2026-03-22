import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dependencies
vi.mock('../../agent-registry/detector.js', () => ({
  detectAgents: vi.fn(),
}));

vi.mock('../../agent-registry/config-merger.js', () => ({
  mergeAgentConfig: vi.fn(),
  removeAgentConfig: vi.fn(),
}));

import { registerCommand } from '../../commands/register.js';
import { detectAgents } from '../../agent-registry/detector.js';
import { mergeAgentConfig } from '../../agent-registry/config-merger.js';
import type { DetectedAgent } from '../../agent-registry/types.js';

function makeAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return {
    config: {
      name: 'cursor',
      displayName: 'Cursor',
      platforms: ['darwin'],
      installPaths: { darwin: ['/Applications/Cursor.app'] },
      configPath: { darwin: '~/.cursor/mcp.json' },
      configFormat: 'json',
      supportsProjectConfig: true,
      projectConfigPath: '.cursor/mcp.json',
    },
    installed: true,
    configExists: true,
    configFilePath: '/Users/test/.cursor/mcp.json',
    registered: false,
    ...overrides,
  };
}

describe('register command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should detect and register with installed agents', async () => {
    const agent = makeAgent();
    vi.mocked(detectAgents).mockResolvedValue([agent]);
    vi.mocked(mergeAgentConfig).mockResolvedValue(undefined);

    await registerCommand({});

    expect(detectAgents).toHaveBeenCalledOnce();
    expect(mergeAgentConfig).toHaveBeenCalledWith(
      '/Users/test/.cursor/mcp.json',
      [],
    );
  });

  it('should register with specific agent when --agent is provided', async () => {
    const cursor = makeAgent();
    const vscode = makeAgent({
      config: {
        ...makeAgent().config,
        name: 'vscode',
        displayName: 'VS Code',
      },
      configFilePath: '/Users/test/.vscode/mcp.json',
    });

    vi.mocked(detectAgents).mockResolvedValue([cursor, vscode]);
    vi.mocked(mergeAgentConfig).mockResolvedValue(undefined);

    await registerCommand({ agentName: 'cursor' });

    expect(mergeAgentConfig).toHaveBeenCalledTimes(1);
    expect(mergeAgentConfig).toHaveBeenCalledWith(
      '/Users/test/.cursor/mcp.json',
      [],
    );
  });

  it('should add project args for project-scoped registration', async () => {
    const agent = makeAgent();
    vi.mocked(detectAgents).mockResolvedValue([agent]);
    vi.mocked(mergeAgentConfig).mockResolvedValue(undefined);

    await registerCommand({ projectName: 'my-project' });

    expect(mergeAgentConfig).toHaveBeenCalledWith(
      '/Users/test/.cursor/mcp.json',
      ['--project', 'my-project'],
    );
  });

  it('should handle no detected agents gracefully', async () => {
    vi.mocked(detectAgents).mockResolvedValue([]);

    await registerCommand({});

    expect(mergeAgentConfig).not.toHaveBeenCalled();
  });

  it('should handle merge failures gracefully', async () => {
    const agent = makeAgent();
    vi.mocked(detectAgents).mockResolvedValue([agent]);
    vi.mocked(mergeAgentConfig).mockRejectedValue(new Error('Permission denied'));

    // Should not throw
    await registerCommand({});
  });
});
