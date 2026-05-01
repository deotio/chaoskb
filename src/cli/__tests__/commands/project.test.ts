import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../commands/setup.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((_q: string, cb: (answer: string) => void) => cb('test-project')),
    close: vi.fn(),
  }),
}));

import { projectCommand } from '../../commands/project.js';
import { loadConfig, saveConfig } from '../../commands/setup.js';

describe('project command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('create', () => {
    it('should create a new project', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [],
      });
      vi.mocked(saveConfig).mockResolvedValue(undefined);

      await projectCommand({ action: 'create', name: 'test-project' });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: [
            expect.objectContaining({ name: 'test-project' }),
          ],
        }),
      );
    });

    it('should reject duplicate project names', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [{ name: 'existing', createdAt: '2026-03-01T00:00:00Z' }],
      });

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(
        projectCommand({ action: 'create', name: 'existing' }),
      ).rejects.toThrow('process.exit');

      mockExit.mockRestore();
    });

    it('should reject invalid project names', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [],
      });

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(
        projectCommand({ action: 'create', name: 'invalid name!' }),
      ).rejects.toThrow('process.exit');

      mockExit.mockRestore();
    });
  });

  describe('list', () => {
    it('should list projects', async () => {
      const consoleOutput: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.join(' '));
      });

      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [
          { name: 'project-a', createdAt: '2026-03-01T00:00:00Z' },
          { name: 'project-b', createdAt: '2026-03-10T00:00:00Z' },
        ],
      });

      await projectCommand({ action: 'list' });

      expect(consoleOutput.some((l) => l.includes('project-a'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('project-b'))).toBe(true);
    });

    it('should show empty message when no projects exist', async () => {
      const consoleOutput: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.join(' '));
      });

      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [],
      });

      await projectCommand({ action: 'list' });

      expect(consoleOutput.some((l) => l.includes('No project KBs'))).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a project after confirmation', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [{ name: 'test-project', createdAt: '2026-03-01T00:00:00Z' }],
      });
      vi.mocked(saveConfig).mockResolvedValue(undefined);

      await projectCommand({ action: 'delete', name: 'test-project' });

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          projects: [],
        }),
      );
    });

    it('should reject deleting non-existent project', async () => {
      vi.mocked(loadConfig).mockResolvedValue({
        securityTier: 'standard',
        projects: [],
      });

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit');
      }) as never);

      await expect(
        projectCommand({ action: 'delete', name: 'nonexistent' }),
      ).rejects.toThrow('process.exit');

      mockExit.mockRestore();
    });
  });
});
