/**
 * Shared TypeScript types — used across main, preload, and MCP modules
 *
 * Defines the shape of:
 * - MCP configuration (McpServerConfig, McpConfig)
 * - Tool definitions and call parameters (McpTool, ToolCallParams)
 * - The Electron API exposed to the renderer (ElectronAPI)
 * - Dialog options, file picker results, runtime paths
 * - Event types for the main ↔ renderer event system
 */

/**
 * MCP Server Configuration
 * Matches the format used by the official Qwen desktop app
 */
export interface McpServerConfig {
  /** Command to run (e.g., "bun", "uvx", or full path) */
  command: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Transport type for this server */
  transportType?: "stdio" | "sse" | "httpStream";
  /** URL for SSE or HTTP transports */
  url?: string;
  /** Working directory for the command */
  cwd?: string;
  /** Timeout in milliseconds (default: 600000) */
  timeout?: number;
  /** Server source: "official" for built-in, "user" for custom */
  source?: "official" | "user";
  /** Unique identifier for the server */
  identifier?: string;
  /** Where the server came from (e.g., "modelscope", "builtin") */
  from?: string;
  /** Package identifier */
  fromId?: string;
  /** Whether server is disabled */
  disabled?: boolean;
}

/**
 * Full MCP Configuration
 * Map of server name to server config
 */
export type McpConfig = Record<string, McpServerConfig>;

/**
 * Tool definition returned by MCP servers
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call parameters
 */
export interface ToolCallParams {
  serverName: string;
  toolName: string;
  toolArguments?: Record<string, unknown>;
}

/**
 * Electron API exposed via preload
 * This is what chat.qwen.ai expects when running in the desktop app
 */
export interface ElectronAPI {
  /** Path to the preload script (used by webview) */
  PRELOAD_FILE_PATH: string;

  // === App Management ===
  open_devtool: () => Promise<void>;
  toggle_hidden_devtools: () => Promise<void>;
  get_app_version: () => Promise<string>;
  get_platform_info: () => Promise<{ platform: string; arch: string }>;
  open_external_link: (url: string) => Promise<void>;
  show_native_dialog: (options: { title?: string; message: string }) => Promise<void>;
  request_file_access: (
    purpose: string,
    returnFile?: boolean,
  ) => Promise<{ filePath: string; file?: string }>;

  // === MCP Methods ===
  /** Connect to MCP servers (initializes all configured servers) */
  mcp_client_connect: () => Promise<void>;
  /** Close all MCP connections */
  mcp_client_close: () => Promise<void>;
  /** List available tools for a specific server */
  mcp_client_tool_list: (serverName: string) => Promise<{ tools: McpTool[] }>;
  /** Call an MCP tool */
  mcp_client_tool_call: (params: ToolCallParams) => Promise<unknown>;
  /** Get current MCP server configuration */
  mcp_client_get_config: () => Promise<McpConfig>;
  /** Update MCP server configuration */
  mcp_client_update_config: (config: McpConfig) => Promise<McpConfig>;

  // === Theme & Localization ===
  switch_theme: (theme: "light" | "dark") => Promise<void>;
  switch_ln: (language: string) => Promise<void>;
  update_title_bar_for_system_theme: (isDark: boolean) => Promise<void>;

  // === Event System ===
  on_event: (type: string, callback: (payload: unknown) => void) => void;
  send_event: (data: { type: string; payload?: unknown }) => void;
}

/**
 * Dialog options for native dialogs
 */
export interface DialogOptions {
  title?: string;
  message: string;
  type?: "info" | "warning" | "error";
  buttons?: string[];
  defaultId?: number;
}

/**
 * File picker result
 */
export interface FilePickerResult {
  filePath: string;
  file?: string; // Content if returnFile is true
}

/**
 * Platform-specific paths for bundled runtimes
 */
export interface RuntimePaths {
  bun: string;
  uv: string;
  uvx: string;
}

/**
 * Event types for the event system
 */
export enum AppEventType {
  MCP_SERVER_ADDED = "mcp_server_added",
  MCP_SERVER_REMOVED = "mcp_server_removed",
  MCP_SERVER_ERROR = "mcp_server_error",
  MCP_TOOL_CALLED = "mcp_tool_called",
  THEME_CHANGED = "theme_changed",
  LANGUAGE_CHANGED = "language_changed",
  WINDOW_FOCUS = "window_focus",
  WEBVIEW_READY = "webview_ready",
}
