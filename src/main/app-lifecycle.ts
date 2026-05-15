/**
 * App Lifecycle — protocol handler, deep links, quit state, app flags
 *
 * Responsibilities:
 * - configureApp() — Sets all app.commandLine flags (GPU, sandbox, platform hints).
 *   Called BEFORE app.whenReady() so flags take effect.
 * - setupProtocolHandler() — Registers qwen:// as a custom protocol handler.
 *   On Linux AppImage, patches the auto-generated .desktop file to add the MIME type.
 * - handleDeepLink() — Parses qwen://open?token=xxx URLs and sends the auth token
 *   to the renderer via IPC event.
 * - isQuitting/setQuitting — Global quit state used by window-manager for
 *   close-to-tray behavior vs actual quit.
 */

import { app, BrowserWindow, dialog } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import * as http from "http";

// Local HTTP server for OAuth callback fallback (unused, kept for future)
let authCallbackServer: http.Server | null = null;
const AUTH_CALLBACK_PORT = 14920;

// === Quit State ===
/** Tracks whether the app is intentionally quitting (tray Quit) vs hiding to tray. */
let _isQuitting = false;

/** Check if app is in quit state. Used by window-manager close handler. */
export function isQuitting(): boolean {
  return _isQuitting;
}

/** Set the quit state. Called from tray "Quit" menu item. */
export function setQuitting(value: boolean): void {
  _isQuitting = value;
}

/**
 * Register qwen:// protocol handler for AppImage on Linux.
 * AppImage creates its .desktop file dynamically on mount, so we
 * retry registration after a delay to ensure the file exists.
 */
function registerAppImageProtocolHandler(): void {
  if (process.platform !== "linux") return;
  if (!app.isPackaged) {
    console.log("[Protocol] Skipping registration in dev mode");
    return;
  }

  const desktopDir = path.join(os.homedir(), ".local", "share", "applications");
  console.log("[Protocol] Starting registration...");

  function tryRegister(): boolean {
    try {
      const files = fs.readdirSync(desktopDir);
      console.log(
        "[Protocol] Found desktop files:",
        files.filter(f => f.toLowerCase().includes("qwen")),
      );

      const appimageDesktop = files.find(
        f => f.toLowerCase().includes("qwen") || f.toLowerCase().includes("qwen-studio"),
      );

      if (!appimageDesktop) {
        console.log("[Protocol] No .desktop file found yet");
        return false;
      }

      const desktopFile = path.join(desktopDir, appimageDesktop);
      console.log("[Protocol] Found:", desktopFile);

      let content = fs.readFileSync(desktopFile, "utf-8");
      console.log("[Protocol] Current MimeType:", content.match(/MimeType=.*/)?.[0] || "none");

      if (content.includes("x-scheme-handler/qwen")) {
        console.log("[Protocol] Already registered");
        return true;
      }

      if (content.includes("MimeType=")) {
        content = content.replace(/(MimeType=[^;]*);/, "$1;x-scheme-handler/qwen;");
      } else {
        content += "\nMimeType=x-scheme-handler/qwen;\n";
      }

      fs.writeFileSync(desktopFile, content);
      console.log("[Protocol] Patched:", desktopFile);

      execSync(`xdg-mime default ${appimageDesktop} x-scheme-handler/qwen`, {
        stdio: "pipe",
      });
      console.log("[Protocol] xdg-mime registered");

      execSync(`update-desktop-database ${desktopDir}`, { stdio: "pipe" });
      console.log("[Protocol] Desktop database updated");

      const handler = execSync(`xdg-mime query default x-scheme-handler/qwen`, {
        stdio: "pipe",
      })
        .toString()
        .trim();
      console.log("[Protocol] Verified handler:", handler);
      return true;
    } catch (error) {
      console.error("[Protocol] Registration attempt failed:", error);
      return false;
    }
  }

  // Try immediately, then retry every 2 seconds for 10 seconds
  if (tryRegister()) return;

  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    console.log(`[Protocol] Retry attempt ${attempts}/5...`);
    if (tryRegister() || attempts >= 5) {
      clearInterval(interval);
      if (attempts >= 5) {
        console.log("[Protocol] Giving up after 5 attempts");
      }
    }
  }, 2000);
}

/**
 * Configure app command-line flags.
 * Call this ONCE at startup before app.whenReady().
 * Replaces module-level side effects.
 */
export function configureApp(): void {
  // Wayland/X11 platform support (Fedora KDE defaults to Wayland)
  app.commandLine.appendSwitch("enable-features", "UseOzonePlatform");
  app.commandLine.appendSwitch("ozone-platform-hint", "x11");

  // Disable GPU acceleration to prevent crashes on Linux
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-dev-shm-usage");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("use-gl", "swiftshader");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");

  // Debug flags - Enable remote debugging for chrome-devtools-mcp
  app.commandLine.appendSwitch("enable-logging");
  app.commandLine.appendSwitch("v", "1");
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

/**
 * Handle qwen:// deep link URLs.
 * Windows app uses this exact pattern - validate and send "set_cookie" event.
 */
export function handleDeepLink(url: string, mainWindow: BrowserWindow | null): void {
  console.log("[DeepLink] Handling URL:", url);

  // Validate URL format (same as Windows app)
  if (!validateDeepLink(url)) {
    console.log("[DeepLink] ❌ Invalid deep link format");
    return;
  }

  const urlObj = new URL(url);
  const action = urlObj.hostname; // "open"
  const token = urlObj.searchParams.get("token");

  console.log("[DeepLink] Action:", action, "Token length:", token?.length);

  if (action === "open" && token) {
    console.log("[DeepLink] ✅ Valid auth deep link received");

    // Focus existing window
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // Send set_cookie event (Windows app pattern)
      console.log("[DeepLink] Sending set_cookie event to renderer");
      mainWindow.webContents.send("event_from_main", {
        type: "set_cookie",
        payload: token,
      });

      console.log("[DeepLink] ✅ Token sent to renderer");
    } else {
      console.log("[DeepLink] ❌ No window available");
    }
  }
}

/**
 * Validate deep link format (same as Windows/macOS app).
 * Expected: qwen://open?token=xxx
 */
function validateDeepLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "qwen:" &&
      ["open"].includes(parsed.hostname) &&
      (parsed.hostname !== "open" || !!parsed.searchParams.get("token"))
    );
  } catch {
    return false;
  }
}

/**
 * Setup protocol handler (qwen://) and second-instance handler (Linux).
 */
export function setupProtocolHandler(handlers: {
  onDeepLink: (url: string) => void;
  onCreateWindow: () => void;
  enqueueDeepLink?: (url: string) => void;
}): void {
  // FIRST: Register .desktop file and MIME handler for AppImage
  registerAppImageProtocolHandler();

  // THEN: Set as default protocol client (uses the .desktop file)
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("qwen", process.execPath, [process.argv[1]]);
    }
  } else {
    app.setAsDefaultProtocolClient("qwen");
  }

  // Handle qwen:// URLs (macOS)
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handlers.onDeepLink(url);
  });

  // Handle second instance (Linux)
  app.on("second-instance", (_event, commandLine) => {
    handlers.onCreateWindow();

    const url = commandLine.find(arg => arg.startsWith("qwen://"));
    if (url) handlers.onDeepLink(url);
  });

  // Also check for qwen:// in initial command line args (first launch)
  const qwenUrl = process.argv.find(arg => arg.startsWith("qwen://"));
  if (qwenUrl) {
    console.log("[Protocol] Deep link found in startup args:", qwenUrl);
    // Queue it - will be processed after window is created
    handlers.enqueueDeepLink?.(qwenUrl);
  }
}
