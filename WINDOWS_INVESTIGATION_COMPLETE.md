# Qwen Desktop Windows App - COMPLETE Authentication Investigation

## 🎯 CRITICAL OBJECTIVE

**Our Linux app login is BROKEN.** When user clicks login:
- ❌ Opens EXTERNAL browser (Chrome/Edge/Firefox)
- ❌ After login, `qwen://open?token=xxx` doesn't route back to app
- ❌ App stays logged out

**Windows app login WORKS.** We need to know EXACTLY how.

**Mission:** Reverse-engineer the Windows app's ENTIRE authentication system and provide CODE-LEVEL details so we can fix Linux.

---

## 📋 INVESTIGATION CHECKLIST - DO NOT SKIP ANY ITEM

### PART 1: PROTOCOL HANDLER (`qwen://`)

#### 1.1 Windows Registry Inspection
```powershell
# Run these commands and save ALL output
reg query HKEY_CLASSES_ROOT\qwen /s > C:\qwen-registry.txt
reg query HKEY_CURRENT_USER\Software\Classes\qwen /s >> C:\qwen-registry.txt
reg query HKEY_LOCAL_MACHINE\SOFTWARE\RegisteredApplications /v qwen >> C:\qwen-registry.txt
```

**What to find:**
- [ ] What is the `URL Protocol` value?
- [ ] What command executes when `qwen://` is clicked?
- [ ] Full path to executable in the command
- [ ] What arguments are passed to the executable?
- [ ] Are there any environment variables set?
- [ ] Is there a `DefaultIcon` entry?

**Expected structure:**
```
HKEY_CLASSES_ROOT\qwen
    (Default) = "URL:Qwen Protocol"
    URL Protocol = ""
    DefaultIcon = "C:\...\Qwen\app.exe,1"
    shell\open\command
        (Default) = "C:\...\Qwen\app.exe" -- "%1"
```

#### 1.2 Protocol Registration in Code
**Search ENTIRE codebase for these patterns:**

```bash
# Search all JS/TS files
grep -r "setAsDefaultProtocolClient" . --include="*.js" --include="*.ts" --include="*.json"
grep -r "protocol.register" . --include="*.js" --include="*.ts"
grep -r "protocol.handle" . --include="*.js" --include="*.ts"
grep -r "qwen://" . --include="*.js" --include="*.ts" --include="*.json"
grep -r "URL Protocol" . --include="*.js" --include="*.ts" --include="*.json"
grep -r "protocol.*qwen" . --include="*.js" --include="*.ts" --include="*.json"
```

**For EACH match found, provide:**
- [ ] Full file path
- [ ] Line number
- [ ] Complete code context (10 lines before and after)
- [ ] Is it in main process or renderer?
- [ ] When is it called? (app ready, startup, etc.)

**Look for code like:**
```javascript
// In main process
app.setAsDefaultProtocolClient('qwen', process.execPath, [...])
protocol.registerSchemesAsPrivileged([{ scheme: 'qwen', privileges: {...} }])
protocol.handle('qwen', (request) => {...})
```

#### 1.3 Installer/Build Configuration
**Check installer scripts and build configs:**

- [ ] NSIS installer script (`.nsi`)
- [ ] WiX configuration (`.wxs`)
- [ ] electron-builder config
- [ ] electron-forge config
- [ ] package.json `build` section
- [ ] Any `.inf` or `.reg` files

**Search for:**
```bash
grep -r "Protocol" . --include="*.nsi" --include="*.wxs" --include="*.json" --include="*.yml"
grep -r "qwen" . --include="*.nsi" --include="*.wxs" --include="*.json" --include="*.yml"
```

**Find:**
- [ ] Where is the protocol registered during install?
- [ ] What registry keys are written?
- [ ] Is there an uninstall cleanup?

---

### PART 2: LOGIN FLOW - STEP BY STEP

#### 2.1 Network Traffic Capture (CRITICAL!)

**Setup:**
1. Open Qwen Desktop Windows app
2. Press `F12` to open DevTools
3. Go to **Network** tab
4. Check **"Preserve log"**
5. Clear any existing logs
6. Click **Login** button in the app
7. Complete the entire login process
8. **Export HAR file** (right-click → "Save all as HAR")

**What to extract from HAR:**

