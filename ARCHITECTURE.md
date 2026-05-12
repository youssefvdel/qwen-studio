# Qwen Studio Architecture

## Overview

Qwen Studio is an Electron-based desktop client for Qwen AI (chat.qwen.ai) built for Linux. It wraps the web application with native features including system tray, MCP integration, deep linking, and custom protocol handling.

---

## System Architecture

```mermaid
graph TB
    subgraph "Qwen Studio Application"
        Main[Main Process<br/>Electron]
        Render[Renderer Process<br/>WebView]
        Preload[Preload Script<br/>Context Bridge]
        MCP[MCP Proxy<br/>Server Management]
    end
    
    subgraph "External Services"
        Qwen[chat.qwen.ai<br/>Qwen Cloud]
        OAuth[OAuth Provider<br/>GitHub/Google/Alibaba]
        MCPS[MCP Servers<br/>Filesystem/Browser/DB]
    end
    
    Main -->|Load URL| Render
    Render -->|IPC| Preload
    Preload -->|Invoke| Main
    Main -->|Manage| MCP
    MCP -->|stdio/SSE| MCPS
    Render -->|HTTPS| Qwen
    Render -->|OAuth| OAuth
    OAuth -->|qwen://token| Main
    Main -->|set_cookie| Render
```

---

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant WebView
    participant OAuth
    participant Main
    participant Renderer
    
    User->>WebView: Click Login
    WebView->>OAuth: Open OAuth Popup
    User->>OAuth: Authenticate
    OAuth->>Main: Redirect qwen://open?token=xxx
    Main->>Main: validateProtocol()
    Main->>Main: Extract token
    Main->>Renderer: sendEvent('set_cookie', token)
    Renderer->>WebView: Inject cookies
    Renderer->>WebView: Navigate to chat.qwen.ai
    WebView->>Qwen: Request with auth cookie
    Qwen->>WebView: Authenticated response
    WebView->>User: Logged in UI
