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

  ipcMain.handle(
    "get_app_version",
    async (): Promise<string> => deps.APP_VERSION,
  );

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

  ipcMain.handle(
    "open_external_link",
    async (_event, url: string): Promise<void> => {
      const { shell } = await import("electron");
      await shell.openExternal(url);
    },
  );

  ipcMain.handle(
    "show_native_dialog",
    async (_event, options: DialogOptions): Promise<void> => {
      const win = deps.getMainWindow();
      await dialog.showMessageBox(win!, {
        title: options.title || "Qwen",
        message: options.message,
        type: options.type || "info",
        buttons: options.buttons || ["OK"],
        defaultId: options.defaultId || 0,
      });
    },
  );

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
      const config = await deps.loadMcpConfig();
      if (Object.keys(config).length > 0) {
        const adapted = deps.adaptConfig(config);
        await deps.mcpServer.setMCPServers(adapted);
        console.log("[IPC] MCP servers connected:", Object.keys(config));
      }
    } catch (error) {
      console.error("[IPC] mcpClientConnect error:", error);
    }
  });

  ipcMain.handle("mcp_client_close", async (): Promise<void> => {
    await deps.mcpServer.disconnectAll();
  });

  ipcMain.handle("mcp_client_tool_list", async (_event, serverName: string) => {
    try {
      console.log(`[IPC] Listing tools for server: "${serverName}"`);
      console.log(
        "[IPC] Available servers:",
        Object.keys(deps.mcpServer.getMCPServers()),
      );
      const list = await deps.mcpServer.listTools({ serverName });
      console.log(`[IPC] Tools for "${serverName}":`, list);
      return list;
    } catch (error) {
      console.error(
        `[IPC] mcpClientToolList error for "${serverName}":`,
        error,
      );
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
    return deps.mcpServer.getMCPServers();
  });

  ipcMain.handle(
    "mcp_client_update_config",
    async (_event, config: McpConfig): Promise<McpConfig> => {
      try {
        console.log(
          "[IPC] Updating MCP config:",
          JSON.stringify(config, null, 2),
        );
        console.log("[IPC] Config keys:", Object.keys(config));

        for (const [name, serverConfig] of Object.entries(config)) {
          console.log(`[IPC] Server "${name}":`, {
            command: serverConfig.command,
            args: serverConfig.args,
            transportType: serverConfig.transportType,
          });
        }

        const adapted = deps.adaptConfig(config);
        console.log("[IPC] Adapted config:", JSON.stringify(adapted, null, 2));

        await deps.mcpServer.setMCPServers(adapted);
        await deps.settings.set(MCP_CONFIG_KEY, config as any);
        console.log("[IPC] MCP config saved successfully");
        return deps.mcpServer.getMCPServers();
      } catch (error) {
        console.error("[IPC] mcpClientUpdateConfig error:", error);
        throw error;
      }
    },
  );

  // === Theme & Localization ===

  ipcMain.handle(
    "switch_theme",
    async (_event, theme: "light" | "dark"): Promise<void> => {
      await deps.settings.set("app_theme", theme);
      const win = deps.getMainWindow();
      win?.webContents.send("event_from_main", {
        type: "theme_changed",
        payload: theme,
      });
    },
  );

  ipcMain.handle(
    "switch_ln",
    async (_event, language: string): Promise<void> => {
      await deps.settings.set("app_language", language);
      const win = deps.getMainWindow();
      win?.webContents.send("event_from_main", {
        type: "language_changed",
        payload: language,
      });
    },
  );

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