**For EACH request in the login flow:**
- [ ] Request URL (full URL with all parameters)
- [ ] Request method (GET/POST/etc.)
- [ ] Request headers (ALL headers)
- [ ] Request body (if POST/PUT)
- [ ] Response status code
- [ ] Response headers (ALL headers)
- [ ] Response body (complete response)
- [ ] Timing (when it was sent/received)
- [ ] Initiator (what triggered this request)
- [ ] Remote address (IP of server)

**Specific questions:**
- [ ] What is the FIRST request when login is clicked?
- [ ] Does it go to `chat.qwen.ai` or a different domain?
- [ ] Is there an OAuth provider redirect? (GitHub, Google, etc.)
- [ ] What is the `redirect_uri` or `callback` parameter?
- [ ] Is it `qwen://` or something else?
- [ ] Is there a token exchange endpoint?
- [ ] What does the final auth response look like?

**Look for these patterns in URLs:**
```
https://chat.qwen.ai/auth/...
https://chat.qwen.ai/login/...
https://chat.qwen.ai/oauth/...
https://github.com/login/oauth/...
https://accounts.google.com/o/oauth2/...
https://passport.aliyun.com/...
```

**Copy COMPLETE request/response for auth flow:**
```
=== REQUEST 1: Initial Login ===
URL: POST https://chat.qwen.ai/api/v1/auth/login
Headers:
  Content-Type: application/json
  Authorization: ???
  Cookie: ???
  X-Request-ID: ???
  User-Agent: ???
Body: {"email":"...","password":"..."}

=== RESPONSE 1 ===
Status: 200 OK
Headers:
  Set-Cookie: token=xxx; Domain=.qwen.ai; Path=/; Secure; HttpOnly
  Set-Cookie: session=yyy; ...
Body: {"token":"xxx","user":{...}}

=== REQUEST 2: Token Exchange ===
...
```

#### 2.2 Login Button Handler
**Find the code that runs when login button is clicked:**

```bash
# Search for login-related code
grep -r "login" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
grep -r "auth" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
grep -r "signin" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
grep -r "authenticate" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
grep -r "onClick.*login" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
```

**For EACH login-related function found:**
- [ ] Full file path and line number
- [ ] Complete function code
- [ ] What event triggers it?
- [ ] What URL does it navigate to?
- [ ] Does it open a new window?
- [ ] Does it make an API call?
- [ ] What parameters are passed?

**Look for:**
```javascript
// In renderer (React/Vue/etc.)
function handleLogin() {
  window.open('https://...', '_blank')
  // OR
  window.location.href = 'https://...'
  // OR
  ipcRenderer.invoke('login', {...})
}

// In main process
ipcMain.handle('login', async () => {
  // What happens here?
})
```

#### 2.3 Window Creation for Auth
**Find how auth window is created:**

```bash
grep -r "BrowserWindow" . --include="*.js" --include="*.ts" | grep -i "auth\|login"
grep -r "new BrowserWindow" . --include="*.js" --include="*.ts"
grep -r "setWindowOpenHandler" . --include="*.js" --include="*.ts"
grep -r "will-navigate" . --include="*.js" --include="*.ts"
grep -r "did-navigate" . --include="*.js" --include="*.ts"
```

**For EACH auth window creation:**
- [ ] Window dimensions (width, height)
- [ ] Window position (x, y)
- [ ] Is it modal?
- [ ] Does it have a parent window?
- [ ] What are the `webPreferences`?
  - `partition` value?
  - `contextIsolation`?
  - `nodeIntegration`?
  - `sandbox`?
- [ ] What URL does it load?
- [ ] How is it closed?
- [ ] How is the result communicated back?

**Look for:**
```javascript
const authWindow = new BrowserWindow({
  width: 500,
  height: 600,
  parent: mainWindow,
  modal: true/false,
  webPreferences: {
    partition: 'persist:auth' // OR '' for default
  }
})
```

---

### PART 3: DEEP LINK HANDLING

#### 3.1 URL Event Handlers
**Find how `qwen://` URLs are received:**

```bash
# Search for URL handling code
grep -r "open-url" . --include="*.js" --include="*.ts"
grep -r "second-instance" . --include="*.js" --include="*.ts"
grep -r "argv" . --include="*.js" --include="*.ts" | grep -i "url\|qwen"
grep -r "process.argv" . --include="*.js" --include="*.ts"
grep -r "commandLine" . --include="*.js" --include="*.ts"
```