```

---

## Deep Link Handling

```mermaid
flowchart TD
    Start[User clicks login link] --> OAuth{OAuth complete?}
    OAuth -->|Yes| Redirect[Redirect to qwen://open?token=xxx]
    OAuth -->|No| Wait[Wait for authentication]
    
    Redirect --> OS{OS handles URL}
    OS -->|Linux| SecondInstance[second-instance event]
    OS -->|macOS| OpenURL[open-url event]
    
    SecondInstance --> Extract[Extract URL from argv]
    OpenURL --> Extract
    
    Extract --> Validate[validateProtocol URL]
    Validate -->|Invalid| LogError[Log error & return]
    Validate -->|Valid| Parse[Parse URL & extract token]
    
    Parse --> Check[Check mainWindow exists]
    Check -->|No| Queue[Queue for later]
    Check -->|Yes| Focus[Focus & restore window]
    
    Focus --> Send[sendEvent 'set_cookie' token]
    Send --> Renderer[Renderer receives IPC]
    Renderer --> Inject[Inject cookies to WebView]
    Inject --> Nav[Navigate to chat.qwen.ai]
    Nav --> Done[✅ User logged in]
```

---

## Component Structure

```mermaid
graph TD
    subgraph "Main Process"
        Index[main/index.ts<br/>App Bootstrap]
        WM[main/window-manager.ts<br/>BrowserWindow + Tray]
        IPC[main/ipc-handlers.ts<br/>IPC Handlers]
        AL[main/app-lifecycle.ts<br/>Protocol + Deep Links]
        MCP[main/mcp-config.ts<br/>MCP Configuration]
        SK[main/skills-manager.ts<br/>Skills System]
    end
    
    subgraph "MCP Layer"
        Proxy[mcp/proxy.ts<br/>Multi-server Manager]
        Client[mcp/server-client.ts<br/>Single Server Client]
    end
    
    subgraph "Renderer"
        HTML[renderer/index.html<br/>WebView Container]
        Preload[preload/index.ts<br/>Context Bridge]
    end
    
    subgraph "Shared"
        Types[shared/types.ts<br/>TypeScript Types]
    end
    
    Index --> WM
    Index --> IPC
    Index --> AL
    Index --> MCP
    Index --> SK
    MCP --> Proxy
    Proxy --> Client
    WM --> HTML
    IPC --> Preload
    Preload --> Types
```

---

## Data Flow

```mermaid
flowchart LR
    subgraph "User Input"
        UI[User types message]
    end
    
    subgraph "WebView"
        JS[chat.qwen.ai JavaScript]
        Cookie[Auth Cookies]
    end
    
    subgraph "Qwen Cloud"
        API[Qwen API]
        Model[AI Model]
    end
    
    subgraph "MCP Tools"
        FS[Filesystem]
        Browser[Browser]
        DB[Database]
    end
    
    UI -->|Input event| JS
    JS -->|XHR/Fetch + Cookie| API
    API -->|Tool needed| JS
    JS -->|IPC| Preload
    Preload -->|IPC Invoke| Main
    Main -->|stdio| FS
    Main -->|stdio| Browser
    Main -->|stdio| DB
    FS -->|Result| Main
    Browser -->|Result| Main
    DB -->|Result| Main
    Main -->|IPC Send| Preload
    Preload -->|IPC| JS
    JS -->|Tool result| API
    API -->|Model response| JS
    JS -->|DOM update| UI
```

---

## Protocol Handler Registration

```mermaid
graph TB
    subgraph "Build Time"
        EB[electron-builder.yml<br/>protocols: qwen]
        MIME[mimeTypes: x-scheme-handler/qwen]
    end
    
    subgraph "Install Time"
        Desktop[.desktop file<br/>MimeType=x-scheme-handler/qwen]
        XDGMIME[xdg-mime default<br/>qwen-studio.desktop]
    end
    
    subgraph "Runtime"
        App[app.whenReady]
        Check[isDefaultProtocolClient?]
        Register[setAsDefaultProtocolClient 'qwen']
    end
    
    subgraph "URL Click"
        User[User clicks qwen:// link]
        OS[OS routes to app]
        SI[second-instance event]
        Handler[handleDeepLink]
    end
    
    EB --> MIME
    MIME --> Desktop
    Desktop --> XDGMIME
    App --> Check
    Check -->|No| Register
    Check -->|Yes| Handler
    User --> OS
    OS --> SI
    SI --> Handler
```

---

## MCP Server Architecture

```mermaid
graph TD
    subgraph "Renderer"
        Chat[Chat Interface]
        Tools[Tool Buttons]
    end
    
    subgraph "Preload"
        Bridge[contextBridge]
        API[electronAPI.mcp_*]
    end
    
    subgraph "Main Process"
        IPC[IPC Handlers]
        Config[MCP Config]
        Proxy[McpProxy]
    end
    
    subgraph "MCP Layer"
        Server1[Server Client 1<br/>Filesystem]
        Server2[Server Client 2<br/>Fetch]
        Server3[Server Client 3<br/>Browser]
    end
    
    subgraph "External"
        Bun[Bun Runtime]
        UV[UV Runtime]
        NPM[NPM Packages]
    end
    
    Chat -->|Tool call| Tools
    Tools -->|IPC Invoke| Bridge
    Bridge -->|IPC| API
    API -->|IPC| IPC
    IPC -->|Route| Proxy
    Proxy -->|List tools| Server1
    Proxy -->|List tools| Server2
    Proxy -->|List tools| Server3
    Server1 -->|stdio| Bun
    Server2 -->|stdio| Bun
    Server3 -->|stdio| UV
    Bun --> NPM
    UV --> NPM
```

---

## Security Model

```mermaid
flowchart TD
    subgraph "Security Layers"
        L1[Layer 1: Context Isolation]
        L2[Layer 2: Sandbox]
        L3[Layer 3: IPC Validation]
        L4[Layer 4: Protocol Validation]
    end
    
    subgraph "Threat Prevention"
        T1[Prevent: Direct Node access]
        T2[Prevent: XSS → System]
        T3[Prevent: Malicious IPC]
        T4[Prevent: URL Injection]
    end
    
    L1 -->|contextIsolation: true| T1
    L2 -->|sandbox: false<br/>webSecurity: false| T2
    L3 -->|validateProtocol| T3
    L4 -->|validateDeepLink| T4
    
    subgraph "IPC Flow"
        Render[Renderer]
        Preload[Preload]
        Main[Main Process]
    end
    
    Render -->|Restricted| Preload
    Preload -->|Typed Channels| Main
    Main -->|Validated| Render
```

---

## File Structure

```
qwen-studio/
├── src/
│   ├── main/
│   │   ├── index.ts              # App bootstrap
│   │   ├── window-manager.ts     # BrowserWindow + Tray
│   │   ├── ipc-handlers.ts       # IPC main handlers
│   │   ├── app-lifecycle.ts      # Protocol + Deep links
│   │   ├── mcp-config.ts         # MCP configuration
│   │   ├── skills-manager.ts     # Skills system
│   │   ├── runtime.ts            # Runtime paths
│   │   ├── logger.ts             # Logging utility
│   │   └── updater.ts            # Auto-updater
│   ├── mcp/
│   │   ├── proxy.ts              # Multi-server manager
│   │   └── server-client.ts      # Single server client
│   ├── preload/
│   │   └── index.ts              # Context bridge
│   ├── renderer/
│   │   └── index.html            # WebView container
│   └── shared/
│       └── types.ts              # TypeScript types
├── resources/
│   ├── bun/                      # Bundled Bun runtime
│   ├── uv/                       # Bundled UV runtime
│   └── icon.png                  # App icon
├── out/                          # Compiled JavaScript
├── dist/                         # Built packages
├── package.json
├── electron-builder.yml
└── tsconfig.json
```

---

## Key Technologies

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Framework** | Electron 34 | Desktop app framework |
| **Language** | TypeScript 5.7 | Type-safe JavaScript |
| **WebView** | Chromium | chat.qwen.ai rendering |
| **MCP** | @modelcontextprotocol/sdk | Tool integration |
| **Runtimes** | Bun + UV | MCP server execution |
| **Packaging** | electron-builder | AppImage, DEB, RPM |
| **Settings** | electron-settings | User preferences |
| **i18n** | i18next | 12 language support |

---

## Platform Support

| Platform | Package | Protocol Handler |
|----------|---------|-----------------|
| **All Linux** | AppImage | electron-builder + runtime |
| **Debian/Ubuntu** | DEB | MIME type + .desktop |
| **Fedora/RHEL** | RPM | MIME type + .desktop |
| **macOS** | DMG | Info.plist + open-url |
| **Windows** | EXE/MSI | Registry + second-instance |

---

## Version History

### v2.0.0 (2026-05-12) - Major Authentication Fix
- ✅ Fixed login flow (OAuth → qwen:// → token → cookie)
- ✅ Added runtime protocol registration
- ✅ Implemented Windows/macOS auth pattern
- ✅ Changed event: `auth_token` → `set_cookie`
- ✅ In-app OAuth popup (not external browser)
- ✅ Shared session between windows

### v1.1.3 and earlier
- Initial Linux release
- Basic Electron wrapper
- MCP support
- System tray

---

**Last Updated:** 2026-05-12  
**Version:** 2.0.0
