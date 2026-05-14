/**
 * MCP Proxy — multi-server connection manager
 *
 * Manages connections to multiple MCP (Model Context Protocol) servers.
 * Provides a unified API for listing tools and calling tools across servers.
 *
 * Key features:
 * - Lazy connection: servers are connected on-demand via getClient()
 * - Client caching: stdio clients are cached and reused; HTTP/SSE are stateless
 * - HTTP proxy endpoints: /listTools and /callTool for external access (unused)
 * - Express app exposed via getApp() for custom routing
 *
 * Replaces the official app's @ali/spark-mcp with an open-source implementation
 * built on @modelcontextprotocol/sdk.
 */

import express from "express";
import cors from "cors";
import type http from "http";
import { McpServerClient } from "./server-client.js";
import type { McpConfig, ToolCallParams } from "../shared/types.js";

/**
 * MCP Proxy Server
 * Manages multiple MCP server connections and provides HTTP + programmatic API
 * This replaces @ali/spark-mcp with a clean, open-source implementation
 */
class McpProxy {
  private app: express.Express;
  private httpServer: http.Server | null = null;
  private mcpServers: McpConfig = {};
  private clients: Map<string, McpServerClient> = new Map();
  private httpPort: number = 3000;

  constructor() {
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    // HTTP endpoints for proxy access (same as official app)
    this.app.get("/listTools", this.listToolsByHTTP.bind(this));
    this.app.post("/callTool", this.callToolByHTTP.bind(this));
  }

  /**
   * Set or update MCP server configurations
   * Resets all clients when config changes and auto-connects
   */
  async setMCPServers(config: McpConfig): Promise<void> {
    console.log("[MCP Proxy] === setMCPServers called ===");
    console.log("[MCP Proxy] New servers:", Object.keys(config));
    console.log("[MCP Proxy] Full config:", JSON.stringify(config, null, 2));

    // Disconnect all existing clients
    await this.disconnectAll();

    this.mcpServers = { ...config };
    this.clients.clear();

    // Auto-connect to all servers (not lazy - connect immediately)
    for (const serverName of Object.keys(config)) {
      try {
        console.log(`[MCP Proxy] Auto-connecting to: ${serverName}`);
        await this.getClient(serverName);
        console.log(`[MCP Proxy] ✅ Connected to: ${serverName}`);
      } catch (error) {
        console.error(`[MCP Proxy] ❌ Failed to connect to ${serverName}:`, error);
      }
    }

    console.log("[MCP Proxy] Servers updated successfully");
    console.log(
      "[MCP Proxy] Current mcpServers:",
      Object.keys(this.mcpServers),
    );
    console.log(
      "[MCP Proxy] Connected clients:",
      Array.from(this.clients.keys()),
    );
  }

  /**
   * Get current MCP server configurations
   */
  getMCPServers(): McpConfig {
    console.log(
      "[MCP Proxy] getMCPServers called, returning:",
      Object.keys(this.mcpServers),
    );
    return this.mcpServers;
  }

  /**
   * List tools for a specific server
   */
  async listTools(params: { serverName: string }): Promise<{ tools: any[] }> {
    console.log(`[MCP Proxy] listTools called for: "${params.serverName}"`);
    const client = await this.getClient(params.serverName);
    if (!client) {
      console.error(
        `[MCP Proxy] ❌ listTools failed - client not found for: "${params.serverName}"`,
      );
      throw new Error(`MCP client not found: ${params.serverName}`);
    }
    const result = await client.listTools();
    console.log(
      `[MCP Proxy] ✅ listTools success for: "${params.serverName}", tools:`,
      result.tools?.length || 0,
    );
    return result;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(params: ToolCallParams): Promise<unknown> {
    console.log(
      `[MCP Proxy] callTool called: server="${params.serverName}", tool="${params.toolName}"`,
    );
    const client = await this.getClient(params.serverName);
    if (!client) {
      console.error(
        `[MCP Proxy] ❌ callTool failed - client not found for: "${params.serverName}"`,
      );
      throw new Error(`MCP client not found: ${params.serverName}`);
    }
    return client.callTool(params);
  }

  /**
   * Get or create a client for a server
   */
  private async getClient(serverName: string): Promise<McpServerClient | null> {
    console.log(`[MCP Proxy] getClient called for: "${serverName}"`);
    console.log(`[MCP Proxy] Available servers:`, Object.keys(this.mcpServers));

    const config = this.mcpServers[serverName];
    if (!config) {
      console.error(`[MCP Proxy] ❌ Server config not found: "${serverName}"`);
      console.error(
        `[MCP Proxy] Available configs:`,
        JSON.stringify(this.mcpServers, null, 2),
      );
      return null;
    }

    // Return cached client if it exists and is connected
    if (this.clients.has(serverName)) {
      const cached = this.clients.get(serverName)!;
      if (cached.getStatus() === "connected") {
        console.log(`[MCP Proxy] ✅ Using cached client for: "${serverName}"`);
        return cached;
      }
      console.log(`[MCP Proxy] Cached client not connected, reconnecting...`);
    }

    try {
      console.log(`[MCP Proxy] 🔌 Connecting to server: "${serverName}"`);
      console.log(`[MCP Proxy] Command: ${config.command}`);
      console.log(`[MCP Proxy] Args:`, config.args);
      console.log(`[MCP Proxy] Transport: ${config.transportType || "stdio"}`);

      const client = new McpServerClient(serverName, config);
      await client.connect();

      console.log(`[MCP Proxy] ✅ Connected to: "${serverName}"`);

      // Only cache stdio clients (HTTP/SSE are stateless per request)
      if (config.transportType === "stdio" || !config.url) {
        this.clients.set(serverName, client);
      }

      return client;
    } catch (error) {
      console.error(
        `[MCP Proxy] ❌ Failed to connect to "${serverName}":`,
        error,
      );
      console.error(
        `[MCP Proxy] Error details:`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  /**
   * Start HTTP server for MCP proxy access
   */
  startHTTP(port: number = 3000): void {
    this.httpPort = port;
    this.httpServer = this.app.listen(port, () => {
      console.log(`[MCP] HTTP server started on port ${port}`);
    });
  }

  /**
   * Stop HTTP server
   */
  stopHTTP(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
      console.log("[MCP] HTTP server stopped");
    }
  }

  /**
   * Disconnect all MCP clients
   */
  async disconnectAll(): Promise<void> {
    console.log("[MCP Proxy] Disconnecting all clients");
    const promises = Array.from(this.clients.values()).map((client) =>
      client.disconnect(),
    );
    await Promise.allSettled(promises);
    this.clients.clear();
  }

  /**
   * HTTP handler for /listTools
   */
  private async listToolsByHTTP(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const serverName = req.query.serverName as string;
      if (!serverName) {
        res.status(400).json({ error: "Missing serverName parameter" });
        return;
      }
      const result = await this.listTools({ serverName });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * HTTP handler for /callTool
   */
  private async callToolByHTTP(
    req: express.Request,
    res: express.Response,
  ): Promise<void> {
    try {
      const params: ToolCallParams = req.body;
      if (!params.serverName || !params.toolName) {
        res.status(400).json({ error: "Missing serverName or toolName" });
        return;
      }
      const result = await this.callTool(params);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get Express app instance (for custom routing)
   */
  getApp(): express.Express {
    return this.app;
  }
}

export { McpProxy };