**For EACH handler found:**
- [ ] Full file path and line number
- [ ] Complete handler code
- [ ] How is the URL parsed?
- [ ] How is the token extracted?
- [ ] What happens after token is extracted?
- [ ] Is the token stored? Where?
- [ ] Is the window reloaded?
- [ ] Is an event sent to renderer?

**Look for:**
```javascript
// macOS
app.on('open-url', (event, url) => {
  // url = "qwen://open?token=xxx"
  const token = new URL(url).searchParams.get('token')
  // What happens next?
})

// Windows/Linux
app.on('second-instance', (event, argv) => {
  // argv = [..., "qwen://open?token=xxx"]
  const url = argv.find(arg => arg.startsWith('qwen://'))
  // What happens next?
})
```

#### 3.2 Token Processing
**Find what happens AFTER token is received:**

```bash
grep -r "token" . --include="*.js" --include="*.ts" | grep -i "auth\|access\|session"
grep -r "set-cookie" . --include="*.js" --include="*.ts"
grep -r "cookies.set" . --include="*.js" --include="*.ts"
grep -r "localStorage.setItem" . --include="*.js" --include="*.ts"
grep -r "sessionStorage.setItem" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] Where is the token stored? (cookie, localStorage, memory?)
- [ ] What cookie name is used? (`token`, `auth_token`, `accessToken`, etc.)
- [ ] What is the cookie domain? (`.qwen.ai`, `chat.qwen.ai`, etc.)
- [ ] What is the cookie path?
- [ ] Is the cookie HttpOnly? Secure? SameSite?
- [ ] Is the token also stored in localStorage?
- [ ] What key is used in localStorage?
- [ ] After storing, is the window reloaded?
- [ ] Is an IPC message sent to renderer?
- [ ] Is there a callback to notify success?

**Look for:**
```javascript
// Setting cookie
session.defaultSession.cookies.set({
  url: 'https://chat.qwen.ai',
  name: 'token',
  value: token,
  domain: '.qwen.ai',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax'
})

// Or setting localStorage
authWindow.webContents.executeJavaScript(`
  localStorage.setItem('auth_token', '${token}')
`)

// Or reloading window
mainWindow.reload()

// Or sending event
mainWindow.webContents.send('auth-success', { token })
```

---

### PART 4: SESSION & COOKIE MANAGEMENT

#### 4.1 Session Configuration
**Find how Electron sessions are configured:**

```bash
grep -r "session" . --include="*.js" --include="*.ts" | grep -v "sessionStorage"
grep -r "partition" . --include="*.js" --include="*.ts"
grep -r "cookies" . --include="*.js" --include="*.ts"
grep -r "fromPartition" . --include="*.js" --include="*.ts"
grep -r "defaultSession" . --include="*.js" --include="*.ts"
```

**For EACH session usage:**
- [ ] Is it `defaultSession` or a custom partition?
- [ ] What is the partition name? (`persist:xxx` or `''`?)
- [ ] Are multiple sessions used?
- [ ] Do auth window and main window share the same session?
- [ ] How are cookies extracted/set?
- [ ] Is there cookie synchronization between windows?

**Look for:**
```javascript
// Same session (cookies shared)
const authWindow = new BrowserWindow({
  webPreferences: { partition: '' } // or no partition specified
})

// Different session (cookies NOT shared)
const authWindow = new BrowserWindow({
  webPreferences: { partition: 'persist:auth' }
})

// Cookie manipulation
const cookies = await session.defaultSession.cookies.get({ url: 'https://chat.qwen.ai' })
await session.defaultSession.cookies.set({ url: '...', name: '...', value: '...' })
```

#### 4.2 Cookie Inspection
**Find all cookie-related code:**

```bash
grep -r "cookie" . --include="*.js" --include="*.ts" -A 5 -B 5
```

**For EACH cookie operation:**
- [ ] Full code context
- [ ] What URL is the cookie for?
- [ ] What is the cookie name?
- [ ] How is the cookie value obtained?
- [ ] When is the cookie set?
- [ ] When is the cookie read?
- [ ] Is the cookie ever deleted/cleared?

---

### PART 5: AUTHENTICATION FLOW DIAGRAM

**Create a COMPLETE step-by-step diagram:**

```
Step 1: User clicks "Login" button
├─ File: [path/to/file.js:line]
├─ Function: [functionName]
├─ Action: [What happens?]
│  ├─ Opens URL: [full URL]
│  ├─ In: [new window / same window / external browser]
│  └─ Window config: { width, height, parent, partition, ... }

