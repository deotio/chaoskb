import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

vi.mock('node:fs');
vi.mock('../../agent-registry/index.js', () => ({
  loadAgentRegistry: vi.fn(),
}));

import { detectAgents } from '../../agent-registry/detector.js';
import { loadAgentRegistry } from '../../agent-registry/index.js';
import type { AgentConfig } from '../../agent-registry/types.js';

const cursorAgent: AgentConfig = {
  name: 'cursor',
  displayName: 'Cursor',
  platforms: ['darwin', 'linux', 'win32'],
  installPaths: {
    darwin: ['/Applications/Cursor.app'],
    linux: ['/usr/bin/cursor'],
  },
  configPath: {
    darwin: '~/.cursor/mcp.json',
    linux: '~/.cursor/mcp.json',
  },
  configFormat: 'json',
  supportsProjectConfig: true,
  projectConfigPath: '.cursor/mcp.json',
};

const claudeDesktopAgent: AgentConfig = {
  name: 'claude-desktop',
  displayName: 'Claude Desktop',
  platforms: ['darwin', 'linux'],
  installPaths: {
    darwin: ['/Applications/Claude.app'],
    linux: ['/usr/bin/claude-desktop'],
  },
  configPath: {
    darwin: '~/Library/Application Support/Claude/claude_desktop_config.json',
    linux: '~/.config/Claude/claude_desktop_config.json',
  },
  configFormat: 'json',
  supportsProjectConfig: false,
};

const win32OnlyAgent: AgentConfig = {
  name: 'win-agent',
  displayName: 'Win Agent',
  platforms: ['win32'],
  installPaths: { win32: ['C:\\Program Files\\WinAgent\\agent.exe'] },
  configPath: { win32: '~/.winagent/config.json' },
  configFormat: 'json',
  supportsProjectConfig: false,
};

describe('agent detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('should detect installed agents on macOS', async () => {
    vi.mocked(loadAgentRegistry).mockReturnValue({
      agents: [cursorAgent, claudeDesktopAgent],
      staleWarning: false,
    });

    // Cursor.app exists, Claude.app exists
    vi.mocked(fs.accessSync).mockImplementation((p: fs.PathLike) => {
      const pathStr = p.toString();
      if (pathStr === '/Applications/Cursor.app' || pathStr === '/Applications/Claude.app') {
        return;
      }
      throw new Error('ENOENT');
    });

    const agents = await detectAgents();

    // On macOS (darwin), both agents should be detected
    const cursorResult = agents.find((a) => a.config.name === 'cursor');
    const claudeResult = agents.find((a) => a.config.name === 'claude-desktop');

    if (process.platform === 'darwin') {
      expect(agents.length).toBeGreaterThanOrEqual(2);
      expect(cursorResult?.installed).toBe(true);
      expect(claudeResult?.installed).toBe(true);
    }
  });

  it('should filter agents by current platform', async () => {
    vi.mocked(loadAgentRegistry).mockReturnValue({
      agents: [cursorAgent, win32OnlyAgent],
      staleWarning: false,
    });
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const agents = await detectAgents();

    // win32-only agent should not appear on non-win32 platforms
    if (process.platform !== 'win32') {
      const winAgent = agents.find((a) => a.config.name === 'win-agent');
      expect(winAgent).toBeUndefined();
    }
  });

  it('should detect ChaosKB registration status', async () => {
    vi.mocked(loadAgentRegistry).mockReturnValue({
      agents: [cursorAgent],
      staleWarning: false,
    });
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          chaoskb: { command: 'chaoskb-mcp', args: [] },
        },
      }),
    );

    const agents = await detectAgents();
    const cursor = agents.find((a) => a.config.name === 'cursor');

    if (process.platform !== 'win32') {
      expect(cursor?.registered).toBe(true);
    }
  });

  it('should show staleness warning for old cache', async () => {
    vi.mocked(loadAgentRegistry).mockReturnValue({
      agents: [cursorAgent],
      staleWarning: true,
    });
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    await detectAgents();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('90 days old'),
    );
  });
});
