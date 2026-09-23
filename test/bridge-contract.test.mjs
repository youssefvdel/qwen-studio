// Contract tests for mcp-bridge.mjs (feat/windows-build).
// Run: node test/bridge-contract.test.mjs
//
// These exercise the bridge over its real NDJSON protocol (spawn `node
// mcp-bridge.mjs`, write requests to stdin, read replies from stdout) so they
// validate actual startup behavior, not a mock. They are intentionally offline:
// servers are launched via `node <fixture>` or a local `.cmd` shim, never `npx
// -y` (which would hit the network and make timing nondeterministic).
//
// Hypotheses under test:
//   H1: on Windows a `.cmd` shim (npx/uvx) can be spawned by the bridge.
//   H3: a single hung server must not stall updateConfig past the Rust budget
//       (Rust `send()` waits 60s) and must not prevent other servers connecting.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const bridgePath = join(repoRoot, "mcp-bridge.mjs");
const fixtureServer = join(here, "fixtures", "mcp-test-server.mjs");
const fixtureCmdShim = join(here, "fixtures", "mcp-test-server.cmd");

const isWin = process.platform === "win32";
// Rust-side budget is 60s; require the bridge to answer well under it.
const UPDATE_BUDGET_MS = 40000;

function startBridge() {
  const child = spawn(process.execPath, [bridgePath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  const pending = new Map();
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  let nextId = 1;
  function send(method, params = {}, timeoutMs = 60000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for '${method}' after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  return { child, send };
}

const nodeServer = {
  command: process.execPath,
  args: [fixtureServer],
  transportType: "stdio",
};

// A server that starts but never answers `initialize` (hangs on stdin).
const hungServer = {
  command: process.execPath,
  args: ["-e", "require('fs').readFileSync(0,'utf8')"],
  transportType: "stdio",
};

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  - ${name}`);
  } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log(`  FAIL- ${name}\n        ${e.message}`);
  }
}

async function main() {
  console.log("mcp-bridge contract tests");

  // H1: bridge can spawn a `.cmd` shim on Windows (mirrors npx/uvx).
  await test("connects a server launched via a .cmd shim", async () => {
    if (!isWin) {
      console.log("        (skipped: not on Windows)");
      return;
    }
    const { child, send } = startBridge();
    try {
      const r = await send("connect", {
        serverName: "CmdShim",
        config: { command: fixtureCmdShim, args: [], transportType: "stdio" },
      });
      assert.ok(!r.error, `connect error: ${r.error?.message}`);
      const tools = await send("listTools", { serverName: "CmdShim" });
      assert.ok(
        Array.isArray(tools.result?.tools) && tools.result.tools.length > 0,
        "cmd-shim server exposed no tools"
      );
    } finally {
      child.kill();
    }
  });

  // H3: one hung server must not stall updateConfig past the Rust budget,
  // and must not stop a healthy server from connecting.
  await test("updateConfig survives a hung server within budget", async () => {
    const { child, send } = startBridge();
    try {
      const start = Date.now();
      // Hung server listed FIRST so a sequential loop stalls before reaching
      // the healthy one.
      const r = await send(
        "updateConfig",
        { config: { Hung: hungServer, Good: nodeServer } },
        UPDATE_BUDGET_MS
      );
      const elapsed = Date.now() - start;
      assert.ok(!r.error, `updateConfig error: ${r.error?.message}`);
      assert.ok(
        elapsed < UPDATE_BUDGET_MS,
        `updateConfig took ${elapsed}ms (>= ${UPDATE_BUDGET_MS}ms budget)`
      );
      const tools = await send("listTools", { serverName: "Good" });
      assert.ok(
        Array.isArray(tools.result?.tools) && tools.result.tools.length > 0,
        "healthy server failed to connect because a sibling hung"
      );
    } finally {
      child.kill();
    }
  });

  // Baseline: a normal server connects and lists tools (guards the harness).
  await test("connects a plain node MCP server and lists tools", async () => {
    const { child, send } = startBridge();
    try {
      const r = await send("connect", {
        serverName: "Good",
        config: nodeServer,
      });
      assert.ok(!r.error, `connect error: ${r.error?.message}`);
      const tools = await send("listTools", { serverName: "Good" });
      assert.ok(
        tools.result?.tools?.some((t) => t.name === "ping"),
        "ping tool missing"
      );
    } finally {
      child.kill();
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} passed`
  );
  process.exit(failed.length ? 1 : 0);
}

main();