Step 2: User authenticates with provider
├─ Provider: [GitHub / Google / Alibaba / Email]
├─ URL: [auth provider URL]
├─ Method: [OAuth2 / SAML / Custom]
└─ Redirect URI: [qwen://open?token=xxx OR https://...]

Step 3: Token received
├─ Via: [qwen:// deep link / window.postMessage / IPC / cookie]
├─ Token location: [URL parameter / response body / cookie]
├─ Extraction code: [file.js:line]
└─ Token format: [JWT / opaque string / etc.]

Step 4: Token stored
├─ Storage: [cookie / localStorage / memory / file]
├─ Cookie name: [token / auth_token / etc.]
├─ Cookie domain: [.qwen.ai / chat.qwen.ai]
├─ Cookie flags: [HttpOnly / Secure / SameSite]
└─ Storage code: [file.js:line]

Step 5: App state updated
├─ Window reloaded: [yes/no]
├─ Event sent: [IPC event name]
├─ Renderer notified: [how?]
└─ UI updated: [how?]

Step 6: Authenticated requests
├─ Token sent via: [Cookie header / Authorization header]
├─ Header name: [Authorization / X-Auth-Token]
├─ Header format: [Bearer xxx / Token xxx]
└─ Example request: [curl command with headers]
```

---

### PART 6: ALTERNATIVE AUTH METHODS

**Check if Windows app uses DIFFERENT auth than web:**

#### 6.1 Native Login Form
**Look for in-app login forms:**

```bash
grep -r "email" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" | grep -i "input\|password"
grep -r "password" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx" | grep -i "input"
grep -r "<input" . --include="*.jsx" --include="*.tsx" | grep -i "password\|email"
grep -r "type.*password" . --include="*.js" --include="*.ts" --include="*.jsx" --include="*.tsx"
```

**Find:**
- [ ] Is there an email/password input in the app?
- [ ] Does it submit directly to an API?
- [ ] What endpoint?
- [ ] No browser OAuth at all?

#### 6.2 Direct API Authentication
**Look for direct API calls:**

```bash
grep -r "fetch.*auth" . --include="*.js" --include="*.ts"
grep -r "axios.*auth" . --include="*.js" --include="*.ts"
grep -r "POST.*login" . --include="*.js" --include="*.ts"
grep -r "POST.*auth" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] Is there a direct POST to login endpoint?
- [ ] What is the endpoint URL?
- [ ] What is the request body format?
- [ ] What is the response format?
- [ ] How is the token obtained?

#### 6.3 System Authentication
**Check for Windows-specific auth:**

```bash
grep -r "windows" . --include="*.js" --include="*.ts" | grep -i "auth\|credential\|hello"
grep -r "credential" . --include="*.js" --include="*.ts"
grep -r "WindowsHello" . --include="*.js" --include="*.ts"
grep -r "webauthn" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] Does it use Windows Hello?
- [ ] Does it use Windows Credential Manager?
- [ ] Does it use any system SSO?

---

### PART 7: HEADERS & SECURITY

#### 7.1 Custom Headers
**Find all custom headers sent in requests:**

```bash
grep -r "headers" . --include="*.js" --include="*.ts" -A 10 | grep -E "(bx-|x-|authorization|cookie)"
```

**Look for:**
- [ ] `Authorization` header format
- [ ] `bx-v` (version?)
- [ ] `bx-ua` (user agent?)
- [ ] `bx-umidtoken` (auth token?)
- [ ] `X-Request-ID`
- [ ] Any other custom headers

**For EACH header:**
- [ ] Header name
- [ ] Header value format
- [ ] Where is it generated?
- [ ] Is it static or dynamic?
- [ ] Is it required for auth?

#### 7.2 User-Agent
**Find User-Agent configuration:**

```bash
grep -r "User-Agent" . --include="*.js" --include="*.ts"
grep -r "userAgent" . --include="*.js" --include="*.ts"
grep -r "setUserAgent" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] What User-Agent is sent?
- [ ] Is it custom or default Chrome?
- [ ] Does it include app version?
- [ ] Is it different for auth requests?

