import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelManager } from '../model-manager.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'chaoskb-model-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('ModelManager', () => {
  describe('getModelPath', () => {
    it('returns path under the configured models directory', () => {
      const manager = new ModelManager(tempDir);
      expect(manager.getModelPath()).toBe(join(tempDir, 'model.onnx'));
    });

    it('uses default directory when none specified', () => {
      const manager = new ModelManager();
      const path = manager.getModelPath();
      expect(path).toContain('.chaoskb');
      expect(path).toContain('models');
      expect(path).toMatch(/model\.onnx$/);
    });
  });

  describe('isModelReady', () => {
    it('returns false when model file does not exist', async () => {
      const manager = new ModelManager(tempDir);
      expect(await manager.isModelReady()).toBe(false);
    });

    it('returns false when hash file does not exist', async () => {
      const manager = new ModelManager(tempDir);
      await writeFile(join(tempDir, 'model.onnx'), 'fake model data');
      expect(await manager.isModelReady()).toBe(false);
    });

    it('returns false when hash does not match', async () => {
      const manager = new ModelManager(tempDir);
      await writeFile(join(tempDir, 'model.onnx'), 'fake model data');
      await writeFile(join(tempDir, 'model.onnx.sha256'), 'wrong-hash\n');
      expect(await manager.isModelReady()).toBe(false);
    });

    it('returns true when model exists and hash matches', async () => {
      const manager = new ModelManager(tempDir);
      const content = 'fake model data for hash test';
      const hash = createHash('sha256').update(content).digest('hex');

      await writeFile(join(tempDir, 'model.onnx'), content);
      await writeFile(join(tempDir, 'model.onnx.sha256'), hash + '\n');

      expect(await manager.isModelReady()).toBe(true);
    });
  });

  describe('ensureModel', () => {
    it('returns path immediately if model is already ready', async () => {
      const manager = new ModelManager(tempDir);
      const content = 'pre-existing model content';
      const hash = createHash('sha256').update(content).digest('hex');

      await writeFile(join(tempDir, 'model.onnx'), content);
      await writeFile(join(tempDir, 'model.onnx.sha256'), hash + '\n');

      const path = await manager.ensureModel();
      expect(path).toBe(join(tempDir, 'model.onnx'));

      // Verify content was not modified
      const readContent = await readFile(path, 'utf-8');
      expect(readContent).toBe(content);
    });

    it('creates directory structure when it does not exist', async () => {
      const nestedDir = join(tempDir, 'deep', 'nested', 'models');
      const manager = new ModelManager(nestedDir);

      // Mock fetch to fail immediately instead of hitting the network
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network disabled in test'));

      // This will try to download and will fail,
      // but it should create the directory first
      try {
        await manager.ensureModel();
      } catch {
        // Expected to fail on download
      } finally {
        globalThis.fetch = originalFetch;
      }

      // Directory should have been created
      const { access } = await import('node:fs/promises');
      await expect(access(nestedDir)).resolves.toBeUndefined();
    });
  });
});
