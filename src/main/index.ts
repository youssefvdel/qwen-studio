/**
 * Qwen Studio for Linux — Main Entry Point
 *
 * This is the Electron app bootstrap. It:
 * - Configures app flags (GPU, sandbox, etc.)
 * - Creates the main BrowserWindow loading chat.qwen.ai
 * - Registers IPC handlers for renderer ↔ main communication
 * - Sets up MCP server management
 * - Handles app lifecycle (quit, activate, deep links)
 * - Builds the application menu
 */

import {
  app,
  BrowserWindow,
  Menu,
  MenuItemConstructorOptions,
  dialog,
  nativeImage,
} from "electron";
import path from "path";
import fs from "fs";
import { autoUpdater } from "electron-updater";
import settings from "electron-settings";
import { McpProxy } from "../mcp/proxy.js";
import { adaptConfig } from "./mcp-config.js";
import {
  getPlatformName,
  ensureRuntimesExecutable,
  getBunPath,
} from "./runtime.js";
import { setupAutoUpdater } from "./updater.js";
import { createWindow } from "./window-manager.js";
import { registerIpcHandlers, MCP_CONFIG_KEY } from "./ipc-handlers.js";
import { logger } from "./logger.js";
import {
  configureApp,
  setupProtocolHandler,
  handleDeepLink,
  isQuitting,
  setQuitting,
} from "./app-lifecycle.js";
import {
  ensureSkillsDir,
  getAvailableSkills,
  injectSkill,
  openSkillsFolder,
  buildSkillsMenuTemplate,
} from "./skills-manager.js";
import type { McpConfig } from "../shared/types.js";

// === Constants ===
const APP_VERSION = app.getVersion();
const WEBVIEW_URL = "https://chat.qwen.ai";

/**
 * Compare two semver strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Used for update version checks without external dependencies.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

// === MCP Proxy Instance ===
// Singleton that manages all MCP server connections
const mcpServer = new McpProxy();

// === Window State ===
let mainWindow: BrowserWindow | null = null;

/** Queue for deep links received before window is ready */
export const deepLinkQueue: string[] = [];

/** Process queued deep links */
export function processDeepLinkQueue() {
  while (deepLinkQueue.length > 0 && mainWindow) {
    const url = deepLinkQueue.shift()!;
    console.log("[App] Processing queued deep link:", url);
    handleDeepLink(url, mainWindow);
  }
}

/** Getter for mainWindow — used by IPC handlers and skills module */
const getMainWindow = (): BrowserWindow | null => mainWindow;

/**
 * Load the app icon from bundled resources.
 * Tries multiple paths to support both dev and packaged modes.
 */
