/**
 * IPC Handlers — all ipcMain handlers for renderer ↔ main communication
 *
 * Registered via registerIpcHandlers(). Uses dependency injection (IpcHandlerDeps)
 * so this module has no direct references to global state.
 *
 * Handler categories:
 * - App Management: version, platform, devtools, dialogs, file picker
 * - MCP: connect/close/listTools/callTool/getConfig/updateConfig
 * - Theme & Localization: switch theme, switch language, system theme sync
 * - Event Forwarding: renderer → main → renderer event relay
 */

import { ipcMain, dialog, BrowserWindow } from "electron";
import type { McpProxy } from "../mcp/proxy.js";
import type { McpConfig, DialogOptions } from "../shared/types.js";

/** Settings key for MCP config in electron-settings */
export const MCP_CONFIG_KEY = "mcpServers";

/**
 * Dependencies injected from index.ts. This module has no direct access to
 * global state — everything comes through this interface.
 */
export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null;
  mcpServer: McpProxy;
  adaptConfig: (config: McpConfig) => McpConfig;
  settings: typeof import("electron-settings");
  loadMcpConfig: () => Promise<McpConfig>;
  getDefaultMcpConfig: () => McpConfig;
  APP_VERSION: string;
}

/**
 * Register all IPC main handlers.
 */
