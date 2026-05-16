/**
 * Tauri Bridge — Electron API compatibility layer
 *
 * This script injects `window.electronAPI` and `window.electron` into the
 * webview context, matching the Electron preload API that chat.qwen.ai expects.
 * All IPC calls are translated to Tauri invoke() calls.
 */

(function () {
  if (window.__qwenBridgeInitialized) return;
  window.__qwenBridgeInitialized = true;

  const { invoke } = window.__TAURI__.core;
  const { getCurrentWindow } = window.__TAURI__.window;
  const { listen, emit } = window.__TAURI__.event;

  const eventListeners = {};

  function onEventFromMain(callback) {
    listen("event_from_main", (event) => {
      const { type, payload } = event.payload;
      if (eventListeners[type]) {
        eventListeners[type].forEach((cb) => cb(payload));
      }
    });
  }

  const electronAPI = {
    PRELOAD_FILE_PATH: "",

    // App Management
    open_devtool: () => invoke("open_devtool"),
    toggle_hidden_devtools: () => invoke("toggle_hidden_devtools"),
    get_app_version: () => invoke("get_app_version"),
    get_platform_info: () => invoke("get_platform_info"),
    open_external_link: (url) => invoke("open_external_link", { url }),
    show_native_dialog: (options) => invoke("show_native_dialog", { options }),
    request_file_access: (purpose, returnFile) =>
      invoke("request_file_access", { purpose, returnFile }),

    // MCP Methods (matching official app command names)
    mcp_client_connect: () => Promise.resolve(), // MCP auto-initialized in Tauri
    mcp_client_close: () => Promise.resolve(),
    mcp_client_tool_list: (serverName) =>
      invoke("mcp_client_tool_list", { serverName }),
    mcp_client_tool_call: (params) =>
      invoke("mcp_client_tool_call", { params }),
    mcp_client_get_config: () => invoke("mcp_client_get_config"),
    mcp_client_update_config: (config) =>
      invoke("mcp_client_update_config", { config }),

    // Theme & Localization
    switch_theme: (theme) => invoke("switch_theme", { theme }),
    switch_ln: (language) => invoke("switch_ln", { ln: language }),
    update_title_bar_for_system_theme: (isDark) =>
      invoke("update_title_bar_for_system_theme", { isDark }),

    // Event System
    on_event: (type, callback) => {
      if (!eventListeners[type]) {
        eventListeners[type] = [];
      }
      eventListeners[type].push(callback);
    },
    send_event: (data) => {
      emit("event_to_main", data);
    },
  };

  const electron = {
    ipcRenderer: {
      send: (channel, ...args) => emit(channel, args),
      invoke: (channel, ...args) => invoke(channel, Object.fromEntries(args.map((a, i) => [String(i), a]))),
      on: (channel, func) => {
        listen(channel, (event) => func(event.payload));
      },
    },
  };

  window.electronAPI = electronAPI;
  window.electron = electron;

  onEventFromMain(() => {});

  console.log("[TauriBridge] electronAPI and electron exposed");
})();