function getAppIcon(): Electron.NativeImage | undefined {
  const iconPaths = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "../../resources/icon.png"),
    path.join(process.cwd(), "resources/icon.png"),
  ];
  for (const p of iconPaths) {
    try {
      if (fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch { }
  }
  return undefined;
}

// === MCP Config Management ===

/**
 * Load MCP config from electron-settings.
 * If no config exists, creates default MCP servers (Desktop-Commander, Fetch, Filesystem, Sequential-Thinking).
 */
async function loadMcpConfig(): Promise<McpConfig> {
  try {
    if (await settings.has(MCP_CONFIG_KEY)) {
      const config = await settings.get(MCP_CONFIG_KEY);
      const parsed = (config as unknown as McpConfig) || {};
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    }
    console.log("[Config] No MCP config found, creating defaults...");
    const defaults = getDefaultMcpConfig();
    await settings.set(MCP_CONFIG_KEY, defaults as any);
    console.log(
      "[Config] ✅ Default MCP servers created:",
      Object.keys(defaults),
    );
    return defaults;
  } catch (error) {
    console.error("[Config] Failed to load MCP config:", error);
  }
  return {};
}

/**
 * Default MCP server configuration for first-time users.
 * All servers use the bundled bun runtime.
 */
function getDefaultMcpConfig(): McpConfig {
  const bunPath = getBunPath();
  const homeDir = require("os").homedir();
  return {
    "Desktop-Commander": {
      command: bunPath,
      args: ["x", "-y", "@wonderwhy-er/desktop-commander"],
      transportType: "stdio",
      env: {
        PUPPETEER_SKIP_DOWNLOAD: "true",
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "true",
      },
    },
    Fetch: {
      command: bunPath,
      args: ["x", "-y", "@modelcontextprotocol/server-fetch"],
      transportType: "stdio",
    },
    Filesystem: {
      command: bunPath,
      args: ["x", "-y", "@modelcontextprotocol/server-filesystem", homeDir],
      transportType: "stdio",
    },
    "Sequential-Thinking": {
      command: bunPath,
      args: ["x", "-y", "@modelcontextprotocol/server-sequential-thinking"],
      transportType: "stdio",
    },
  };
}

// === MCP Connect/Close ===

/** Connect to all configured MCP servers */
async function mcpClientConnect(): Promise<void> {
  try {
    const config = await loadMcpConfig();
    if (Object.keys(config).length > 0) {
      const adapted = adaptConfig(config);
      await mcpServer.setMCPServers(adapted);
      console.log("[IPC] MCP servers connected:", Object.keys(config));
    }
  } catch (error) {
    console.error("[IPC] mcpClientConnect error:", error);
  }
}

/** Disconnect all MCP servers */
async function mcpClientClose(): Promise<void> {
  await mcpServer.disconnectAll();
}

// === Application Menu ===

/**
 * Build and set the application menu.
 * Includes: App menu (update check, quit), Edit, View, and Skills submenu.
 */
async function setupMenu(): Promise<void> {
  const skillsItems = await buildSkillsMenuTemplate(getMainWindow);

  const template: MenuItemConstructorOptions[] = [
    {
      label: "Qwen",
      submenu: [
        {
          label: "Check for Updates",
          click: async () => {
            console.log("[Updater] Manual check triggered");
            if (!mainWindow) return;
            try {
              const updateInfo = await autoUpdater.checkForUpdates();
              if (updateInfo && updateInfo.updateInfo) {
                const currentVersion = app.getVersion();
                const latestVersion = updateInfo.updateInfo.version;
                // Only offer update if latest is newer (not a downgrade)
                if (compareVersions(latestVersion, currentVersion) > 0) {
                  const response = dialog.showMessageBoxSync(mainWindow, {
                    icon: getAppIcon(),
                    type: "info",
                    title: "Update Available",
                    message: `A new version (${latestVersion}) is available! Current version: ${currentVersion}.`,
                    buttons: ["Download", "Later"],
                    defaultId: 0,
                  });
                  if (response === 0) autoUpdater.downloadUpdate();
                } else {
                  dialog.showMessageBoxSync(mainWindow, {
                    icon: getAppIcon(),
                    type: "info",
                    title: "Up to Date",
                    message: `You are using the latest version (${currentVersion}).`,
                  });
                }
              } else {
                dialog.showMessageBoxSync(mainWindow, {
                  icon: getAppIcon(),
                  type: "info",
                  title: "Up to Date",
                  message: "You are using the latest version.",
                });
              }
            } catch (error) {
              console.error("[Updater] Check failed:", error);
              dialog.showMessageBoxSync(mainWindow, {
                icon: getAppIcon(),
                type: "error",
                title: "Update Check Failed",
                message: `Could not check for updates.\n\nError: ${error instanceof Error ? error.message : error}`,
              });
            }
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Skills",
      submenu: skillsItems,
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// === App Bootstrap ===

// Configure app flags BEFORE ready (GPU, sandbox, platform hints)
configureApp();

// Request single instance lock - prevent multiple app instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log("[App] Another instance is running, quitting...");
  app.quit();
  process.exit(0);
}

app.whenReady().then(async () => {
  logger.info('🚀 Starting Qwen Studio for Linux', { platform: getPlatformName(), version: APP_VERSION });

  try {
    // Make bundled runtimes executable (dev mode only)
    await ensureRuntimesExecutable();
    ensureSkillsDir();

    // Setup protocol handler (qwen:// deep links)
    setupProtocolHandler({
      onDeepLink: (url) => handleDeepLink(url, mainWindow),
      enqueueDeepLink: (url) => {
        console.log("[App] Enqueuing deep link:", url);
        deepLinkQueue.push(url);
      },
      onCreateWindow: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        } else {
          mainWindow = createWindow({
            onMcpClientConnect: mcpClientConnect,
            onOpenDevTool: (win) =>
              win.webContents.openDevTools({ mode: "right" }),
            setQuitting,
            isQuitting,
            onDeepLink: (url) => handleDeepLink(url, mainWindow),
          });
        }
      },
    });

    // Register IPC handlers (app management, MCP, theme, dialogs)
    registerIpcHandlers({
      getMainWindow,
      mcpServer,
      adaptConfig,
      settings,
      loadMcpConfig,
      getDefaultMcpConfig,
      APP_VERSION,
    });

    // Auto-updater (production only)
    if (app.isPackaged) {
      setupAutoUpdater();
    }

    // Create main window (loads chat.qwen.ai with MCP bridge)
    mainWindow = createWindow({
      onMcpClientConnect: mcpClientConnect,
      onOpenDevTool: (win) => win.webContents.openDevTools({ mode: "right" }),
      setQuitting,
      isQuitting,
      onDeepLink: (url) => handleDeepLink(url, mainWindow),
    });

    // Build menu after window creation (so skills menu can populate)
    await setupMenu();

    console.log("[App] ✅ Window created successfully");
    
    // Process any queued deep links
    processDeepLinkQueue();

    // Linux: Handle second instance (prevent multiple windows from qwen:// links)
    app.on("second-instance", (_event, commandLine) => {
      console.log("[App] Second instance detected, focusing existing window");
      
      // Check for qwen:// URL in command line
      const url = commandLine.find((arg) => arg.startsWith("qwen://"));
      if (url) {
        console.log("[App] Deep link in second instance:", url);
        // Queue it if window not ready, or handle immediately
        if (mainWindow) {
          handleDeepLink(url, mainWindow);
        } else {
          deepLinkQueue.push(url);
        }
      }
      
      // Focus existing window
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    // macOS: re-create window on dock click
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow({
          onMcpClientConnect: mcpClientConnect,
          onOpenDevTool: (win) =>
            win.webContents.openDevTools({ mode: "right" }),
          setQuitting,
          isQuitting,
          onDeepLink: (url) => handleDeepLink(url, mainWindow),
        });
      }
    });
  } catch (error) {
    console.error("[App] ❌ Failed to initialize:", error);
    // Retry after 1 second
    setTimeout(() => {
      mainWindow = createWindow({
        onMcpClientConnect: mcpClientConnect,
        onOpenDevTool: (win) => win.webContents.openDevTools({ mode: "right" }),
        setQuitting,
        isQuitting,
        onDeepLink: (url) => handleDeepLink(url, mainWindow),
      });
    }, 1000);
  }
});

// All windows closed — exit only if quitting, otherwise keep alive for tray
app.on("window-all-closed", () => {
  console.log("[App] All windows closed");
  if (isQuitting()) {
    console.log("[App] Quitting confirmed - exiting");
    app.exit(0);
  } else {
    console.log("[App] Keeping app alive for tray");
  }
});

// Before quit: disconnect all MCP servers
app.on("before-quit", () => {
  mcpServer.disconnectAll().catch(() => { });
});

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("[App] Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[App] Unhandled rejection:", reason);
});
