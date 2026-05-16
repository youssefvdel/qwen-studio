# Official Qwen Desktop App Analysis

**App Version:** 1.0.3.44  
**Source:** `Qwen-1.0.3.44-release-win-x64.exe`  
**Extracted:** May 16, 2026  
**Repository:** `git@gitlab.alibaba-inc.com:qwenx/qwen-electron.git` (internal)

---

## Architecture Overview

- **Framework:** Electron (standard structure: main/preload/renderer)
- **Main Process:** `out/main/index.js` (700 lines)
- **Package Manager:** Bundled `bun` binary (not system npm)
- **MCP Server:** Internal `@ali/spark-mcp` package (v1.0.5-beta.12)

---

## Auth Flow & Deep Linking

### Protocol

- **Scheme:** `qwen://`
- **Format:** `qwen://open?token=...`
- **Validation:**
  ```js
  parsed.protocol === "qwen:" &&
    ["open"].includes(parsed.hostname) &&
    (parsed.hostname !== "open" || !!parsed.searchParams.get("token"));
  ```

### Platform Handling

- **Windows:** Reads `process.argv` for `qwen://` URLs on startup
- **macOS:** Listens to `open-url` event
- **Second Instance:** `second-instance` event checks argv for `qwen://` URLs

### Token Delivery

```js
if (action === "open") {
  mainWindow?.show();
  sendEvent("set_cookie", params.token);
}
```

- Token sent to renderer via `event_from_main` IPC channel
- Renderer sets cookie using the token

### Registration

```js
app.setAsDefaultProtocolClient("qwen");
```

---

## MCP Configuration

### Storage

- **Key:** `"mcp_config"` (via `electron-settings`)
- **Location:** OS-specific settings file (same as our `~/.config/qwen-studio/settings.json` approach)

### IPC Handlers

| Handler                    | Purpose                  |
| -------------------------- | ------------------------ |
| `mcp_client_tool_list`     | List tools for a server  |
| `mcp_client_tool_call`     | Execute a tool call      |
| `mcp_client_update_config` | Update MCP server config |
| `mcp_client_get_config`    | Get current MCP config   |

### Binary Adaptation

The app rewrites MCP server commands to use bundled binaries:

```js
function adaptConfig(configs) {
  for (const key in configs) {
    let cmd = config.command;
    if (cmd === "npx" || cmd === "bun") {
      cmd = getBunPath(); // Bundled bun binary
      if (config.command === "npx") {
        config.args.unshift("-y", "x"); // npx -> bun x
      }
    }
    if (cmd === "uvx") {
      cmd = getUvxPath(); // Bundled uvx binary
    }
    config.command = cmd;

    // Custom PATH injection
    const PATH = [
      path.join(app.getAppPath(), "resources", "bin"),
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":");
    config.env = { PATH, ...process.env, ...config.env };
  }
  return configs;
}
```

### Bundled Binaries

- **bun:** `resources/bun/{platform}/bun` or `bun.exe`
- **uvx:** `resources/python/{platform}/uvx` or `uvx.exe`
- **Platform dirs:** `mac-arm64`, `mac-x64`, `win-x64`

---

## Window Management

### Creation

```js
const mainWindowState = windowStateKeeper({
  defaultWidth: Math.min(1280, width * 0.85),
  defaultHeight: Math.min(840, height * 0.85),
});

new BrowserWindow({
  width: mainWindowState.width,
  height: mainWindowState.height,
  show: false,
  center: true,
  minWidth: 400,
  titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
  minHeight: 600,
  webPreferences: {
    preload: path.join(__dirname, "../preload/index.js"),
    sandbox: false,
    webviewTag: true,
    nodeIntegration: false,
    contextIsolation: true,
    nodeIntegrationInSubFrames: true,
    webSecurity: false,
    allowRunningInsecureContent: true,
  },
});
```

### Close Behavior

- **macOS:** `mainWindow.hide()` (keeps app running)
- **Windows/Linux:** `mainWindow.close()` (quits app)

### Custom User-Agent

```js
const customUA = `${defaultUA} AliDesktop(QWENCHAT/${version})`;
```

### Window Controls (Custom IPC)

| Event             | Action                         |
| ----------------- | ------------------------------ |
| `minimize-window` | `mainWindow.minimize()`        |
| `maximize-window` | Toggle maximize/unmaximize     |
| `close-window`    | Hide (macOS) or close (others) |

---

## IPC Commands (Full List)

