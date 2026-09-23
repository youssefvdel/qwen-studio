#!/usr/bin/env node
// Minimal in-repo MCP server used by test/bridge-contract.test.mjs.
// Exposes a single `ping` tool so the bridge can prove it can spawn,
// initialize and list tools against a real MCP peer over stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-test-server", version: "1.0.0" });

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Echoes back a fixed payload",
    inputSchema: { text: z.string().optional() },
  },
  async ({ text }) => ({
    content: [{ type: "text", text: text ?? "pong" }],
  })
);

await server.connect(new StdioServerTransport());