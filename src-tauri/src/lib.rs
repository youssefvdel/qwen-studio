mod mcp;
mod settings;
mod window;
mod events;
mod dialogs;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let electron_bridge = include_str!("../electron-bridge.js");

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            use std::sync::Arc;
            use tokio::sync::Mutex;
            let state: mcp::McpState = Arc::new(Mutex::new(None));
            app.manage(state);
            events::setup_event_forwarding(app.handle());

            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    window::setup_deep_link(&handle).await;
                });
            }

            let url = "https://chat.qwen.ai".parse().unwrap();
            let _main_window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url),
            )
            .title("Qwen Studio")
            .inner_size(1280.0, 840.0)
            .min_inner_size(400.0, 600.0)
            .center()
            .resizable(true)
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AliDesktop(QWENCHAT/2.2.0)")
            .initialization_script(electron_bridge)
            .build()?;

            log::info!("[App] Main window created with electron bridge");

            // Force web app to use Tauri's MCP config from settings.json (overrides web app's IndexedDB cache)
            let window_handle = _main_window.clone();
            tauri::async_runtime::spawn(async move {
                // Wait for page to fully load
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                
                log::info!("[MCP] Injecting qwen-core into web app IndexedDB...");
                let inject_script = r#"
                    (async () => {
                        try {
                            console.log('[MCP] Starting IndexedDB injection...');
                            
                            const qwenCoreConfig = {
                                command: "npx",
                                args: ["-y", "qwen-core"],
                                disabled: false,
                                transportType: "stdio",
                                source: "official",
                                from: "builtin",
                                env: {}
                            };
                            
                            // Try to open common MCP databases and inject qwen-core
                            const dbNames = ['mcp', 'MCP', 'mcp-config', 'mcpConfig', 'mcp_config', 'qwen-mcp', 'qwen', 'config', 'settings', 'electron-settings'];
                            
                            for (const dbName of dbNames) {
                                try {
                                    const db = await new Promise((resolve, reject) => {
                                        const req = indexedDB.open(dbName);
                                        req.onsuccess = () => resolve(req.result);
                                        req.onerror = () => reject(req.error);
                                    });
                                    
                                    console.log('[MCP] Opened database:', dbName, 'stores:', Array.from(db.objectStoreNames));
                                    
                                    for (const storeName of db.objectStoreNames) {
                                        try {
                                            const tx = db.transaction(storeName, 'readwrite');
                                            const store = tx.objectStore(storeName);
                                            
                                            // Try to add qwen-core config
                                            store.put({ name: 'qwen-core', config: qwenCoreConfig, enabled: true }, 'qwen-core');
                                            console.log('[MCP] Added qwen-core to', dbName, '/', storeName);
                                        } catch (e) {
                                            console.log('[MCP] Failed to add to', storeName, ':', e.message);
                                        }
                                    }
                                } catch (e) {
                                    // Database doesn't exist, skip
                                }
                            }
                            
                            // Also try to set in localStorage
                            try {
                                const mcpConfig = localStorage.getItem('mcp_config') || '{}';
                                const parsed = JSON.parse(mcpConfig);
                                parsed['qwen-core'] = qwenCoreConfig;
                                localStorage.setItem('mcp_config', JSON.stringify(parsed));
                                console.log('[MCP] Set qwen-core in localStorage mcp_config');
                            } catch (e) {
                                console.log('[MCP] localStorage mcp_config failed:', e.message);
                            }
                            
                            // Dispatch events
                            const tauriConfig = await window.electronAPI.mcp_client_get_config();
                            for (let i = 0; i < 5; i++) {
                                window.dispatchEvent(new CustomEvent('mcp-config-changed', { detail: tauriConfig }));
                                await new Promise(r => setTimeout(r, 300));
                            }
                            
                            console.log('[MCP] Injection complete');
                        } catch (e) {
                            console.error('[MCP] Injection failed:', e);
                        }
                    })();
                "#;
                
                if let Err(e) = window_handle.eval(inject_script) {
                    log::warn!("[MCP] Failed to inject qwen-core: {}", e);
                } else {
                    log::info!("[MCP] qwen-core injection script executed");
                }
                
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
                
                log::info!("[MCP] Injecting startup config sync...");
                let script = r#"
                    (async () => {
                        try {
                            console.log('[MCP] Getting config from Tauri...');
                            const tauriConfig = await window.electronAPI.mcp_client_get_config();
                            console.log('[MCP] Tauri config servers:', Object.keys(tauriConfig || {}));
                            console.log('[MCP] Tauri config detail:', JSON.stringify(tauriConfig, null, 2));
                            
                            if (tauriConfig && Object.keys(tauriConfig).length > 0) {
                                console.log('[MCP] Updating web app with Tauri config...');
                                const result = await window.electronAPI.mcp_client_update_config(tauriConfig);
                                console.log('[MCP] Config update result:', Object.keys(result || {}));
                                
                                // Trigger UI refresh multiple times
                                for (let i = 0; i < 5; i++) {
                                    window.dispatchEvent(new CustomEvent('mcp-config-changed', { detail: tauriConfig }));
                                    await new Promise(r => setTimeout(r, 300));
                                }
                                
                                console.log('[MCP] Config sync complete');
                            } else {
                                console.log('[MCP] No config to sync');
                            }
                        } catch (err) {
                            console.error('[MCP] Failed to sync config:', err);
                        }
                    })();
                "#;
                
                if let Err(e) = window_handle.eval(script) {
                    log::error!("[MCP] Startup config sync failed: {}", e);
                } else {
                    log::info!("[MCP] Startup config sync injected");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::get_app_version,
            window::get_platform_info,
            window::open_devtool,
            window::toggle_hidden_devtools,
            window::minimize_window,
            window::maximize_window,
            window::close_window,
            window::open_external_link,
            dialogs::show_native_dialog,
            dialogs::request_file_access,
            mcp::mcp_client_connect,
            mcp::mcp_client_close,
            mcp::mcp_client_tool_list,
            mcp::mcp_client_tool_call,
            mcp::mcp_client_get_config,
            mcp::mcp_client_update_config,
            settings::get_setting,
            settings::set_setting,
            window::switch_theme,
            window::switch_ln,
            window::update_title_bar_for_system_theme,
            window::get_language,
            events::webview_loaded,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
