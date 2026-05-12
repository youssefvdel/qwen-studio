# Windows Qwen Desktop App - Authentication Flow Investigation

## Objective
Investigate how the **official Qwen Desktop Windows app** handles user authentication/login. We need to replicate this flow in our Linux version.

## Background
Our Linux app (`qwen-studio`) has a login issue:
- User clicks login → Opens external browser (not in-app)
- After login, callback to `qwen://open?token=xxx` doesn't work properly
- App doesn't receive the authentication token

The Windows app works correctly. We need to understand how.

---

## Investigation Tasks

### 1. Protocol Handler Registration
**Find how `qwen://` protocol is registered:**

- Search for `protocol` registration in the code
- Look for `setAsDefaultProtocolClient` or equivalent
- Check Windows registry entries for `qwen://`
- Find where the protocol handler is defined (likely in installer or main process)

**Files to check:**
- `main.{js,ts}` - Main Electron process
- `package.json` - Protocol declarations
- Installer scripts (NSIS, WiX, etc.)
- Windows Registry: `HKEY_CLASSES_ROOT\qwen`

**Expected to find:**
```javascript
app.setAsDefaultProtocolClient('qwen', ...)
```

---

### 2. Login Flow Interception
**Find how login URLs are intercepted:**

- Search for `setWindowOpenHandler` or `new-window` event
- Look for `will-navigate` event handlers
- Find URL pattern matching for auth URLs
- Check if they prevent external browser opening

**Search patterns:**
```javascript
// In main process
webContents.on('will-navigate', ...)
webContents.setWindowOpenHandler(...)
session.setPermissionRequestHandler(...)
```

**Look for:**
- Auth URL patterns (github.com, google.com, aliyun.com, etc.)
- How they decide to open in-app vs external browser
- Any custom auth window creation

---

### 3. Deep Link Handling
**Find how `qwen://` URLs are processed:**

- Search for `open-url` event (macOS) or `second-instance` (Windows/Linux)
- Look for URL parsing logic
- Find where `token` parameter is extracted
- Trace what happens after token is received

**Search patterns:**
```javascript
app.on('open-url', (event, url) => {...})
app.on('second-instance', (event, argv) => {...})
// Look for argv parsing for qwen:// URLs
```

**Expected flow:**
1. OAuth provider redirects to `qwen://open?token=xxx`
2. Windows routes to Qwen Desktop app
3. App extracts token from URL
4. Token is stored/used for authentication

---

### 4. Network Traffic Analysis
**Monitor actual network requests during login:**

Use Chrome DevTools (built into Electron) or Fiddler/Charles:

**Steps:**
1. Open Qwen Desktop app
2. Open DevTools (F12 or Ctrl+Shift+I)
3. Go to Network tab
4. Click login
5. Complete login flow
6. Export HAR file or copy request details

**Look for:**
- **Login endpoint URL** (e.g., `https://chat.qwen.ai/auth/...`)
- **OAuth provider URLs** (GitHub, Google, Alibaba, etc.)
- **Callback URL** parameter (should be `qwen://open`)
- **Token exchange** request/response
- **Authentication headers** (Authorization, Cookie, etc.)
- **Any custom headers** (bx-v, bx-ua, bx-umidtoken, etc.)

**Specific questions:**
- Does it use OAuth2 authorization code flow?
- Is there a token exchange endpoint?
- What cookies are set after login?
- Are there any special headers required?

---

### 5. Session/Cookie Management
**Find how authentication state is maintained:**

- Search for `session`, `cookies`, `storage`
- Look for cookie extraction/setting code
- Check if they use `partition` for session isolation
- Find how cookies are shared between windows

**Search patterns:**
```javascript
session.defaultSession.cookies.get(...)
session.defaultSession.cookies.set(...)
webPreferences: { partition: '...' }
```

**Look for:**
- Where auth cookies are stored
- How auth window shares cookies with main window
- Any cookie manipulation during login

---

### 6. Alternative Authentication Methods
**Check if they bypass web OAuth entirely:**

The Windows app might:
- Use a **native login form** (email/password inputs in-app)
- Call a **direct API** instead of web flow
- Use **system credentials** (Windows Hello, etc.)
- Have a **different auth endpoint** than the website

**Search for:**
- Login form components (email/password inputs)
- API calls to auth endpoints
- Any non-web authentication flow

---

## Deliverables

Please provide:

### 1. Code Snippets
```javascript
// Protocol registration
// Deep link handling
// Window open handler
// Cookie/session management
```

### 2. Network Request Details
```
Login URL: https://...
OAuth Provider: GitHub/Google/Alibaba
Callback URL: qwen://open?token=xxx
Token Endpoint: https://...
Required Headers: ...
```

### 3. Authentication Flow Diagram
```
1. User clicks login
2. App opens auth window (in-app or external?)
3. User authenticates with provider
4. Provider redirects to qwen://open?token=xxx
5. Windows routes to app
6. App extracts token
7. Token stored in cookies/localStorage
8. App reloads with auth state
```

### 4. Key Differences from Our Linux App
- What are we doing differently?
- What are we missing?
- What needs to be changed?

---

## Tools Available

- **DevTools**: F12 in Qwen Desktop app
- **Network Monitor**: Built-in DevTools Network tab
- **Registry Editor**: `regedit` for protocol handler inspection
- **Process Monitor**: Process Explorer to see app behavior
- **Fiddler/Charles**: For detailed HTTP traffic inspection

---

## Quick Start Commands

### Find Protocol Handler in Registry
```powershell
reg query HKEY_CLASSES_ROOT\qwen /s
```

### Search Codebase for Keywords
```bash
# In Qwen Desktop installation directory
grep -r "protocol" . --include="*.js" --include="*.ts"
grep -r "qwen://" . --include="*.js" --include="*.ts"
grep -r "setAsDefaultProtocolClient" . --include="*.js" --include="*.ts"
grep -r "will-navigate" . --include="*.js" --include="*.ts"
grep -r "setWindowOpenHandler" . --include="*.js" --include="*.ts"
grep -r "open-url" . --include="*.js" --include="*.ts"
grep -r "second-instance" . --include="*.js" --include="*.ts"
grep -r "cookie" . --include="*.js" --include="*.ts"
```

### Monitor Network Traffic
1. Open Qwen Desktop
2. Press F12 → Network tab
3. Click login
4. Right-click network log → "Save as HAR with content"

---

## Contact

Share findings in a detailed report with:
- Code snippets
- Network request/response details
- Screenshots of DevTools
- Any errors or unexpected behavior observed

**Goal:** Understand exactly how Windows app handles auth so we can fix Linux version.
