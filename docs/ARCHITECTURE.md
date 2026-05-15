# Qwen Studio Architecture

## System Overview

```mermaid
flowchart TB
    subgraph User["User Interface Layer"]
        WebView["chat.qwen.ai WebView<br/>(Renderer Process)"]
        SkillsMenu["Skills Menu<br/>(Electron Menu)"]
        SystemTray["System Tray"]
    end

    subgraph Electron["Electron Application"]
        subgraph Main["Main Process"]
            Index["index.ts<br/>(Bootstrap)"]
            WM["window-manager.ts<br/>(BrowserWindow)"]
            IPC["ipc-handlers.ts<br/>(IPC Bridge)"]
            MCPConfig["mcp-config.ts<br/>(Path Resolution)"]
            Skills["skills-manager.ts<br/>(Skill Injection)"]
            Lifecycle["app-lifecycle.ts<br/>(Deep Links)"]
        end

        subgraph MCP["MCP Proxy Layer"]
            Proxy["proxy.ts<br/>(McpProxy)"]
            Client["server-client.ts<br/>(McpServerClient)"]
        end

        subgraph Preload["Preload Script"]
            ContextBridge["contextBridge<br/>(window.electronAPI)"]
        end
    end

    subgraph Servers["MCP Servers (stdio)"]
        QwenCore["qwen-core<br/>(40 tools)"]
        Fetch["fetch MCP"]
        FS["filesystem MCP"]
    end

    subgraph External["External Systems"]
        QwenAI["chat.qwen.ai<br/>(Alibaba Cloud)"]
        Settings["~/.config/qwen-studio/<br/>settings.json"]
        IndexedDB["IndexedDB<br/>(Conversation State)"]
        FileSystem["Local Filesystem"]
    end

    WebView -->|IPC via contextBridge| ContextBridge
    ContextBridge -->|ipcRenderer.invoke| IPC
    IPC -->|function calls| Index
    Index -->|creates| WM
    Index -->|owns| Proxy
    Proxy -->|spawns| Client
    Client -->|stdio spawn| QwenCore
    Client -->|stdio spawn| Fetch
    Client -->|stdio spawn| FS
    
    IPC -->|read/write| Settings
    IPC -->|inject| Skills
    WM -->|loads URL| QwenAI
    QwenAI -->|stores| IndexedDB
    QwenAI -->|console messages| WM
    
    QwenCore -->|read/write| FileSystem
    Fetch -->|HTTP requests| External
    FS -->|file operations| FileSystem
    
    Index -->|manages| SystemTray
    Index -->|builds| SkillsMenu
    Index -->|handles| Lifecycle
```

## Data Flow: MCP Tool Execution

```mermaid
sequenceDiagram
    participant UI as chat.qwen.ai<br/>(WebView)
    participant Preload as Preload Script<br/>(contextBridge)
    participant IPC as IPC Handlers
    participant Proxy as MCP Proxy
    participant Client as MCP Server Client
    participant Server as qwen-core<br/>(Bun Process)

    UI->>Preload: window.electronAPI.mcp_client_tool_call({server, tool, args})
    Preload->>IPC: ipcRenderer.invoke("mcp_client_tool_call", params)
    IPC->>Proxy: callTool(params)
    Proxy->>Client: callTool()
    Client->>Server: stdio write {jsonrpc, method, params}
    
    Note over Server: Executes tool<br/>(file read, git, etc.)
    
    Server-->>Client: stdio read {jsonrpc, result}
    Client-->>Proxy: Promise<result>
    Proxy-->>IPC: result
    IPC-->>Preload: ipcRenderer result
    Preload-->>UI: Promise resolves
    
    Note over UI: Renders tool output<br/>in chat interface
```

## Component Responsibilities

```mermaid
mindmap
  root((Qwen Studio))
    Main Process
      index.ts
        ::icon(fa fa-flag)
        Bootstrap
        MCP Proxy Owner
        Menu Builder
      window-manager.ts
        ::icon(fa fa-window)
        BrowserWindow
        parent_id Recovery
        Tray Management
      ipc-handlers.ts
        ::icon(fa fa-bridge)
        15 IPC Handlers
        MCP Connect/Close
        Theme/Language
      mcp-config.ts
        ::icon(fa fa-cog)
        Path Resolution
        Runtime Adaptation
    MCP Layer
      proxy.ts
        ::icon(fa fa-exchange)
        Multi-Server Manager
        Client Caching
      server-client.ts
        ::icon(fa fa-plug)
        stdio Transport
        JSON-RPC Protocol
    Renderer
      WebView
        ::icon(fa fa-globe)
        chat.qwen.ai
        Conversation State
      Preload
        ::icon(fa fa-shield)
        contextBridge
        Security Boundary
    External
      qwen-core
        ::icon(fa fa-robot)
        40 Tools
        Skills System
      Settings
        ::icon(fa fa-file)
        MCP Config
        App Preferences
```

