# Qwen Domain & MCP API Analysis

> **Date:** 2026-05-16  
> **Purpose:** Understand what chat.qwen.ai allows for MCP configuration and auto-addition

---

## 🔍 API Endpoints Discovered

### 1. MCP Server List (Public)
```
GET https://chat.qwen.ai/api/v2/mcp/list?language=en-US
```
**Response:** Returns 4 built-in MCP servers:
| Server | Type | Tools | Description |
|--------|------|-------|-------------|
| `code-interpreter` | local | 1 | Python code execution |
| `fire-crawl` | mcpo | 8 | Web scraping, search, extraction |
| `amap` | sse | 12 | Maps, location, route planning |
| `image-generation` | local | 1 | Text-to-image generation |

**Status:** ✅ Works without authentication

### 2. User Settings (Protected)
```
GET https://chat.qwen.ai/api/v2/users/user/settings
```
**Status:** ❌ Requires authentication (401 Unauthorized)

### 3. Custom MCP Config (Not Found)
```
POST https://chat.qwen.ai/api/v2/mcp/config
GET  https://chat.qwen.ai/api/v2/mcp/servers
GET  https://chat.qwen.ai/api/v2/mcp/custom
```
**Status:** ❌ All return 404 Not Found

---

## 🚫 Domain Limitations

### What the Domain Does NOT Allow:
1. **No public API to add custom MCP servers** - The domain only exposes built-in servers
2. **No endpoint to push local MCP configs** - Custom servers must be configured locally
3. **User settings API is authenticated** - Requires login cookies/tokens
4. **No webhook or callback for MCP registration** - Can't auto-register from desktop app

### What This Means:
- **qwen-core CANNOT be auto-added via domain API**
- **MCP configuration MUST happen locally** (via Electron/Tauri IPC bridge)
- **The web app expects the desktop app to manage MCP servers**

---

## 📱 Official App Behavior (Inferred)

Based on the web app's behavior and our Electron implementation:

### How Official Windows/Mac App Works:
1. **App launches** → Loads `chat.qwen.ai` in WebView
2. **Preload script** → Injects `window.electronAPI` with MCP methods
3. **Web app calls** → `window.electronAPI.mcp_client_get_config()`
4. **Desktop app responds** → Returns local MCP server config
5. **Web app updates** → Shows MCP tools in UI

### Key Insight:
The web app **doesn't manage MCP servers** — it delegates to the desktop app via `window.electronAPI`. This is why we need the IPC bridge.

---

## 🔧 Current Implementation (Electron)

### How We Auto-Add qwen-core:
```typescript
// src/main/index.ts
async function loadMcpConfig(): Promise<McpConfig> {
  const config = settings[MCP_CONFIG_KEY] || {};
  if (!config["qwen-core"]) {
    config["qwen-core"] = getDefaultQwenCoreConfig(); // Auto-add!
    await setSettings(settings);
  }
  return config;
}
```

### How Web App Receives It:
```javascript
// Injected into WebView after page load
const electronConfig = await window.electronAPI.mcp_client_get_config();
await window.electronAPI.mcp_client_update_config(electronConfig);
```

---

## ✅ Recommended Approach

### For Tauri Migration:
1. **Keep local MCP management** — Don't rely on domain API
2. **Auto-add qwen-core on first launch** — Same as Electron approach
3. **Use Tauri IPC commands** — Replace `window.electronAPI` with `@tauri-apps/api`
4. **Sync config to web app** — Inject JavaScript to call Tauri commands

### Why This Works:
- The web app is designed to receive MCP config from the desktop app
- No domain API needed for custom servers
- Full control over MCP server lifecycle
- Works offline, no network dependency

---

## 📋 Action Items

| Task | Status | Notes |
|------|--------|-------|
| Document domain API limits | ✅ Done | No custom MCP API available |
| Implement local MCP auto-add | ✅ Done (Electron) | Working in current version |
| Port to Tauri | 🔄 In Progress | MCP protocol implemented |
| Test MCP config sync | ⏳ Pending | Need to verify web app integration |
| Add official app analysis | ⏳ Pending | Need Windows/Mac app files |

---

## 🔗 References

- MCP List API: `https://chat.qwen.ai/api/v2/mcp/list`
- Web App URL: `https://chat.qwen.ai`
- User Agent: `AliDesktop(QWENCHAT/2.1.1)`
- Config Location: `~/.config/qwen-studio/settings.json`
