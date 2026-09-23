#!/usr/bin/env node
/**
 * Prepares mcp-runtime/ — a minimal production node_modules tree that the
 * bundled (installed) app needs at runtime:
 *
 *   - @modelcontextprotocol/sdk  (used by mcp-bridge.mjs)
 *   - tsx + qwen-core            (Windows qwen-core launcher: node tsx src)
 *
 * The full project node_modules (~196M, dev deps included) is never shipped;
 * this tree is installed fresh from the registry with --omit=dev and is
 * referenced from tauri.conf.json bundle.resources.
 *
 * Usage: node scripts/prepare-mcp-runtime.mjs
 */

import { spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dirname, '..');
const runtimeDir = join(root, 'mcp-runtime');

// Keep these in sync with package.json dependencies.
const deps = {
  '@modelcontextprotocol/sdk': '^1.29.0',
  tsx: '^4.22.0',
  'qwen-core': '^2.2.0',
};

mkdirSync(runtimeDir, { recursive: true });
writeFileSync(
  join(runtimeDir, 'package.json'),
  JSON.stringify({ name: 'qwen-studio-mcp-runtime', private: true, dependencies: deps }, null, 2) + '\n'
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const res = spawnSync(
  npm,
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel', 'error'],
  { cwd: runtimeDir, stdio: 'inherit', shell: process.platform === 'win32' }
);
if (res.status !== 0) {
  console.error('prepare-mcp-runtime: npm install failed');
  process.exit(res.status ?? 1);
}

// The bridge script must live INSIDE mcp-runtime/ (next to its node_modules):
// ESM resolution walks up from the script's own directory, so a copy in the
// install root would not see mcp-runtime/node_modules and would die with
// ERR_MODULE_NOT_FOUND on '@modelcontextprotocol/sdk'.
copyFileSync(join(root, 'mcp-bridge.mjs'), join(runtimeDir, 'mcp-bridge.mjs'));

// Sanity check: the entry points the Rust side resolves at runtime.
// qwen-core ships a prebuilt dist/index.mjs (no tsx needed); tsx stays as a
// fallback for older qwen-core versions that only expose src/index.ts.
const qwenCoreDist = join(runtimeDir, 'node_modules', 'qwen-core', 'dist', 'index.mjs');
const tsxCli = join(runtimeDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
for (const p of [qwenCoreDist, tsxCli]) {
  if (!existsSync(p)) {
    console.error(`prepare-mcp-runtime: expected file missing: ${p}`);
    process.exit(1);
  }
}
console.log('prepare-mcp-runtime: OK');