---

### PART 8: ERROR HANDLING

**Find how auth errors are handled:**

```bash
grep -r "error" . --include="*.js" --include="*.ts" | grep -i "auth\|login\|token"
grep -r "catch" . --include="*.js" --include="*.ts" -A 5 | grep -i "auth\|login"
grep -r "401" . --include="*.js" --include="*.ts"
grep -r "403" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] What happens on auth failure?
- [ ] Is there a retry mechanism?
- [ ] Is the user notified?
- [ ] Is the token cleared on error?

---

### PART 9: LOGOUT & TOKEN REFRESH

#### 9.1 Logout Flow
**Find how logout works:**

```bash
grep -r "logout" . --include="*.js" --include="*.ts"
grep -r "signout" . --include="*.js" --include="*.ts"
grep -r "clear.*auth" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] What happens on logout?
- [ ] Are cookies cleared?
- [ ] Is localStorage cleared?
- [ ] Is the window reloaded?
- [ ] Is there a server logout call?

#### 9.2 Token Refresh
**Find if tokens are refreshed:**

```bash
grep -r "refresh" . --include="*.js" --include="*.ts" | grep -i "token\|auth"
grep -r "expire" . --include="*.js" --include="*.ts" | grep -i "token\|auth"
grep -r "token.*refresh" . --include="*.js" --include="*.ts"
```

**Find:**
- [ ] Is there a refresh token?
- [ ] When is the token refreshed?
- [ ] What endpoint is used?
- [ ] Is it automatic or manual?

---

### PART 10: SOURCE CODE STRUCTURE

**Provide complete file tree for auth-related code:**

```
qwen-desktop-windows/
├── src/
│   ├── main/
│   │   ├── index.js              # Main entry point
│   │   ├── auth.js               # Auth handlers? [EXISTS?]
│   │   ├── protocol.js           # Protocol handling? [EXISTS?]
│   │   └── window-manager.js     # Window creation?
│   ├── renderer/
│   │   ├── components/
│   │   │   ├── LoginButton.jsx   # Login button? [EXISTS?]
│   │   │   └── AuthModal.jsx     # Auth modal? [EXISTS?]
│   │   └── utils/
│   │       └── auth.ts           # Auth utilities? [EXISTS?]
│   └── preload/
│       └── index.js              # Preload script
└── package.json
```

**For EACH auth-related file:**
- [ ] Full file path
- [ ] Purpose/function
- [ ] Key functions exported
- [ ] Dependencies

---

## 📦 DELIVERABLES FORMAT

### Required Output Files

Create these files with COMPLETE information:

#### 1. `auth-flow-complete.md`
```markdown
# Complete Authentication Flow

## Step-by-Step Flow
[Detailed step-by-step from login click to authenticated state]

## Network Requests
[All requests with full headers/bodies]

## Code Locations
[All relevant files with line numbers]

## Token Handling
[How token is received, stored, used]
```

#### 2. `protocol-handler-code.txt`
```
Paste COMPLETE code for protocol registration and handling
Include file paths and line numbers
```

#### 3. `network-har-analysis.md`
```markdown
# HAR File Analysis

## Request 1: [Description]
- URL: ...
- Method: ...
- Headers: [ALL]
- Body: [if applicable]
- Response: [ALL]

## Request 2: [Description]
...

## Summary
- Total requests: X
- Auth provider: [GitHub/Google/Alibaba/etc.]
- Callback URL: ...
- Token location: ...
```

#### 4. `windows-registry-export.txt`
```
Complete output from reg query commands
```

#### 5. `key-findings.md`
```markdown
# Key Findings

## What We're Doing Wrong on Linux
[List specific differences]

## What We Need to Change
[Specific code changes needed]

## Critical Missing Pieces
[What Linux app is missing]

## Quick Fix
[The ONE thing that will probably fix it]
```

---

## 🎯 CRITICAL QUESTIONS - MUST ANSWER

After investigation, you MUST be able to answer these:

1. **Does the Windows app open login in-app or external browser?**
   - [ ] In-app popup
   - [ ] In-app full window
   - [ ] External browser
   - [ ] Native form (no browser)

