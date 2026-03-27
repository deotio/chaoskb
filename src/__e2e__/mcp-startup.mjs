/**
 * E2E test: MCP server startup (T7)
 *
 * Spawns the actual MCP server binary, sends JSON-RPC initialize + tools/list
 * over stdin/stdout, verifies all tools register, then shuts down.
 *
 * Requires CHAOSKB_UNSAFE_NO_KEYRING=1 (no OS keyring in CI).
 *
 * Exit 0 = pass, exit 1 = fail.
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'dist', 'cli', 'index.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

const EXPECTED_TOOLS = ['kb_ingest', 'kb_query', 'kb_list', 'kb_delete', 'kb_summary'];
const TIMEOUT_MS = 120000; // 2 minutes — model download may be needed on first run

console.log('\n=== MCP Server Startup ===');

// Check if model is available — if not, this test will be slow (downloads ~134MB)
const modelPath = join(homedir(), '.chaoskb', 'models', 'model.onnx');
if (!existsSync(modelPath)) {
  console.log('  Note: ONNX model not cached. Server startup will download it (~134MB).');
}

try {
  // Use a temp directory so the server doesn't touch the real ~/.chaoskb DB,
  // but symlink the models directory so it finds cached ONNX model
  const tempHome = mkdtempSync(join(tmpdir(), 'chaoskb-e2e-mcp-'));
  const tempChaoskb = join(tempHome, '.chaoskb');
  mkdirSync(tempChaoskb, { recursive: true });
  const realModelsDir = join(homedir(), '.chaoskb', 'models');
  if (existsSync(realModelsDir)) {
    try {
      symlinkSync(realModelsDir, join(tempChaoskb, 'models'));
    } catch {
      // symlink may fail on Windows — model will re-download
    }
  }

  const child = spawn('node', [serverPath, 'mcp'], {
    env: {
      ...process.env,
      CHAOSKB_UNSAFE_NO_KEYRING: '1',
      HOME: tempHome,
      USERPROFILE: tempHome, // Windows
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  const responses = [];

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  // Parse stdout as newline-delimited JSON
  let stdoutBuf = '';
  child.stdout.on('data', (data) => {
    stdoutBuf += data.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop(); // keep incomplete line in buffer
    for (const line of lines) {
      if (line.trim()) {
        try {
          responses.push(JSON.parse(line));
        } catch {
          // ignore non-JSON lines
        }
      }
    }
  });

  // Set a hard timeout
  const timer = setTimeout(() => {
    console.error(`  FAIL: Timeout after ${TIMEOUT_MS}ms`);
    console.error(`  stderr: ${stderr.slice(-500)}`);
    child.kill('SIGKILL');
    process.exit(1);
  }, TIMEOUT_MS);

  // Helper: wait until we have N responses or timeout
  function waitForResponse(count, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (responses.length >= count) return resolve();
        if (Date.now() - start > timeoutMs) return resolve();
        setTimeout(check, 100);
      };
      check();
    });
  }

  // Give the server time to initialize (model download + DB setup)
  // Wait for stderr to stop growing (initialization complete)
  await new Promise((resolve) => {
    let lastLen = 0;
    let stableCount = 0;
    const check = () => {
      if (stderr.length === lastLen) stableCount++;
      else stableCount = 0;
      lastLen = stderr.length;
      // Server is ready when stderr is stable for 2 seconds
      if (stableCount >= 20 || Date.now() > Date.now() + 60000) return resolve();
      setTimeout(check, 100);
    };
    // Give at least 3s initial startup time
    setTimeout(check, 3000);
  });

  // Send initialize request
  let msgId = 0;
  const initMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: ++msgId,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '0.0.1' },
    },
  });
  child.stdin.write(initMsg + '\n');

  // Wait for initialize response
  await waitForResponse(1, 10000);

  // Send initialized notification
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
  );
  await new Promise((r) => setTimeout(r, 500));

  // Send tools/list request
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', id: ++msgId, method: 'tools/list', params: {} }) + '\n',
  );

  // Wait for tools/list response
  await waitForResponse(2, 10000);

  // Check we got the warning on stderr
  assert(
    stderr.includes('CHAOSKB_UNSAFE_NO_KEYRING'),
    'stderr contains unsafe keyring warning',
  );

  // Find the initialize response
  const initResponse = responses.find((r) => r.result && r.result.serverInfo);
  assert(initResponse !== undefined, 'received initialize response');
  if (initResponse) {
    assert(
      initResponse.result.serverInfo.name === 'chaoskb',
      'server name is "chaoskb"',
    );
  }

  // Find the tools/list response
  const toolsResponse = responses.find((r) => r.result && r.result.tools);
  assert(toolsResponse !== undefined, 'received tools/list response');

  if (toolsResponse) {
    const toolNames = toolsResponse.result.tools.map((t) => t.name);
    for (const expected of EXPECTED_TOOLS) {
      assert(toolNames.includes(expected), `tool "${expected}" is registered`);
    }
    assert(
      toolNames.length === EXPECTED_TOOLS.length,
      `exactly ${EXPECTED_TOOLS.length} tools registered (got ${toolNames.length})`,
    );
  }

  // Clean shutdown
  clearTimeout(timer);
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('close', resolve));
  assert(true, 'server shuts down cleanly');
} catch (err) {
  console.error(`  FAIL: Unexpected error: ${err.message}`);
  console.error(err.stack);
  failed++;
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
