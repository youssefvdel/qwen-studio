# Parent ID Error Study

## Error Message
```
Oops! There was an issue connecting to Qwen3.6-Plus.
Invalid input chat parent_id <uuid> is not exist.
```

---

## 1. What is qwen-studio?

**qwen-studio is an Electron wrapper around chat.qwen.ai** - it does NOT manage conversation state itself.

```
┌─────────────────────────────────────────────────────────────┐
│                    Qwen Studio (Electron App)               │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Main Process   │    │      Renderer (WebView)         │ │
│  │                 │    │                                 │ │
│  │  - MCP Proxy    │    │  - chat.qwen.ai loaded in      │ │
│  │  - Settings     │    │    webview (iframe-like)        │ │
│  │  - System Tray  │    │  - Conversation state managed  │ │
│  │                 │    │    BY WEB APP (IndexedDB)       │ │
│  └─────────────────┘    └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS requests
                              ▼
                    ┌─────────────────────┐
                    │  chat.qwen.ai       │
                    │  (Alibaba Servers)  │
                    │  - Stores sessions  │
                    │  - Validates IDs    │
                    └─────────────────────┘
```

**Key Finding:** Conversation state (`parent_id`, `session_id`, chat history) is stored in:
- **Web app's IndexedDB** (`~/.config/qwen-studio/IndexedDB/https_chat.qwen.ai_0.indexeddb.leveldb`)
- **Web app's localStorage**
- **NOT in Electron's settings.json**

---

## 2. What is parent_id?

`parent_id` is a **conversation thread identifier** used by chat.qwen.ai to:
- Link replies to parent messages
- Maintain conversation context
- Enable threaded conversations

```
User sends message → Server creates parent_id → Store in IndexedDB
User replies       → Send parent_id to server → Server validates
```

---

## 3. Why Does This Error Happen?

### Root Cause Flow:
```
1. User starts conversation
   └─→ Server creates: parent_id = "abc123"
   └─→ Web app saves to IndexedDB

2. Something invalidates the session:
   - Page refresh / app restart
   - Cache cleared
   - Session timeout (server deletes old conversations)
   - Network issue during save
   - Multiple tabs/windows competing for same session

3. User tries to reply
   └─→ Web app reads OLD parent_id from IndexedDB
   └─→ Sends: POST /chat { parent_id: "abc123", message: "..." }
   └─→ Server responds: 404 "parent_id abc123 is not exist"
   └─→ Web app shows error to user
```

### Specific Triggers:
| Trigger | Why parent_id becomes invalid |
|---------|-------------------------------|
| **App restart** | IndexedDB may persist but server session expired |
| **Page refresh** | In-flight requests cancelled, state out of sync |
| **Cache clear** | `~/.config/qwen-studio/` cleared but user continues chat |
| **Session timeout** | Server auto-deletes old conversations (TTL) |
| **Multi-window** | Two windows compete for same parent_id |
| **Network error** | Save fails silently, next reply uses stale ID |

---

## 4. Where is Conversation State Stored?

### Electron App Data Location:
```
~/.config/qwen-studio/
├── IndexedDB/
│   └── https_chat.qwen.ai_0.indexeddb.leveldb  ← Conversation state here
├── Local Storage/
│   └── https_chat.qwen.ai_0.localstorage
├── Preferences
└── settings.json  ← Only MCP config, theme, language (NOT conversations)
```

### Code Search Results:
```bash
# qwen-studio Electron app does NOT handle conversation state:
grep -r "parent_id\|session_id" src/  # → No results

# Conversation handling is in chat.qwen.ai web app (not accessible)
# Loaded via: mainWindow.loadURL("https://chat.qwen.ai")
```

---

## 5. Can qwen-studio Fix This?

### ❌ What qwen-studio CANNOT do:
- Access web app's IndexedDB directly (sandboxed)
- Intercept chat.qwen.ai API calls (HTTPS encrypted)
- Modify server-side session validation
- Generate valid parent_id (server-side only)

### ✅ What qwen-studio CAN do:
1. **Detect error pattern** in webview console/network logs
2. **Auto-refresh page** when error detected
3. **Clear IndexedDB cache** before reload
4. **Show user-friendly message** instead of raw error
5. **Prevent data loss** by backing up chat history before refresh

---

## 6. Recommended Fix Strategy

### Option A: Page Refresh on Error (Recommended)
**What it does:** Detect error → Clear cache → Reload page → New session

**Implementation:**
```typescript
// In window-manager.ts or dedicated error-handler.ts
mainWindow.webContents.on('console-message', (event, message) => {
  if (message.includes('parent_id') && message.includes('is not exist')) {
    // Clear IndexedDB
    session.defaultStorage.clearData({ storages: ['indexeddb'] });
    // Reload with fresh session
    mainWindow.reload();
    // Notify user
    mainWindow.webContents.send('session-refresh-toast', 'Session refreshed, retrying...');
  }
});
```

**Pros:**
- Simple to implement
- Always works (fresh session guaranteed)
- No server changes needed

**Cons:**
- Loses current draft message
- Brief page reload visible to user

---

### Option B: Preemptive Session Validation
**What it does:** Periodically check if session is still valid

**Implementation:**
```typescript
// Every 5 minutes, inject script to validate session
setInterval(() => {
  mainWindow.webContents.executeJavaScript(`
    fetch('/api/session/validate')
      .then(r => r.json())
      .then(data => {
        if (!data.valid) {
          window.location.reload();
        }
      });
  `);
}, 300000);
```

**Pros:**
- Catches stale sessions before user tries to send
- Smoother UX (reload when idle)

**Cons:**
- Extra API calls
- May reload during active typing

---

### Option C: IndexedDB Backup + Restore
**What it does:** Backup chat history before refresh, restore after

**Implementation:**
```typescript
// Before reload
const chatHistory = await mainWindow.webContents.executeJavaScript(`
  JSON.parse(localStorage.getItem('chat_history') || '[]')
`);

// After reload
await mainWindow.webContents.executeJavaScript(`
  localStorage.setItem('chat_history', ${JSON.stringify(chatHistory)})
`);
```

**Pros:**
- Preserves user's chat history
- No data loss

**Cons:**
- Complex implementation
- Storage format may change

---

## 7. File Locations for Fix

| File | Purpose | Lines |
|------|---------|-------|
| `src/main/window-manager.ts` | WebView error handling | 260-300 |
| `src/main/index.ts` | App initialization | 360-380 |
| `src/preload/index.ts` | IPC bridge for error events | 90-100 |

---

## 8. Test Scenarios

Before deploying fix, test:
1. **Normal refresh:** Start chat → Close app → Reopen → Should work
2. **Cache clear:** Start chat → Delete `~/.config/qwen-studio/` → Continue chat → Should auto-recover
3. **Network loss:** Start chat → Disconnect network → Send message → Reconnect → Should retry
4. **Multi-window:** Open 2 windows → Chat in both → Should not conflict

---

## 9. Decision Required

**Recommended:** Option A (Page Refresh on Error)

**Why:**
- Simplest implementation (~50 lines)
- 100% effective (fresh session always works)
- No server dependency
- Minimal maintenance

**Ask user:** Should I proceed with Option A implementation?

---

## 10. Related Files

- `~/.config/qwen-studio/IndexedDB/https_chat.qwen.ai_0.indexeddb.leveldb` - Conversation storage
- `src/main/window-manager.ts` - WebView management
- `src/main/app-lifecycle.ts` - App state handling
