/**
 * MCP Server Client — single-server connection wrapper
 *
 * Wraps @modelcontextprotocol/sdk's Client for a single MCP server.
 * Handles connection lifecycle (connect/disconnect), tool listing, and tool calls.
 *
 * Supports three transport types:
 * - stdio: Local process (default) — connected via spawn, cached after first connect
 * - sse: Server-Sent Events — stateless, connects on each call
 * - httpStream: HTTP streaming — stateless, connects on each call
 *
 * Tools are cached after first listTools() call to avoid redundant API requests.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig, McpTool, ToolCallParams } from "../shared/types.js";

/**
 * MCP Client wrapper for a single server
 * Mirrors the @modelcontextprotocol/sdk Client API
 */
class McpServerClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private tools: McpTool[] | null = null;
  private status: "disconnected" | "connecting" | "connected" = "disconnected";

  constructor(
    private serverName: string,
    private config: McpServerConfig,
  ) {}

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.status === "connected" || this.status === "connecting") {
      return;
    }

    this.status = "connecting";

    try {
      this.client = new Client({ name: this.serverName, version: "1.0.0" }, {});

      this.transport = this.createTransport(this.config);
      await this.client.connect(this.transport, {
        timeout: this.config.timeout || 600000,
      });

      this.status = "connected";
      this.tools = null; // Reset cached tools
    } catch (error) {
      this.status = "disconnected";
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (this.transport) {
        await this.transport.close();
      }
    } catch (error) {
      console.error(`[MCP] Error disconnecting from ${this.serverName}:`, error);
    } finally {
      this.client = null;
      this.transport = null;
      this.tools = null;
      this.status = "disconnected";
    }
  }

  /**
   * List available tools from this server
   */
  async listTools(): Promise<{ tools: McpTool[] }> {
    if (!this.client || this.status !== "connected") {
      await this.connect();
    }

    if (this.tools) {
      return { tools: this.tools };
    }

    const response = await this.client!.listTools();
    this.tools = response.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as McpTool["inputSchema"],
    }));

    return { tools: this.tools };
  }

  /**
   * Call a tool on this server
   */
  async callTool(params: ToolCallParams): Promise<unknown> {
    if (!this.client || this.status !== "connected") {
      await this.connect();
    }

    return this.client!.callTool({
      name: params.toolName,
      arguments: params.toolArguments || {},
    });
  }

  /**
   * Get connection status
   */
  getStatus(): string {
    return this.status;
  }

  /**
   * Create the appropriate transport based on config
   */
  private createTransport(config: McpServerConfig): Transport {
    const transportType = config.transportType || "stdio";

    if (transportType === "httpStream") {
      if (!config.url) {
        throw new Error(`[MCP] URL required for httpStream transport: ${this.serverName}`);
      }
      return new StreamableHTTPClientTransport(new URL(config.url));
    }

    if (transportType === "sse") {
      if (!config.url) {
        throw new Error(`[MCP] URL required for SSE transport: ${this.serverName}`);
      }
      return new SSEClientTransport(new URL(config.url));
    }

    // Default: stdio
    return new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: {
        ...process.env,
        ...config.env,
      } as Record<string, string>,
      cwd: config.cwd,
    });
  }
}

export { McpServerClient };