| Command                             | Handler                    | Purpose                            |
| ----------------------------------- | -------------------------- | ---------------------------------- |
| `get_app_version`                   | `getAppVersion`            | Returns app version                |
| `get_platform_info`                 | `getPlatformInfo`          | Returns `{ os: process.platform }` |
| `open_devtool`                      | `OpenDevTool`              | Opens DevTools                     |
| `toggle_hidden_devtools`            | `toggleHiddenDevTools`     | Toggle hidden DevTools             |
| `open_external_link`                | `openExternalLink`         | Opens URL in system browser        |
| `show_native_dialog`                | `showNativeDialog`         | Shows native confirmation dialog   |
| `request_file_access`               | `requestFileAccess`        | File picker dialog                 |
| `mcp_client_tool_list`              | `mcpClientToolList`        | List MCP tools                     |
| `mcp_client_tool_call`              | `mcpClientToolCall`        | Call MCP tool                      |
| `mcp_client_update_config`          | `mcpClientUpdateConfig`    | Update MCP config                  |
| `mcp_client_get_config`             | `mcpClientGetConfig`       | Get MCP config                     |
| `webview-loaded`                    | `webviewLoaded`            | Notifies main when webview loads   |
| `switch_theme`                      | `switchTheme`              | Switch dark/light theme            |
| `switch_ln`                         | `switchLn`                 | Change language                    |
| `update_title_bar_for_system_theme` | (empty)                    | Placeholder                        |
| `get_language`                      | Returns `i18next.language` | Current language                   |

### Event System

- **Main → Renderer:** `event_from_main` channel
- **Renderer → Main:** `event_to_main` channel
- **Pending Events:** Queued if no webContents available, flushed on `webview-loaded`

---

## Internationalization

### Supported Languages

```
zh-CN, en-US, zh-TW, ja-JP, ko-KR, ru-RU, de-DE, fr-FR, es-ES, it-IT, pt-PT, ar-BH
```

### Storage

- **Key:** `"app_language"` (via `electron-settings`)
- **Fallback:** System language mapping or `en-US`

### Backend

- `i18next` + `i18next-fs-backend`
- Load path: `resources/i18n/{{lng}}.json`

---

## Auto-Update

### Provider

- **URL:** `https://download.qwen.ai/`
- **Platform paths:**
  - macOS: `macos/{arch}/`
  - Windows: `windows/{arch}/`

### Behavior

- `autoDownload: false` (user must confirm)
- `autoInstallOnAppQuit: true`
- Manual check via menu item

---

## Analytics

- **Package:** `@ali/aes-tracker` + `@ali/aes-tracker-plugin-event`
- **PID:** `"RfGbWG"`
- **Events tracked:**
  - `initProcess` (appReady, createWindow, windowReadyToShow, etc.)
  - `autoUpdater` (available, downloaded, error)
  - `update-status`
  - `getAppVersion`
  - `openUrl`
  - `webviewLoaded`
  - `switchTheme`
  - `switchLn`
  - `renderCrush`

---

## Logging

- **Location:** `userData/qwen-electron-debug.log`
- **Format:** `[YYYY-MM-DD HH:MM:SS] message`
- **Truncation:** Resets daily

---

## Dependencies (package.json)

```json
{
  "@ali/aes-tracker": "^3.3.11",
  "@ali/aes-tracker-plugin-event": "^3.0.0",
  "@ali/spark-mcp": "1.0.5-beta.12",
  "@electron-toolkit/preload": "^3.0.1",
  "@electron-toolkit/utils": "^4.0.0",
  "@modelcontextprotocol/sdk": "^1.13.0",
  "cross-env": "^7.0.3",
  "electron-settings": "^4.0.4",
  "electron-updater": "^6.3.9",
  "electron-window-state": "^5.0.3",
  "i18next": "^25.1.2",
  "i18next-fs-backend": "^2.6.0",
  "zod": "^3.25.67"
}
```

---

## Implications for Tauri Migration

### Must Implement

1. **Protocol Handler:** `qwen://open?token=...` in Rust
2. **MCP IPC Commands:** Match exact handler names
3. **Window State:** Persist position/size (use `tauri-plugin-window-state`)
4. **Custom User-Agent:** `... AliDesktop(QWENCHAT/2.2.0)`
5. **Event System:** `event_from_main` / `event_to_main` pattern

### Can Skip

- Analytics (`@ali/aes-tracker`) - internal Alibaba tracking
- Auto-update (use Tauri's built-in updater instead)
- Bundled binaries (use system npm/uvx/bun)
- i18n in main process (handle in frontend)

### Differences to Note

- Official app uses `webviewTag: true` (Electron webview)
- Tauri will load URL directly (no webview tag needed)
- Official app uses `@ali/spark-mcp` proxy; we use direct stdio MCP
- Official app bundles bun/uvx; we'll use system PATH
