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

function log(msg) {
  process.stderr.write(`[mcp-bridge] ${msg}\n`);
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

    await client.connect(transport, { timeout: 60000 });
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
  for (const [name, client] of clients) {
    try {
      await client.close();
      log(`disconnected: ${name}`);
    } catch (e) {
      log(`disconnect error ${name}: ${e.message}`);
    }
  }
  clients.clear();
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
      case "updateConfig":
        await disconnectAll();
        Object.assign(configs, params.config || {});
        for (const [name, cfg] of Object.entries(configs)) {
          try {
            await connect({ serverName: name, config: cfg });
            log(`reconnected: ${name}`);
          } catch (e) {
            log(`reconnect FAILED ${name}: ${e.message}`);
          }
        }
        result = structuredClone(configs);
        break;
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