## Process Architecture

```mermaid
flowchart LR
    subgraph P1["Process 1: Main (Node.js)"]
        M1[Electron Main]
        M2[MCP Proxy]
        M3[IPC Handlers]
    end

    subgraph P2["Process 2: Renderer (Chromium)"]
        R1[WebView - chat.qwen.ai]
        R2[Preload Script]
    end

    subgraph P3["Process 3-N: MCP Servers"]
        S1[qwen-core (Bun)]
        S2[fetch (UV/Python)]
        S3[filesystem (UV/Python)]
    end

    P1 <-->|IPC Bridge| P2
    P1 <-->|stdio JSON-RPC| P3
    
    style P1 fill:#e1f5ff
    style P2 fill:#fff4e1
    style P3 fill:#e8f5e9
```

## MCP Server Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ConfigLoaded: app start
    ConfigLoaded --> Connecting: mcp_client_connect
    Connecting --> Connected: stdio spawn success
    Connecting --> Error: spawn fails
    Connected --> Executing: callTool
    Executing --> Connected: result returned
    Connected --> Disconnecting: mcp_client_close / app quit
    Disconnecting --> [*]: process killed
    Error --> [*]: error logged

    note right of Connected
        Client cached in
        McpProxy.clients Map
    end note

    note left of Executing
        Tool runs in isolated
        Bun/Python process
    end note
```

## File Structure Map

```mermaid
graph TD
    A[qwen-studio/] --> B[src/]
    A --> C[qwen-core/]
    A --> D[resources/]
    A --> E[docs/]

    B --> B1[main/]
    B --> B2[mcp/]
    B --> B3[preload/]
    B --> B4[shared/]

    B1 --> B1a[index.ts - Entry]
    B1 --> B1b[window-manager.ts - WebView]
    B1 --> B1c[ipc-handlers.ts - IPC]
    B1 --> B1d[mcp-config.ts - Paths]
    B1 --> B1e[skills-manager.ts]
    B1 --> B1f[app-lifecycle.ts]

    B2 --> B2a[proxy.ts - Multi-server]
    B2 --> B2b[server-client.ts - stdio]

    B3 --> B3a[index.ts - contextBridge]

    B4 --> B4a[types.ts - TypeScript interfaces]

    C --> C1[src/index.ts - MCP Server]
    C --> C2[skills/ - Agent Skills]
    C --> C3[package.json]

    D --> D1[bun/linux-x64/ - Runtime]
    D --> D2[uv/linux-x64/ - Python]

    E --> E1[ARCHITECTURE.md]
    E --> E2[PARENT_ID_ERROR_STUDY.md]