export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  // === App Management ===

  ipcMain.handle("get_app_version", async (): Promise<string> => deps.APP_VERSION);

  ipcMain.handle(
    "get_platform_info",
    async (): Promise<{ platform: string; arch: string }> => ({
      platform: process.platform,
      arch: process.arch,
    }),
  );

  ipcMain.handle("open_devtool", async (): Promise<void> => {
    const win = deps.getMainWindow();
    win?.webContents.openDevTools({ mode: "right" });
  });

  ipcMain.handle("toggle_hidden_devtools", async (): Promise<void> => {
    const win = deps.getMainWindow();
    if (!win) return;
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  ipcMain.handle("open_external_link", async (_event, url: string): Promise<void> => {
    const { shell } = await import("electron");
    await shell.openExternal(url);
  });

  ipcMain.handle("show_native_dialog", async (_event, options: DialogOptions): Promise<void> => {
    const win = deps.getMainWindow();
    await dialog.showMessageBox(win!, {
      title: options.title || "Qwen",
      message: options.message,
      type: options.type || "info",
      buttons: options.buttons || ["OK"],
      defaultId: options.defaultId || 0,
    });
  });

  ipcMain.handle(
    "request_file_access",
    async (
      _event,
      purpose: string,
      returnFile?: boolean,
    ): Promise<{ filePath: string; file?: string }> => {
      const win = deps.getMainWindow();
      const { filePaths } = await dialog.showOpenDialog(win!, {
        properties: ["openFile"],
        title: purpose,
      });

      if (!filePaths || filePaths.length === 0) {
        return { filePath: "" };
      }

      const result: { filePath: string; file?: string } = {
        filePath: filePaths[0],
      };
      if (returnFile) {
        const fs = await import("fs");
        result.file = await fs.promises.readFile(filePaths[0], "utf-8");
      }
      return result;
    },
  );

  // === MCP Handlers ===

  ipcMain.handle("mcp_client_connect", async (): Promise<void> => {
    try {
      console.log("\n========== [MCP CONNECT] START ==========");
      console.log("[MCP CONNECT] Loading config...");
      const config = await deps.loadMcpConfig();
      console.log("[MCP CONNECT] Loaded config keys:", Object.keys(config));

      if (Object.keys(config).length > 0) {
        console.log("[MCP CONNECT] Calling adaptConfig...");
        const adapted = deps.adaptConfig(config);
        console.log("[MCP CONNECT] Adapted config:", JSON.stringify(adapted, null, 2));

        console.log("[MCP CONNECT] Calling setMCPServers...");
        await deps.mcpServer.setMCPServers(adapted);
        console.log("[MCP CONNECT] setMCPServers completed");
        console.log("[MCP CONNECT] MCP servers connected:", Object.keys(config));

        // Notify UI to refresh MCP server list
        console.log("[MCP CONNECT] Sending mcp_servers_changed event...");
        const win = deps.getMainWindow();
        if (win) {
          win.webContents.send("event_from_main", {
            type: "mcp_servers_changed",
            payload: { servers: Object.keys(config) },
          });
          console.log("[MCP CONNECT] Event sent to UI");
        } else {
          console.log("[MCP CONNECT] ⚠️ No main window found!");
        }
      } else {
        console.log("[MCP CONNECT] ⚠️ No config found");
      }
      console.log("========== [MCP CONNECT] END ==========\n");
    } catch (error) {
      console.error("\n========== [MCP CONNECT] ERROR ==========");
      console.error("[MCP CONNECT] Error:", error);
      console.error("===========================================\n");
    }
  });

  ipcMain.handle("mcp_client_close", async (): Promise<void> => {
    await deps.mcpServer.disconnectAll();
  });

  ipcMain.handle("mcp_client_tool_list", async (_event, serverName: string) => {
    try {
      console.log("\n========== [MCP TOOL LIST] START ==========");
      console.log(`[MCP TOOL LIST] Requested server: "${serverName}"`);
      const servers = deps.mcpServer.getMCPServers();
      console.log("[MCP TOOL LIST] Available servers:", Object.keys(servers));
      console.log("[MCP TOOL LIST] Server config for", serverName, ":", servers[serverName]);

      console.log("\n[MCP TOOL LIST] Calling listTools...");
      const list = await deps.mcpServer.listTools({ serverName });
      console.log(`[MCP TOOL LIST] Tools returned:`, list?.tools?.length || 0, "tools");
      console.log("========== [MCP TOOL LIST] END ==========\n");
      return list;
    } catch (error) {
      console.error("\n========== [MCP TOOL LIST] ERROR ==========");
      console.error(`[MCP TOOL LIST] Error for "${serverName}":`, error);
      console.error("===========================================\n");
      throw error;
    }
  });

  ipcMain.handle("mcp_client_tool_call", async (_event, params: any) => {
    try {
      const result = await deps.mcpServer.callTool(params);
      return result;
    } catch (error) {
      console.error("[IPC] mcpClientToolCall error:", error);
      throw error;
    }
  });

  ipcMain.handle("mcp_client_get_config", async (): Promise<McpConfig> => {
    console.log("\n[MCP GET CONFIG] Called");
    const result = deps.mcpServer.getMCPServers();
    console.log("[MCP GET CONFIG] Returning servers:", Object.keys(result));
    return result;
  });

  ipcMain.handle(
    "mcp_client_update_config",
    async (_event, config: McpConfig): Promise<McpConfig> => {
      try {
        console.log("\n========== [MCP UPDATE CONFIG] START ==========");
        console.log("[MCP UPDATE] Received config from UI:", JSON.stringify(config, null, 2));
        console.log("[MCP UPDATE] Config keys:", Object.keys(config));

        for (const [name, serverConfig] of Object.entries(config)) {
          console.log(`\n[MCP UPDATE] Server "${name}":`, {
            command: serverConfig.command,
            args: serverConfig.args,
            cwd: serverConfig.cwd,
            env: serverConfig.env ? Object.keys(serverConfig.env) : "none",
            transportType: serverConfig.transportType,
          });
        }

        console.log("\n[MCP UPDATE] Calling adaptConfig...");
        const adapted = deps.adaptConfig(config);
        console.log("[MCP UPDATE] Adapted config:", JSON.stringify(adapted, null, 2));

        console.log("\n[MCP UPDATE] Calling setMCPServers...");
        await deps.mcpServer.setMCPServers(adapted);
        console.log("[MCP UPDATE] setMCPServers completed");

        console.log("\n[MCP UPDATE] Saving to settings...");
        await deps.settings.set(MCP_CONFIG_KEY, config as any);
        console.log("[MCP UPDATE] Settings saved");

        console.log("\n[MCP UPDATE] Getting servers...");
        const result = deps.mcpServer.getMCPServers();
        console.log("[MCP UPDATE] getMCPServers returned:", Object.keys(result));

        // Notify UI to refresh MCP server list
        console.log("\n[MCP UPDATE] Sending mcp_servers_changed event to UI...");
        const win = deps.getMainWindow();
        if (win) {
          win.webContents.send("event_from_main", {
            type: "mcp_servers_changed",
            payload: { servers: Object.keys(config) },
          });
          console.log("[MCP UPDATE] Event sent to UI");
        } else {
          console.log("[MCP UPDATE] ⚠️ No main window found!");
        }

        console.log("\n========== [MCP UPDATE CONFIG] END ==========\n");
        return result;
      } catch (error) {
        console.error("\n========== [MCP UPDATE CONFIG] ERROR ==========");
        console.error("[MCP UPDATE] Error:", error);
        console.error("===========================================\n");
        throw error;
      }
    },
  );

  // === Theme & Localization ===

  ipcMain.handle("switch_theme", async (_event, theme: "light" | "dark"): Promise<void> => {
    // Theme is managed by account settings, don't persist locally
    const win = deps.getMainWindow();
    win?.webContents.send("event_from_main", {
      type: "theme_changed",
      payload: theme,
    });
  });

  ipcMain.handle("switch_ln", async (_event, language: string): Promise<void> => {
    await deps.settings.set("app_language", language);
    const win = deps.getMainWindow();
    win?.webContents.send("event_from_main", {
      type: "language_changed",
      payload: language,
    });
  });

  ipcMain.handle(
    "update_title_bar_for_system_theme",
    async (_event, isDark: boolean): Promise<void> => {
      const win = deps.getMainWindow();
      if (win) {
        win.webContents.send("event_from_main", {
          type: "system_theme_changed",
          payload: isDark,
        });
      }
    },
  );

  // === Event Forwarding ===

  ipcMain.on("event_to_main", (_event, data) => {
    const win = deps.getMainWindow();
    win?.webContents.send("event_from_main", data);
  });
}
