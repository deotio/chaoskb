/**
 * Shared safety checker instance for the content pipeline.
 *
 * Uses @de-otio/agent-safety-pack for URL blocklist checks,
 * prompt injection detection, and secrets scanning.
 *
 * A single instance is created at module load time so pattern files
 * are only read from disk once per process.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafetyChecker, type SafetyChecker } from '@de-otio/agent-safety-pack';

// Resolve the patterns directory from the package's main entry point.
// The main entry is at {packageRoot}/dist/index.js, so patterns/ is two
// levels up from that file. Passing patternsDir explicitly avoids a
// `new Function("return import.meta.url")()` call inside the library
// that fails under Vite's ESM-to-CJS transform used by vitest.
const _indexPath = fileURLToPath(import.meta.resolve('@de-otio/agent-safety-pack'));
const _patternsDir = resolve(dirname(dirname(_indexPath)), 'patterns');

export const safetyChecker: SafetyChecker = createSafetyChecker({
  patternsDir: _patternsDir,
  localFeeds: true,
});
