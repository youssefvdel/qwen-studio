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
                
                log::info!("[MCP] Aggressive IndexedDB injection...");
                let inject_script = r#"
                    (async () => {
                        try {
                            console.log('[MCP] === Starting aggressive IndexedDB injection ===');
                            
                            const qwenCoreConfig = {
                                command: "npx",
                                args: ["-y", "qwen-core"],
                                disabled: false,
                                transportType: "stdio",
                                source: "official",
                                from: "builtin",
                                env: {}
                            };
                            
                            // Step 1: Enumerate ALL IndexedDB databases
                            if (window.indexedDB && window.indexedDB.databases) {
                                const dbs = await window.indexedDB.databases();
                                console.log('[MCP] Found', dbs.length, 'IndexedDB databases:', dbs.map(d => d.name));
                                
                                for (const dbInfo of dbs) {
                                    const dbName = dbInfo.name;
                                    if (!dbName) continue;
                                    
                                    try {
                                        const db = await new Promise((resolve, reject) => {
                                            const req = indexedDB.open(dbName);
                                            req.onsuccess = () => resolve(req.result);
                                            req.onerror = () => reject(req.error);
                                        });
                                        
                                        console.log('[MCP] Database:', dbName, 'version:', db.version, 'stores:', Array.from(db.objectStoreNames));
                                        
                                        for (const storeName of db.objectStoreNames) {
                                            try {
                                                const tx = db.transaction(storeName, 'readwrite');
                                                const store = tx.objectStore(storeName);
                                                
                                                // Get all keys to understand structure
                                                const keys = await new Promise((resolve, reject) => {
                                                    const req = store.getAllKeys();
                                                    req.onsuccess = () => resolve(req.result);
                                                    req.onerror = () => reject(req.error);
                                                });
                                                console.log('[MCP] Store', storeName, 'keys:', keys);
                                                
                                                // Try multiple injection patterns
                                                const injections = [
                                                    { key: 'qwen-core', value: qwenCoreConfig },
                                                    { key: 'qwen-core', value: { ...qwenCoreConfig, enabled: true } },
                                                    { key: 'mcpServers', value: { 'qwen-core': qwenCoreConfig } },
                                                    { key: 'mcp_config', value: { 'qwen-core': qwenCoreConfig } },
                                                    { key: 'config', value: { mcpServers: { 'qwen-core': qwenCoreConfig } } },
                                                ];
                                                
                                                for (const inj of injections) {
                                                    try {
                                                        store.put(inj.value, inj.key);
                                                        console.log('[MCP] Injected into', dbName, '/', storeName, 'key:', inj.key);
                                                    } catch (e) {
                                                        // Key might not exist, try add
                                                    }
                                                }
                                                
                                                await new Promise((resolve, reject) => {
                                                    tx.oncomplete = () => resolve();
                                                    tx.onerror = () => reject(tx.error);
                                                });
                                            } catch (e) {
                                                console.log('[MCP] Failed store', storeName, ':', e.message);
                                            }
                                        }
                                    } catch (e) {
                                        console.log('[MCP] Failed database', dbName, ':', e.message);
                                    }
                                }
                            }
                            
                            // Step 2: Try to create new MCP database
                            try {
                                const newDb = await new Promise((resolve, reject) => {
                                    const req = indexedDB.open('mcp-config', 1);
                                    req.onupgradeneeded = (event) => {
                                        const db = event.target.result;
                                        if (!db.objectStoreNames.contains('servers')) {
                                            db.createObjectStore('servers');
                                        }
                                        if (!db.objectStoreNames.contains('config')) {
                                            db.createObjectStore('config');
                                        }
                                    };
                                    req.onsuccess = () => resolve(req.result);
                                    req.onerror = () => reject(req.error);
                                });
                                
                                const tx = newDb.transaction(['servers', 'config'], 'readwrite');
                                tx.objectStore('servers').put(qwenCoreConfig, 'qwen-core');
                                tx.objectStore('config').put({ 'qwen-core': qwenCoreConfig }, 'mcpServers');
                                console.log('[MCP] Created new mcp-config database with qwen-core');
                            } catch (e) {
                                console.log('[MCP] Failed to create new database:', e.message);
                            }
                            
                            // Step 3: Set in localStorage with multiple keys
                            const localStorageKeys = ['mcp_config', 'mcpConfig', 'mcp-config', 'mcpServers', 'mcp_servers', 'electron-settings', 'settings'];
                            for (const key of localStorageKeys) {
                                try {
                                    const existing = localStorage.getItem(key);
                                    let parsed = existing ? JSON.parse(existing) : {};
                                    
                                    // Handle different structures
                                    if (parsed.mcpServers) {
                                        parsed.mcpServers['qwen-core'] = qwenCoreConfig;
                                    } else if (parsed.servers) {
                                        parsed.servers['qwen-core'] = qwenCoreConfig;
                                    } else {
                                        parsed['qwen-core'] = qwenCoreConfig;
                                    }
                                    
                                    localStorage.setItem(key, JSON.stringify(parsed));
                                    console.log('[MCP] Set qwen-core in localStorage:', key);
                                } catch (e) {
                                    console.log('[MCP] Failed localStorage', key, ':', e.message);
                                }
                            }
                            
                            console.log('[MCP] === Injection complete, reloading page ===');
                            
                            // Step 4: Reload page so web app picks up changes
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000);
                            
                        } catch (e) {
                            console.error('[MCP] Injection failed:', e);
                        }
                    })();
                "#;
                
                if let Err(e) = window_handle.eval(inject_script) {
                    log::warn!("[MCP] Failed to inject qwen-core: {}", e);
                } else {
                    log::info!("[MCP] Aggressive injection script executed");
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