```

## IPC Channel Map

| Channel | Direction | Handler | Purpose |
|---------|-----------|---------|---------|
| `get_app_version` | Renderer → Main | `ipc-handlers.ts:41` | Get app version |
| `get_platform_info` | Renderer → Main | `ipc-handlers.ts:45` | Get OS/arch |
| `open_devtool` | Renderer → Main | `ipc-handlers.ts:56` | Open DevTools |
| `mcp_client_connect` | Renderer → Main | `ipc-handlers.ts:121` | Connect MCP servers |
| `mcp_client_tool_list` | Renderer → Main | `ipc-handlers.ts:165` | List available tools |
| `mcp_client_tool_call` | Renderer → Main | `ipc-handlers.ts:186` | Execute tool |
| `mcp_client_update_config` | Renderer → Main | `ipc-handlers.ts:203` | Update MCP config |
| `switch_theme` | Renderer → Main | `ipc-handlers.ts:278` | Toggle dark/light |
| `event_to_main` | Renderer → Main | `ipc-handlers.ts:305` | Custom events |
| `event_from_main` | Main → Renderer | `preload.ts:97` | Event broadcast |

## Key Design Decisions

### 1. Electron Wrapper Pattern
**Decision:** Wrap chat.qwen.ai instead of building native chat UI

**Why:**
- Leverages Alibaba's continuous web app improvements
- No need to implement chat rendering, message history, account management
- Focus on desktop integration (MCP, filesystem, system tray)

**Trade-off:** Cannot modify chat UI behavior; dependent on web app stability

### 2. MCP Proxy Architecture
**Decision:** Single `McpProxy` class managing multiple server connections

**Why:**
- Unified API for renderer (`mcp_client_tool_call`)
- Client caching reduces spawn overhead
- Lazy connection model (connect on first tool call)

**Implementation:** `src/mcp/proxy.ts` - 268 lines

### 3. stdio Transport for MCP
**Decision:** Use stdio JSON-RPC instead of HTTP/SSE for local servers

**Why:**
- No network overhead
- Automatic cleanup on process exit
- Simpler security model (no open ports)

**Protocol:** JSON-RPC 2.0 over stdin/stdout

### 4. Context Isolation
**Decision:** Enable `contextIsolation: true` with preload script

**Why:**
- Security: renderer cannot access Node.js directly
- Clean API boundary via `window.electronAPI`
- Prevents renderer from spawning arbitrary processes

### 5. qwen-core Embedding
**Decision:** Bundle qwen-core inside app.asar, not as external dependency

**Why:**
- Single install (no separate npm install for user)
- Version locked to app version
- Path resolution via `process.resourcesPath`

**Location:** `resources/app.asar/qwen-core/src/index.ts`

## Error Recovery: parent_id Flow

```mermaid
flowchart TD
    A[User sends message] --> B{Server validates<br/>parent_id}
    B -->|Valid| C[Message accepted]
    B -->|Invalid/Expired| D[Error: parent_id is not exist]
    
    D --> E[WebView console.error]
    E --> F[window-manager.ts<br/>console-message listener]
    
    F --> G{Detects pattern?<br/>parent_id + is not exist}
    G -->|No| H[Error shown to user]
    G -->|Yes| I[Log: ⚠️ parent_id error]
    
    I --> J[Clear IndexedDB + localStorage]
    J --> K[Show toast:<br/>Session refreshed]
    K --> L[Wait 500ms]
    L --> M[mainWindow.reload]
    M --> N[Fresh session<br/>new parent_id]
    
    style F fill:#ffeb3b
    style J fill:#a5d6a7
    style M fill:#90caf9
```

## Build Pipeline

```mermaid
flowchart LR
    A[npm install] --> B[postinstall:<br/>download-runtimes.js]
    B --> C[resources/bun/<br/>resources/uv/]
    
    D[npm run build] --> E[tsc:<br/>src/ → out/]
    E --> F[electron-builder]
    F --> G[ASAR:<br/>out/ → app.asar]
    G --> H[extraResources:<br/>qwen-core/, resources/]
    H --> I[Linux RPM/Deb/AppImage]
    
    style B fill:#ffe0b2
    style F fill:#c8e6c9
    style I fill:#bbdefb
```

## Configuration Storage

| Config | Location | Format | Managed By |
|--------|----------|--------|------------|
| MCP Servers | `~/.config/qwen-studio/settings.json` | `{ mcpServers: {...} }` | IPC handlers |
| App Theme | Web app account settings | Server-side | chat.qwen.ai |
| Language | `~/.config/qwen-studio/settings.json` | `{ app_language: "en" }` | IPC handlers |
| Conversation State | IndexedDB (LevelDB) | Binary (Leveldb) | chat.qwen.ai |
| Skills | `~/.config/qwen-studio/skills/` | Markdown files | skills-manager.ts |

## Security Boundaries

```mermaid
flowchart TB
    subgraph Trusted["Trusted Zone (Main Process)"]
        M1[Node.js APIs]
        M2[Filesystem Access]
        M3[MCP Server Spawn]
        M4[System Tray]
    end

    subgraph Boundary["Security Boundary"]
        CB[contextBridge]
        IPC[IPC Handlers]
    end

    subgraph Untrusted["Untrusted Zone (Renderer)"]
        R1[chat.qwen.ai]
        R2[Third-party scripts]
        R3[User-generated content]
    end

    Untrusted -->|Cannot access directly| Boundary
    Boundary -->|Whitelisted APIs only| Trusted
    
    style Trusted fill:#c8e6c9
    style Boundary fill:#ffecb3
    style Untrusted fill:#ffcdd2
```

---

**Generated:** 2026-05-15  
**Version:** qwen-studio v2.1.0
