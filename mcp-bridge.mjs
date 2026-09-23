#!/usr/bin/env node
/**
 * MCP Bridge — Node.js process managing MCP servers via @modelcontextprotocol/sdk.
 *
 * Protocol (NDJSON via stdin/stdout):
 *   READ:  { "id": N, "method": "...", "params": {...} }
 *   WRITE: { "id": N, "result": {...} } | { "id": N, "error": { "message": "..." } }
 *
 * Commands:
 *   connect     — spawn/connect an MCP server
 *   disconnect  — shut down all servers
 *   listTools   — list tools from one server
 *   callTool    — call a tool on one server
 *   getConfig   — return current config
 *   updateConfig — update config, reconnect all
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createInterface } from "readline";

const clients = new Map();
const configs = {};

// The Rust side waits 60s for any reply (src/mcp.rs `send`). A single server
// that never answers `initialize` must not eat that whole budget, so every
// handshake gets its own, smaller deadline and servers connect concurrently.
// 30s: `npx -y pkg@latest` resolves the version through the npm registry, and
// on a cold start (4 servers spawning in parallel while the app itself is
// still booting) 15s was not enough — Filesystem intermittently timed out.
const CONNECT_TIMEOUT_MS = 30000;

function log(msg) {
  process.stderr.write(`[mcp-bridge] ${msg}\n`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ id, result }) + "\n");
}

function error(id, message) {
  process.stdout.write(JSON.stringify({ id, error: { message } }) + "\n");
}

async function connect(params) {
  const { serverName, config } = params;
  log(`connect: ${serverName} with ${config.command} ${(config.args||[]).join(" ")}`);

  try {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) },
      cwd: config.cwd || undefined,
    });

    const client = new Client(
      { name: "qwen-studio-bridge", version: "2.2.0" },
      { capabilities: {} }
    );

    try {
      await withTimeout(
        client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }),
        CONNECT_TIMEOUT_MS,
        `connect ${serverName}`
      );
    } catch (e) {
      // A timed-out handshake leaves the child process alive; reap it so hung
      // servers do not pile up as orphans across config updates.
      await Promise.resolve(transport.close()).catch(() => {});
      throw e;
    }

    clients.set(serverName, client);
    log(`connected: ${serverName}`);
    return { ok: true };
  } catch (e) {
    log(`connect FAILED ${serverName}: ${e.message}`);
    throw e;
  }
}

async function listTools(params) {
  const client = clients.get(params.serverName);
  if (!client) {
    // Server not connected - return empty list instead of error
    // so the web app shows "0 tools" instead of "Tool call failed"
    return { tools: [] };
  }
  const result = await client.listTools();
  return { tools: result.tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })) };
}

async function callTool(params) {
  const client = clients.get(params.serverName);
  if (!client) {
    return { content: [{ type: "text", text: `Server "${params.serverName}" is not connected. Enable it in MCP settings.` }] };
  }
  const result = await client.callTool({
    name: params.toolName,
    arguments: params.toolArguments || {},
  });
  return result;
}

async function disconnectAll() {
  log("disconnecting all servers");
  const pending = [];
  for (const [name, client] of clients) {
    pending.push(
      (async () => {
        try {
          await client.close();
          log(`disconnected: ${name}`);
        } catch (e) {
          log(`disconnect error ${name}: ${e.message}`);
        }
      })()
    );
  }
  // Wait for every child to actually shut down before clearing the map. On
  // Windows killing npx.cmd/uvx does NOT cascade to its node grandchildren, so
  // closing concurrently is not enough — a fresh spawn racing the dying child
  // is what made Filesystem/Sequential-Thinking intermittently time out.
  await Promise.all(pending);
  clients.clear();
  // Give the OS a beat to release process/pipe handles before the next spawn.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

log("MCP bridge started");

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore non-JSON lines
  }

  const { id, method, params = {} } = msg;

  try {
    let result;
    switch (method) {
      case "connect":
        result = await connect(params);
        break;
      case "disconnect":
        await disconnectAll();
        result = { ok: true };
        break;
      case "listTools":
        result = await listTools(params);
        break;
      case "callTool":
        result = await callTool(params);
        break;
      case "getConfig":
        result = structuredClone(configs);
        break;
      case "updateConfig": {
        const incoming = params.config || {};
        // Diff against the live config instead of a full disconnect+reconnect.
        // Reconnecting unchanged servers (e.g. Filesystem when the UI only
        // edits qwen-core) is what intermittently turned healthy servers red:
        // killing npx.cmd/uvx does not reap its node grandchildren, so a fresh
        // spawn raced the dying child and timed out.
        const removed = Object.keys(configs).filter((n) => !(n in incoming));
        const changed = Object.keys(incoming).filter((n) => {
          if (!(n in configs)) return true; // newly added
          return JSON.stringify(configs[n]) !== JSON.stringify(incoming[n]);
        });
        const reconnect = [...removed, ...changed];
        const unchanged = Object.keys(incoming).filter((n) => !reconnect.includes(n));

        // Close only the servers being removed or replaced.
        for (const name of reconnect) {
          const client = clients.get(name);
          if (!client) continue;
          try {
            await client.close();
            log(`disconnected: ${name}`);
          } catch (e) {
            log(`disconnect error ${name}: ${e.message}`);
          }
          clients.delete(name);
        }
        if (reconnect.length > 0) {
          // Give the OS a beat to release handles from the closed children.
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        Object.assign(configs, incoming);

        // Reconnect only what changed (concurrently, so a single hung server
        // still costs one CONNECT_TIMEOUT_MS rather than stalling the rest).
        const settled = await Promise.allSettled(
          reconnect.map((name) => connect({ serverName: name, config: incoming[name] }))
        );
        const statuses = {};
        settled.forEach((res, i) => {
          const name = reconnect[i];
          if (res.status === "fulfilled") {
            statuses[name] = { status: "connected" };
          } else {
            statuses[name] = { status: "failed", error: String(res.reason?.message || res.reason) };
          }
        });
        // Unchanged servers keep their existing live status.
        for (const name of unchanged) {
          statuses[name] = { status: "connected" };
        }
        log(
          "updateConfig statuses: " +
            Object.keys(incoming)
              .map((name) => `${name}=${statuses[name]?.status || "missing"}`)
              .join(", ")
        );
        result = { config: structuredClone(configs), statuses };
        break;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    reply(id, result);
  } catch (e) {
    error(id, e.message);
  }
});

rl.on("close", () => {
  log("stdin closed, shutting down");
  disconnectAll().then(() => process.exit(0));
});
