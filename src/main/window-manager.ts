/**
 * Window Manager — BrowserWindow creation + system tray
 *
 * Responsibilities:
 * - Create the main BrowserWindow that loads chat.qwen.ai
 * - Inject CSS to hide mobile download overlay
 * - Setup Linux system tray (show/hide/quit)
 * - Intercept auth links and open them in-app (for OAuth login flow)
 * - Handle close-to-tray behavior (respects isQuitting state)
 * - Provide 5-second fallback if ready-to-show never fires
 */

import {
  BrowserWindow,
  Tray,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  app,
  dialog,
  shell,
  session,
} from "electron";
import * as fs from "fs";
import * as path from "path";

const APP_VERSION = app.getVersion();
const USER_AGENT_SUFFIX = `AliDesktop(QWENCHAT/${APP_VERSION})`;
const WEBVIEW_URL = "https://chat.qwen.ai";

/**
 * Dependencies injected from index.ts to avoid circular dependencies.
 */
export interface WindowManagerDeps {
  onMcpClientConnect: () => Promise<void>;
  onOpenDevTool: (win: BrowserWindow) => void;
  setQuitting: (value: boolean) => void;
  isQuitting: () => boolean;
  onDeepLink: (url: string) => void;
}

/**
 * Find the preload script path.
 * Tries multiple locations to support both dev and packaged modes.
 */
function getPreloadPath(): string {
  const possiblePaths = [
    path.join(__dirname, "../preload/index.js"),
    path.join(__dirname, "preload/index.js"),
    path.join(process.cwd(), "out/preload/index.js"),
    path.join(process.cwd(), "src/preload/index.ts"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(`[Window] ✅ Found preload at: ${p}`);
      return p;
    } else {
      console.log(`[Window] ❌ Not found: ${p}`);
    }
  }

  console.warn("[Window] ⚠️ No preload found, using fallback");
  return possiblePaths[0];
}

/**
 * Create the main BrowserWindow loading chat.qwen.ai with MCP bridge.
 *
 * What it does:
 * 1. Finds the preload script (contextBridge for window.electronAPI)
 * 2. Creates BrowserWindow with context isolation enabled
 * 3. Sets custom User-Agent for desktop app detection by chat.qwen.ai
 * 4. Loads chat.qwen.ai
 * 5. Intercepts qwen:// deep links and auth URLs
 * 6. Injects CSS to hide mobile download overlay
 * 7. Connects MCP servers on page load
 * 8. Sets up close-to-tray behavior
 * 9. Creates system tray icon (Linux)
 * 10. Sets up F12/Ctrl+Shift+I DevTools shortcut
 */
