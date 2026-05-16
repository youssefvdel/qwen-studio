/**
 * Electron API Bridge for Tauri
 * Injected via initialization_script to mimic Electron's preload behavior
 */
(function() {
  if (window.__electronBridgeInitialized) return;
  window.__electronBridgeInitialized = true;

  function initBridge() {
    if (!window.__TAURI__ || !window.__TAURI__.core) {
      setTimeout(initBridge, 100);
      return;
    }

    const { invoke } = window.__TAURI__.core;
    const event = window.__TAURI__.event;
    const eventListeners = {};

    event.listen('event_from_main', function(e) {
      var data = e.payload;
      var type = data.type;
      var payload = data.payload;
      if (eventListeners[type]) {
        eventListeners[type].forEach(function(cb) { cb(payload); });
      }
    });

    window.electronAPI = {
      PRELOAD_FILE_PATH: '',

      open_devtool: function() { return invoke('open_devtool'); },
      toggle_hidden_devtools: function() { return invoke('toggle_hidden_devtools'); },
      get_app_version: function() { return invoke('get_app_version'); },
      get_platform_info: function() { return invoke('get_platform_info'); },
      open_external_link: function(url) { return invoke('open_external_link', { url: url }); },
      show_native_dialog: function(options) { return invoke('show_native_dialog', { options: options }); },
      request_file_access: function(purpose, returnFile) { return invoke('request_file_access', { purpose: purpose, returnFile: returnFile }); },

      mcp_client_connect: function() {
        console.log('[ElectronBridge] >>> mcp_client_connect called');
        return invoke('mcp_client_connect').then(function(r) {
          console.log('[ElectronBridge] <<< mcp_client_connect OK');
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_connect error:', e);
          throw e;
        });
      },
      mcp_client_close: function() {
        console.log('[ElectronBridge] >>> mcp_client_close called');
        return invoke('mcp_client_close').then(function(r) {
          console.log('[ElectronBridge] <<< mcp_client_close OK');
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_close error:', e);
          throw e;
        });
      },
      mcp_client_tool_list: function(serverName) {
        console.log('[ElectronBridge] >>> mcp_client_tool_list called, serverName:', serverName);
        return invoke('mcp_client_tool_list', { params: { serverName: serverName } }).then(function(r) {
          console.log('[ElectronBridge] <<< mcp_client_tool_list OK, tools:', r.tools ? r.tools.length : 0);
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_tool_list error:', e);
          throw e;
        });
      },
      mcp_client_tool_call: function(params) {
        console.log('[ElectronBridge] >>> mcp_client_tool_call called, serverName:', params.serverName, 'toolName:', params.toolName);
        return invoke('mcp_client_tool_call', { params: params }).then(function(r) {
          console.log('[ElectronBridge] <<< mcp_client_tool_call OK');
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_tool_call error:', e);
          throw e;
        });
      },
      mcp_client_get_config: function() {
        console.log('[ElectronBridge] >>> mcp_client_get_config called');
        return invoke('mcp_client_get_config').then(function(r) {
          // Ensure qwen-core is always present and enabled
          if (!r['qwen-core']) {
            console.log('[ElectronBridge] Auto-adding qwen-core to config response');
            r['qwen-core'] = {
              command: 'npx',
              args: ['-y', 'qwen-core'],
              disabled: false,
              transportType: 'stdio',
              source: 'official',
              from: 'builtin',
              env: {}
            };
          } else {
            r['qwen-core'].disabled = false;
          }
          console.log('[ElectronBridge] <<< mcp_client_get_config OK, servers:', Object.keys(r || {}));
          console.log('[ElectronBridge] Config detail:', JSON.stringify(r, null, 2));
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_get_config error:', e);
          throw e;
        });
      },
      mcp_client_update_config: function(config) {
        console.log('[ElectronBridge] >>> mcp_client_update_config called, servers:', Object.keys(config || {}));
        console.log('[ElectronBridge] Config being sent:', JSON.stringify(config, null, 2));
        return invoke('mcp_client_update_config', { config: config }).then(function(r) {
          console.log('[ElectronBridge] <<< mcp_client_update_config OK, result servers:', Object.keys(r || {}));
          return r;
        }).catch(function(e) {
          console.error('[ElectronBridge] mcp_client_update_config error:', e);
          throw e;
        });
      },

      switch_theme: function(theme) { return invoke('switch_theme', { theme: theme }); },
      switch_ln: function(language) { return invoke('switch_ln', { ln: language }); },
      update_title_bar_for_system_theme: function(isDark) { return invoke('update_title_bar_for_system_theme', { isDark: isDark }); },

      on_event: function(type, callback) {
        if (!eventListeners[type]) { eventListeners[type] = []; }
        eventListeners[type].push(callback);
      },
      send_event: function(data) {
        event.emit('event_to_main', data);
      },

      minimize_window: function() { return invoke('minimize_window'); },
      maximize_window: function() { return invoke('maximize_window'); },
      close_window: function() { return invoke('close_window'); },
    };

    window.electron = {
      ipcRenderer: {
        send: function(channel) {
          var args = Array.prototype.slice.call(arguments, 1);
          event.emit(channel, args);
        },
        invoke: function(channel) {
          var args = Array.prototype.slice.call(arguments, 1);
          return invoke(channel, Object.fromEntries(args.map(function(a, i) { return [String(i), a]; })));
        },
        on: function(channel, func) {
          event.listen(channel, function(e) { func(e.payload); });
        }
      }
    };

    console.log('[ElectronBridge] window.electronAPI exposed with', Object.keys(window.electronAPI).length, 'methods');

    // Listen for MCP config changes from web app
    window.addEventListener('mcp-config-changed', function(e) {
      console.log('[ElectronBridge] mcp-config-changed event fired');
      console.log('[ElectronBridge] Event detail:', JSON.stringify(e.detail, null, 2));
    });
  }

  initBridge();
})();
