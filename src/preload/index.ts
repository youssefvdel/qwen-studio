/**
 * Preload Script — contextBridge between main process and renderer (chat.qwen.ai)
 *
 * This script runs in the webview's preload context (before page scripts).
 * It exposes `window.electronAPI` and `window.electron` to the renderer via
 * contextBridge, enabling the web page to:
 * - Call MCP tools (list, call, config)
 * - Open native dialogs and file pickers
 * - Switch themes and languages
 * - Send/receive custom events
 *
 * Security: contextIsolation is enabled, so the renderer has no direct Node.js access.
 * All communication goes through these typed IPC channels.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI, McpConfig, ToolCallParams, DialogOptions } from "../shared/types.js";

/**
 * Simple event emitter for the renderer
 */
class EventEmitter {
  private listeners: Record<string, Array<(payload: unknown) => void>> = {};

  on(eventName: string, listener: (payload: unknown) => void) {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(listener);
  }

  emit(eventName: string, payload: unknown) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      listeners.forEach(listener => listener(payload));
    }
  }
}

const events = new EventEmitter();

/**
 * API object exposed as window.electronAPI
 * This is what chat.qwen.ai expects when running in the desktop app
 */
const electronAPI: ElectronAPI = {
  // Preload file path (used by webview to load its own preload)
  PRELOAD_FILE_PATH: "", // Will be set dynamically

  // === App Management ===
  open_devtool: () => ipcRenderer.invoke("open_devtool"),
  toggle_hidden_devtools: () => ipcRenderer.invoke("toggle_hidden_devtools"),
  get_app_version: () => ipcRenderer.invoke("get_app_version"),
  get_platform_info: () => ipcRenderer.invoke("get_platform_info"),
  open_external_link: (url: string) => ipcRenderer.invoke("open_external_link", url),
  show_native_dialog: (options: DialogOptions) => ipcRenderer.invoke("show_native_dialog", options),
  request_file_access: (purpose: string, returnFile?: boolean) =>
    ipcRenderer.invoke("request_file_access", purpose, returnFile),

  // === MCP Methods ===
  mcp_client_connect: () => ipcRenderer.invoke("mcp_client_connect"),
  mcp_client_close: () => ipcRenderer.invoke("mcp_client_close"),
  mcp_client_tool_list: (serverName: string) =>
    ipcRenderer.invoke("mcp_client_tool_list", serverName),
  mcp_client_tool_call: (params: ToolCallParams) =>
    ipcRenderer.invoke("mcp_client_tool_call", params),
  mcp_client_get_config: () => ipcRenderer.invoke("mcp_client_get_config"),
  mcp_client_update_config: (config: McpConfig) =>
    ipcRenderer.invoke("mcp_client_update_config", config),

  // === Theme & Localization ===
  switch_theme: (theme: "light" | "dark") => ipcRenderer.invoke("switch_theme", theme),
  switch_ln: (language: string) => ipcRenderer.invoke("switch_ln", language),
  update_title_bar_for_system_theme: (isDark: boolean) =>
    ipcRenderer.invoke("update_title_bar_for_system_theme", isDark),

  // === Event System ===
  on_event: (type: string, callback: (payload: unknown) => void) => {
    events.on(type, callback);
  },
  send_event: (data: { type: string; payload?: unknown }) => {
    ipcRenderer.send("event_to_main", data);
  },
};

/**
 * Listen for events from main process
 */
ipcRenderer.on("event_from_main", (_, { type, payload }) => {
  events.emit(type, payload);
});

/**
 * Expose APIs to renderer
 */
console.log("[Preload] 🔍 Preload script executing...");
console.log("[Preload] contextIsolated:", process.contextIsolated);

if (process.contextIsolated) {
  try {
    console.log("[Preload] 🔧 Using contextBridge (contextIsolated=true)");
    // Expose electron API from @electron-toolkit/preload
    // This is the standard electron API (ipcRenderer, etc.)
    contextBridge.exposeInMainWorld("electron", {
      ipcRenderer: {
        send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, func: (...args: unknown[]) => void) => {
          ipcRenderer.on(channel, (_, ...args) => func(...args));
        },
      },
    });

    // Expose our custom API
    contextBridge.exposeInMainWorld("electronAPI", electronAPI);
    console.log("[Preload] ✅ electronAPI exposed via contextBridge");
  } catch (error) {
    console.error("[Preload] ❌ Failed to expose APIs via contextBridge:", error);
  }
} else {
  console.log("[Preload] 🔧 Direct assignment (contextIsolated=false)");
  // Fallback for non-context-isolated environments
  (window as any).electron = {
    ipcRenderer: {
      send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
      invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
      on: (channel: string, func: (...args: unknown[]) => void) => {
        ipcRenderer.on(channel, (_, ...args) => func(...args));
      },
    },
  };
  (window as any).electronAPI = electronAPI;
  console.log("[Preload] ✅ electronAPI exposed directly");
}