export function createWindow(deps: WindowManagerDeps): BrowserWindow {
  console.log("[Window] Creating window...");
  console.log("[Window] __dirname:", __dirname);
  console.log("[Window] cwd:", process.cwd());
  console.log("[Window] app.getAppPath():", app.getAppPath());

  const preloadPath = getPreloadPath();
  console.log("[Window] Using preload path:", preloadPath);

  const mainWindow = new BrowserWindow({
    x: 100,
    y: 100,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Qwen",
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    autoHideMenuBar: false,
  });

  console.log("[Window] ✅ BrowserWindow created");

  // Show window when ready (with 5s timeout fallback)
  let shown = false;
  const showTimeout = setTimeout(() => {
    if (!shown && !mainWindow.isDestroyed()) {
      console.log("[Window] ⏰ ready-to-show timeout, forcing show");
      mainWindow.show();
    }
  }, 5000);

  mainWindow.once("ready-to-show", () => {
    clearTimeout(showTimeout);
    shown = true;
    console.log("[Window] 🎉 Ready to show");
    mainWindow.show();
  });

  mainWindow.on("show", () => {
    console.log("[Window] 👁️ Window shown");
  });

  // Set custom User-Agent for desktop app detection
  const chromeVersion = "131.0.0.0";
  const desktopUA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 ${USER_AGENT_SUFFIX}`;
  mainWindow.webContents.setUserAgent(desktopUA);
  console.log("[Window] User-Agent:", desktopUA);

  // Load chat.qwen.ai
  console.log("[Window] Loading:", WEBVIEW_URL);
  mainWindow.setMenuBarVisibility(true);
  mainWindow.setAutoHideMenuBar(false);
  mainWindow.loadURL(WEBVIEW_URL);

  // Intercept navigation to catch auth redirects and keep auth flows in-app
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("qwen://")) {
      event.preventDefault();
      console.log("[Window] Caught qwen:// redirect from webview:", url);
      deps.onDeepLink(url);
      return;
    }
    
    // Allow navigation to chat.qwen.ai and related domains
    const allowedHosts = [
      "chat.qwen.ai",
      "qwen.ai",
      "alibaba.com",
      "aliyun.com",
      "taobao.com",
      "tb.cn",
      "passport.alibaba.com",
      "login.taobao.com",
      "login.alibaba.com",
      "passport.aliyun.com",
      "auth.alipay.com",
    ];
    
    // Check for auth-related URLs that should stay in-app
    const authPatterns = ["login", "auth", "oauth", "passport", "sso", "signin", "authorize"];
    const isAuthUrl = authPatterns.some(p => url.toLowerCase().includes(p));
    
    try {
      const urlObj = new URL(url);
      const isAllowed = allowedHosts.some(host => 
        urlObj.hostname === host || urlObj.hostname.endsWith("." + host)
      );
      
      // Check if URL has qwen:// callback parameter
      const hasQwenCallback = url.includes("qwen://") || url.includes("callback=qwen");
      
      // Keep auth URLs in-app, block truly external navigation
      if (!isAllowed && !url.startsWith("data:")) {
        if (isAuthUrl || hasQwenCallback) {
          // Auth URL - prevent navigation, will be handled by setWindowOpenHandler
          console.log("[Window] Blocking external auth navigation:", url);
          event.preventDefault();
          // Open auth in a popup window instead
          const authWindow = new BrowserWindow({
            width: 500,
            height: 600,
            title: "Sign in to Qwen",
            parent: mainWindow,
            modal: false,
            webPreferences: {
              partition: "", // Same session as main window
            },
          });
          authWindow.loadURL(url);
          setupAuthWindowHandlers(authWindow, mainWindow, deps);
        } else {
          // Non-auth external link - open in system browser
          event.preventDefault();
          shell.openExternal(url);
        }
      } else if (hasQwenCallback && isAllowed) {
        // URL is on allowed host but has qwen:// callback - keep in main window
        console.log("[Window] Allowing auth URL with qwen callback:", url);
      }
    } catch (e) {
      // Invalid URL, allow navigation
    }
  });

  // Catch window.open with qwen:// (OAuth popups sometimes use this)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith("qwen://")) {
      console.log(
        "[Window] Caught qwen:// from setWindowOpenHandler:",
        details.url,
      );
      deps.onDeepLink(details.url);
      return { action: "deny" };
    }
    // Allow external links to open in system browser
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Log window events for debugging
  mainWindow.webContents.on("did-start-loading", () => {
    console.log("[Window] 🔄 Started loading...");
  });

  mainWindow.webContents.on("did-stop-loading", () => {
    console.log("[Window] ⏹️ Stopped loading");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[Window] ✅ Page finished loading");
    console.log("[Window] URL:", mainWindow.webContents.getURL());

    // Inject CSS to hide mobile download overlay
    mainWindow.webContents
      .insertCSS(
        `
        #low-version-browser,
        #downLoad_app,
        #get-the-app,
        .mobile-download-overlay {
          display: none !important;
        }
        #desktop-app,
        .desktop-container {
          display: block !important;
        }
      `,
      )
      .then(() => {
        console.log("[Window] ✅ Injected CSS to hide mobile overlay");
      })
      .catch((err) => {
        console.error("[Window] Failed to inject CSS:", err);
      });

    console.log("[IPC] Initializing MCP...");
    deps.onMcpClientConnect();
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[Window] ❌ Failed to load!");
      console.error("[Window] Error code:", errorCode);
      console.error("[Window] Error:", errorDescription);
      console.error("[Window] URL:", validatedURL);
    },
  );

  // Close event: hide to tray instead of quitting
  mainWindow.on("close", (event) => {
    if (!deps.isQuitting()) {
      console.log("[Window] Close event fired - hiding to tray");
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle popup windows - keep auth flows in-app, open other links externally
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url;
    
    // If it's a qwen:// deep link, handle it directly
    if (url.startsWith("qwen://")) {
      console.log("[Window] Caught qwen:// from setWindowOpenHandler:", url);
      deps.onDeepLink(url);
      return { action: "deny" };
    }

    // Check if it's an auth-related URL or has qwen callback
    const isAuthUrl =
      url.includes("login") ||
      url.includes("auth") ||
      url.includes("oauth") ||
      url.includes("account") ||
      url.includes("passport") ||
      url.includes("aliyun") ||
      url.includes("taobao") ||
      url.includes("alibaba") ||
      url.includes("qwen://") ||
      url.includes("callback=qwen");

    // For auth URLs, open in an in-app window using the SAME session
    // This ensures cookies are shared between auth window and main window
    if (isAuthUrl) {
      console.log("[Window] Opening auth URL in-app:", url);
      
      const authWindow = new BrowserWindow({
        width: 500,
        height: 600,
        title: "Sign in to Qwen",
        parent: mainWindow,
        modal: false,
        webPreferences: {
          // Use SAME session as main window - this is KEY for cookie sharing
          partition: "",
        },
      });

      authWindow.loadURL(url);
      setupAuthWindowHandlers(authWindow, mainWindow, deps);

      return { action: "deny" };
    }

    // For all other external links, open in system browser
    shell.openExternal(url);
    return { action: "deny" };
  });

  // DevTools shortcut
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      input.key === "F12" ||
      (input.control && input.shift && input.key === "I")
    ) {
      deps.onOpenDevTool(mainWindow);
      event.preventDefault();
    }
  });

  // Linux: setup system tray
  if (process.platform === "linux") {
    setupSystemTray(mainWindow, deps);
  }

  return mainWindow;
}

/**
 * Setup handlers for auth popup window
 */
function setupAuthWindowHandlers(
  authWindow: BrowserWindow,
  mainWindow: BrowserWindow,
  deps: WindowManagerDeps,
): void {
  // Catch qwen:// redirects in the auth window
  authWindow.webContents.on("will-navigate", (event, navUrl) => {
    if (navUrl.startsWith("qwen://")) {
      event.preventDefault();
      console.log("[Window] Auth window caught qwen:// redirect:", navUrl);
      deps.onDeepLink(navUrl);
      authWindow.close();
    }
  });

  // Also catch will-redirect for 302 redirects to qwen://
  authWindow.webContents.on("will-redirect", (event, navUrl) => {
    if (navUrl.startsWith("qwen://")) {
      event.preventDefault();
      console.log("[Window] Auth window caught qwen:// redirect (302):", navUrl);
      deps.onDeepLink(navUrl);
      authWindow.close();
    }
  });

  // Auto-close auth window if it navigates back to chat.qwen.ai (successful login)
  authWindow.webContents.on("did-navigate", (_event, navUrl) => {
    if (navUrl.includes("chat.qwen.ai")) {
      console.log("[Window] Auth successful, closing auth window");
      authWindow.close();
      // Focus main window
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  });

  // Clean up auth window when closed
  authWindow.on("closed", () => {
    console.log("[Window] Auth window closed");
  });
}

/**
 * Get icon path by trying multiple locations
 */
function getIconPath(): string | null {
  const iconPaths = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(__dirname, "../../resources/icon.png"),
    path.join(process.cwd(), "resources/icon.png"),
  ];

  for (const p of iconPaths) {
    if (fs.existsSync(p)) {
      console.log(`[Tray] ✅ Found icon at: ${p}`);
      return p;
    }
  }

  console.error("[Tray] ❌ No icon found");
  return null;
}

/**
 * Setup Linux system tray.
 */
function setupSystemTray(
  mainWindow: BrowserWindow,
  deps: WindowManagerDeps,
): Tray | null {
  console.log("[Tray] Setting up system tray...");

  const iconPath = getIconPath();
  if (!iconPath) return null;

  try {
    const trayIcon = nativeImage.createFromPath(iconPath);
    const resizedIcon = trayIcon.resize({ width: 16, height: 16 });

    const appTray = new Tray(resizedIcon);
    appTray.setToolTip("Qwen Studio");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Qwen",
        click: () => {
          if (mainWindow.isMinimized()) {
            mainWindow.restore();
          }
          mainWindow.show();
          mainWindow.focus();
        },
      },
      {
        label: "Hide Qwen",
        click: () => {
          mainWindow.hide();
        },
      },
      { type: "separator" },
      {
        label: "Toggle DevTools",
        click: () => {
          deps.onOpenDevTool(mainWindow);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          deps.setQuitting(true);
          appTray.destroy();
          app.quit();
        },
      },
    ]);

    appTray.setContextMenu(contextMenu);

    appTray.on("click", () => {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    appTray.on("double-click", () => {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    });

    console.log("[Tray] ✅ System tray setup complete");
    return appTray;
  } catch (error) {
    console.error("[Tray] ❌ Failed to setup system tray:", error);
    return null;
  }
}
