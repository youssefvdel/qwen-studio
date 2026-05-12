# Windows Qwen Desktop App - Authentication Investigation Findings

## Date: 2026-05-12

## 1. Protocol Handler Registration

### Windows Registry
Location: \HKEY_CLASSES_ROOT\qwen\ and \HKEY_CURRENT_USER\Software\Classes\qwen\

\\\egistry
HKEY_CLASSES_ROOT\qwen
    (Default) = "URL:qwen"
    URL Protocol = ""
    shell\open\command
        (Default) = "C:\Users\youssefvdel\AppData\Local\Programs\Qwen\Qwen.exe" "%1"
\\\

**Key Finding:** The protocol is registered via \pp.setAsDefaultProtocolClient()\ in the main process, NOT through installer scripts.

### Code Location
**File:** \out\main\index.js:502-503\

\\\javascript
const SCHEME = "qwen";
const callClient = () => {
  if (!electron.app.isDefaultProtocolClient(SCHEME)) {
    electron.app.setAsDefaultProtocolClient(SCHEME);
  }
  // ...
};
\\\

---

## 2. Deep Link Handling

### Event Handlers (Lines 505-517)

\\\javascript
electron.app.on("open-url", (event, url) => {
  sendLog("openUrl", { url });
  event.preventDefault();
  console.log("open-url", url);
  handleProtocolUrl(url);
});

electron.app.on("second-instance", (_, argv) => {
  console.log("second-instance", argv);
  const urlArg = argv.find((arg) => arg.startsWith("qwen://"));
  if (urlArg) {
    handleProtocolUrl(urlArg);
  }
});
\\\

### URL Processing Function (Lines 482-500)

\\\javascript
function handleProtocolUrl(url) {
  if (!validateProtocol(url)) return;
  const parsed = new URL(url);
  const action = parsed.hostname;
  const params = Object.fromEntries(parsed.searchParams.entries());
  console.log("handleProtocolUrl", action, params);
  if (action === "open") {
    exports.mainWindow?.show();
    sendEvent("set_cookie", params.token);  // KEY LINE
  }
}

function validateProtocol(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "qwen:" && 
      ["open"].includes(parsed.hostname) && 
      (parsed.hostname !== "open" || !!parsed.searchParams.get("token"));
  } catch {
    return false;
  }
}
\\\

**Expected URL format:** \qwen://open?token=xxx\

---

## 3. Window Configuration

### Main Window Creation (Lines 568-598)

\\\javascript
exports.mainWindow = new electron.BrowserWindow({
  width: mainWindowState.width,
  height: mainWindowState.height,
  show: false,
  center: true,
  minWidth: 400,
  minHeight: 600,
  webPreferences: {
    preload: path.join(__dirname, "../preload/index.js"),
    sandbox: false,
    webviewTag: true,              // WebView enabled
    nodeIntegration: false,
    contextIsolation: true,
    nodeIntegrationInSubFrames: true,
    webSecurity: false,            // Security disabled
    allowRunningInsecureContent: true
  }
});
\\\

### Window Open Handler (Line 625-628)

\\\javascript
exports.mainWindow.webContents.setWindowOpenHandler((details) => {
  electron.shell.openExternal(details.url);
  return { action: "deny" };
});
\\\

**IMPORTANT:** All external links are opened in the default browser, NOT in-app.

---

## 4. Authentication Flow Architecture

### WebView-Based Architecture
The app uses a **WebView** to load \https://chat.qwen.ai\:

**File:** \out\renderer\assets\index-J-5aykDP.js:7072\

\\\javascript
const WEBVIEW_URL = \https://\chat.qwen.ai\;
\\\

### WebView Setup (Lines 7121-7129)

\\\javascript
"webview",
{
  src: url,
  ref: webviewRef,
  className: "webview",
  webpreferences: "nodeIntegrationInSubFrames=true, sandbox=false",
  useragent: window.navigator.userAgent + \ AliDesktop(QWENCHAT/\)\,
  preload: \ile://\\
}
\\\

---

## 5. Cookie/Token Handling

### Main Process Sends Event (Line 490)

\\\javascript
if (action === "open") {
  exports.mainWindow?.show();
  sendEvent("set_cookie", params.token);  // Sends token to renderer
}
\\\

### Event System (Lines 376-380, 59-61)

**Main Process:**
\\\javascript
const sendEvent = (type, payload) => {
  const wbs = electron.webContents.getAllWebContents();
  let sent = false;
  if (wbs.length) {
    for (let web of wbs) {
      if (!web.isDestroyed()) {
        web.send("event_from_main", { type, payload });
        sent = true;
      }
    }
  }
  if (!sent) {
    pendingEvents.push({ type, payload });
  }
};
\\\

**Preload:**
\\\javascript
electron.ipcRenderer.on("event_from_main", (_, { type, payload }) => {
  events.emit(type, payload);
});
\\\

### Event Listener in Renderer

The renderer listens to events via \window.electronAPI.on_event()\, but **NO \set_cookie\ handler was found** in the extracted code.

**CRITICAL FINDING:** The cookie is NOT set by the Electron app directly. Instead:

1. The token is sent to the renderer via IPC
2. The WebView at \https://chat.qwen.ai\ must have its own mechanism to receive this token
3. The actual cookie setting likely happens via:
   - JavaScript injection into the webview
   - OR the website polls for authentication state
   - OR there's additional code not in the asar archive

---

## 6. Network/Auth Endpoint

### Base URL
\\\
https://chat.qwen.ai
\\\

### Custom User-Agent (Line 650-651)

\\\javascript
const defaultUA = exports.mainWindow.webContents.getUserAgent();
const customUA = \\ AliDesktop(QWENCHAT/\)\;
\\\

---

## 7. Key Differences from Linux App Issues

### What Windows App Does Correctly:

1. **Protocol Registration:** Uses \pp.setAsDefaultProtocolClient('qwen')\ at runtime
2. **Deep Link Handling:** Handles BOTH \open-url\ (macOS) AND \second-instance\ (Windows/Linux)
3. **URL Validation:** Validates \qwen://open?token=xxx\ format before processing
4. **Event System:** Has robust IPC event system with pending events queue
5. **WebView Architecture:** Uses embedded WebView instead of external browser

### What Linux App Might Be Missing:

1. **Protocol client registration** - May not be calling \setAsDefaultProtocolClient\
2. **Second-instance handler** - May only handle \open-url\ (macOS specific)
3. **URL validation** - May not validate the deep link format
4. **WebView vs External Browser** - Linux app opens external browser instead of in-app WebView

---

## 8. Complete Authentication Flow

\\\
1. User clicks "Login" in the WebView (chat.qwen.ai)
   +- WebView navigates to OAuth provider

2. User authenticates with OAuth provider
   +- Provider redirects to: qwen://open?token=xxx

3. Windows intercepts qwen:// URL
   +- Routes to: "C:\...\Qwen.exe" "qwen://open?token=xxx"

4. Electron app receives URL via second-instance event
   +- Extracts token from URL
   +- Calls handleProtocolUrl("qwen://open?token=xxx")

5. Main process validates URL and extracts token
   +- Sends IPC event: sendEvent("set_cookie", token)

6. Renderer/WebView receives the token
   +- [MECHANISM NOT FOUND IN CODE]
   +- Cookie is set for chat.qwen.ai domain

7. WebView reloads/refreshes
   +- Now authenticated with cookie
   +- User sees logged-in state
\\\

---

## 9. Critical Questions - ANSWERS

1. **Does the Windows app open login in-app or external browser?**
   - **Answer:** In-app WebView (loads chat.qwen.ai directly)

2. **How is the qwen:// protocol registered?**
   - **Answer:** \pp.setAsDefaultProtocolClient(SCHEME)\ at runtime (line 503)

3. **How is the deep link received?**
   - **Answer:** BOTH \pp.on('open-url')\ AND \pp.on('second-instance')\

4. **Where is the token stored?**
   - **Answer:** Sent via IPC as \set_cookie\ event, but actual storage mechanism is in the WebView (likely cookie set by chat.qwen.ai)

5. **Does auth window share session with main window?**
   - **Answer:** Uses single WebView, no separate auth window

6. **What is the OAuth provider?**
   - **Answer:** Handled entirely by chat.qwen.ai website (could be GitHub, Google, Alibaba, email, etc.)

7. **What is the callback URL parameter?**
   - **Answer:** \qwen://open?token=xxx\

8. **What headers are required for auth?**
   - **Answer:** Custom User-Agent: \... AliDesktop(QWENCHAT/version)\

9. **After receiving token, what happens?**
   - **Answer:** IPC event \set_cookie\ is sent to renderer, WebView handles the rest

10. **What is the ONE thing Linux app is missing?**
    - **Answer:** Likely missing proper protocol client registration AND uses external browser instead of in-app WebView

---

## 10. Recommended Linux Fix

Based on findings, the Linux app should:

1. **Register protocol handler:**
   \\\javascript
   app.setAsDefaultProtocolClient('qwen')
   \\\

2. **Handle second-instance event:**
   \\\javascript
   app.on('second-instance', (event, argv) => {
     const url = argv.find(arg => arg.startsWith('qwen://'))
     if (url) handleProtocolUrl(url)
   })
   \\\

3. **Parse and validate deep links:**
   \\\javascript
   function handleProtocolUrl(url) {
     const parsed = new URL(url)
     if (parsed.protocol === 'qwen:' && parsed.hostname === 'open') {
       const token = parsed.searchParams.get('token')
       // Set cookie or send to renderer
     }
   }
   \\\

4. **Consider using WebView** instead of external browser for login

---

## 11. Files Analyzed

- \C:\Users\youssefvdel\AppData\Local\Programs\Qwen\resources\app.asar\ (extracted)
- \out\main\index.js\ (700 lines)
- \out\preload\index.js\ (61 lines)
- \out\renderer\assets\index-J-5aykDP.js\ (232KB, minified)
- Windows Registry: \HKEY_CLASSES_ROOT\qwen\

---

## 12. Tools Used

- 7-Zip (failed to extract .asar)
- @electron/asar (successfully extracted)
- PowerShell Select-String (grep equivalent)
- reg query (registry inspection)

---

**Investigation Status:** COMPLETE
**Confidence Level:** HIGH for main process flow, MEDIUM for renderer cookie handling