2. **How is the `qwen://` protocol registered?**
   - [ ] electron-builder config
   - [ ] NSIS installer script
   - [ ] Windows registry manually written
   - [ ] app.setAsDefaultProtocolClient()
   - [ ] Other: [specify]

3. **How is the deep link received?**
   - [ ] app.on('open-url')
   - [ ] app.on('second-instance')
   - [ ] Command line argument parsing
   - [ ] Other: [specify]

4. **Where is the token stored?**
   - [ ] Cookie (name: ???, domain: ???)
   - [ ] localStorage (key: ???)
   - [ ] Memory only
   - [ ] File on disk
   - [ ] Other: [specify]

5. **Does auth window share session with main window?**
   - [ ] Yes, same partition
   - [ ] No, different partition
   - [ ] Cookies are manually copied
   - [ ] Other: [specify]

6. **What is the OAuth provider?**
   - [ ] GitHub
   - [ ] Google
   - [ ] Alibaba
   - [ ] Email/password
   - [ ] Multiple options
   - [ ] Other: [specify]

7. **What is the callback URL parameter?**
   - [ ] `qwen://open?token=xxx`
   - [ ] `qwen://auth?token=xxx`
   - [ ] `qwen://callback?token=xxx`
   - [ ] Different format: [specify]
   - [ ] No callback (different flow)

8. **What headers are required for auth?**
   - [ ] Authorization: Bearer xxx
   - [ ] Cookie: token=xxx
   - [ ] Custom header: [specify]
   - [ ] No special headers

9. **After receiving token, what happens?**
   - [ ] Window.reload()
   - [ ] Cookies set, then navigate to chat.qwen.ai
   - [ ] IPC event sent to renderer
   - [ ] Other: [specify]

10. **What is the ONE thing Linux app is missing?**
    - [Your answer here]

---

## 🛠️ TOOLS & COMMANDS REFERENCE

### PowerShell Commands
```powershell
# Registry export
reg query HKEY_CLASSES_ROOT\qwen /s > C:\qwen-registry.txt

# Find Qwen installation
Get-ChildItem "C:\Program Files" -Recurse -Filter "*qwen*" -ErrorAction SilentlyContinue

# Process monitoring
Get-Process | Where-Object {$_.ProcessName -like "*qwen*"}
```

### Bash/Grep Commands
```bash
# Search codebase
grep -r "pattern" . --include="*.js" --include="*.ts" -n
grep -r "pattern" . --include="*.js" --include="*.ts" -A 5 -B 5

# Find files
find . -name "*.js" -o -name "*.ts" | xargs grep -l "pattern"
```

### DevTools Commands
```javascript
// In DevTools Console
// Get all cookies
document.cookie

// Get localStorage
Object.entries(localStorage)

// Get session storage
Object.entries(sessionStorage)

// Monitor network
// (Use Network tab in DevTools)
```

---

## ⚠️ COMMON PITFALLS TO AVOID

- [ ] **Don't** just search for "qwen://" - also search for protocol registration
- [ ] **Don't** assume it uses OAuth - check for native login
- [ ] **Don't** ignore the installer script - protocol might be registered there
- [ ] **Don't** forget to check BOTH main and renderer processes
- [ ] **Don't** miss the second-instance handler on Windows
- [ ] **Don't** assume cookies are shared - check partition settings
- [ ] **Don't** forget to capture the COMPLETE network flow
- [ ] **Don't** just look at code - run the app and watch what happens
- [ ] **Don't** ignore error handling - it reveals expected behavior
- [ ] **Don't** forget to check for custom headers

---

## 📞 CONTACT & UPDATES

**Share findings incrementally:**
1. Start with registry export and protocol handler code
2. Then network HAR analysis
3. Then deep dive into code
4. Finally, complete flow diagram

**Update this document** if you discover new investigation paths.

**Priority:** Network traffic capture is MOST IMPORTANT - do this first!

---

## ✅ INVESTIGATION COMPLETE WHEN

- [ ] Registry export saved
- [ ] Protocol handler code found and copied
- [ ] HAR file captured and analyzed
- [ ] All 10 critical questions answered
- [ ] Complete flow diagram created
- [ ] Key findings document written
- [ ] Linux fix identified

**Good luck! Every detail matters!**
