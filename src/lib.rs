mod dialogs;
mod events;
mod mcp;
mod settings;
mod tray;
mod window;

use tauri::Manager;

#[cfg(target_os = "linux")]
fn setup_gtk_drag_drop(_app: &tauri::AppHandle) {
    log::info!("[DragDrop] Using Tauri built-in drag-drop (WebKitGTK)");
    log::info!("[DragDrop] Events will be forwarded via Tauri window events");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            unsafe { std::env::set_var("GDK_BACKEND", "x11") };
        }
    }

    // Init script is now built by window::build_init_script() for consistency
    // across all windows (main and additional)

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
.plugin(tauri_plugin_clipboard_manager::init())
// .plugin(tauri_plugin_deep_link::init()) // Disabled: auth handled in-WebView now
        // Single-instance plugin removed to allow multiple windows
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_mcp_bridge::init())
        .setup(move |app| {
            use std::sync::Arc;
            use tokio::sync::Mutex;
            let state: mcp::McpState = Arc::new(Mutex::new(None));
            app.manage(state);
            events::setup_event_forwarding(app.handle());

            // Warm the MCP bridge up at startup so per-server health
            // ("GREEN <name>" / "RED <name>: <why>") lands in the log without
            // needing someone to open the MCP settings panel first. Failures are
            // logged, never fatal — the app must still start with a broken MCP.
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    log::info!("[MCP] Startup warm-up: connecting configured servers");
                    match mcp::ensure_bridge(&handle).await {
                        Ok(_) => log::info!("[MCP] Startup warm-up finished"),
                        Err(e) => log::error!("[MCP] Startup warm-up failed: {}", e),
                    }
                });
            }

            // Deep-link disabled: auth now handled inside WebView (no external browser)
            // #[cfg(desktop)]
            // {
            //     let handle = app.handle().clone();
            //     tauri::async_runtime::spawn(async move {
            //         window::setup_deep_link(&handle).await;
            //     });
            // }

            // Clear ALL storage and inject qwen-core BEFORE page loads
            let combined_script = window::build_init_script();

            let icon_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("icons")
                .join("icon.png");
            let icon = if icon_path.exists() {
                let bytes = std::fs::read(&icon_path).ok();
                bytes.and_then(|b| {
                    image::load_from_memory(&b)
                        .ok()
                        .map(|img| img.into_rgba8())
                        .map(|img| {
                            let (w, h) = img.dimensions();
                            tauri::image::Image::new_owned(img.into_raw(), w, h)
                        })
                })
            } else {
                None
            };

            let url = "https://chat.qwen.ai".parse().unwrap();
            let window_builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External(url),
            )
            .title("Qwen Studio")
            .inner_size(1280.0, 840.0)
            .min_inner_size(400.0, 600.0)
            .center()
            .resizable(true)
            .decorations(true)
            .accept_first_mouse(false)
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AliDesktop(QWENCHAT/2.2.3)")
            .initialization_script(&combined_script)
            .on_navigation(|url| {
                // Allow all navigation within auth-related domains
                let url_str = url.to_string();
                let auth_domains = [
                    "chat.qwen.ai",
                    "accounts.qwen.ai",
                    "account.qwen.ai",
                    "login.qwen.ai",
                    "auth.qwen.ai",
                    "oauth.qwen.ai",
                    "passport.alibaba.com",
                    "login.alibaba.com",
                    "signin.alibaba.com",
                    "accounts.alibaba.com",
                    "account.alibaba.com",
                    "login.aliyun.com",
                    "account.aliyun.com",
                    "signin.aliyun.com",
                ];
                
                let is_auth_domain = auth_domains.iter().any(|domain| url_str.contains(domain));
                let is_auth_path = url_str.contains("/login") 
                    || url_str.contains("/auth") 
                    || url_str.contains("/oauth")
                    || url_str.contains("/callback")
                    || url_str.contains("/signin")
                    || url_str.contains("/signup");
                
                // Allow navigation if it's auth-related or back to chat.qwen.ai
                if is_auth_domain || is_auth_path || url_str.starts_with("https://chat.qwen.ai") {
                    true
                } else {
                    // For non-auth external URLs, they'll be handled by open_external_link
                    url_str.starts_with("https://") || url_str.starts_with("http://")
                }
            });

            let _main_window = if let Some(icon) = icon {
                window_builder.icon(icon).unwrap().build()?
            } else {
                window_builder.build()?
            };

            log::info!("[App] Main window created with electron bridge");

            #[cfg(target_os = "linux")]
            {
                setup_gtk_drag_drop(app.handle());
            }

            tray::setup_tray(app.handle())?;
            log::info!("[App] System tray initialized");

            // Add menu button to Tauri's existing GTK HeaderBar on Linux
            #[cfg(target_os = "linux")]
            {
                use gtk::prelude::{BinExt, Cast, ContainerExt, CssProviderExt, GtkMenuItemExt, GtkWindowExt, HeaderBarExt, MenuButtonExt, MenuShellExt, WidgetExt};
                use gtk::{CssProvider, EventBox, Label, Menu, MenuButton, STYLE_PROVIDER_PRIORITY_APPLICATION};

                // Style the HeaderBar
                let css = r#"
                    headerbar, .titlebar {
                        min-height: 38px;
                        padding: 0 6px;
                        background: #2c2c2c;
                        color: #ffffff;
                    }
                    headerbar button, .titlebar button {
                        min-height: 28px;
                        min-width: 32px;
                        padding: 4px 6px;
                        background: transparent;
                        color: #ffffff;
                        border-radius: 4px;
                    }
                    headerbar button:hover, .titlebar button:hover {
                        background: rgba(255,255,255,0.12);
                    }
                    #menu-btn-label {
                        font-size: 16px;
                        padding: 0 4px;
                    }
                "#;
                let provider = CssProvider::new();
                if let Err(e) = provider.load_from_data(css.as_bytes()) {
                    log::warn!("[Titlebar] CSS load failed: {:?}", e);
                } else {
                    gtk::StyleContext::add_provider_for_screen(
                        &gtk::gdk::Screen::default().expect("no screen"),
                        &provider,
                        STYLE_PROVIDER_PRIORITY_APPLICATION,
                    );
                }

                if let Some(window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    if let Ok(gtk_window) = window.gtk_window() {
                        // Get Tauri's existing titlebar (EventBox wrapping HeaderBar)
                        if let Some(titlebar_widget) = gtk_window.titlebar() {
                            // Tauri wraps HeaderBar in an EventBox
                            if let Ok(event_box) = titlebar_widget.downcast::<EventBox>() {
                                if let Some(child) = event_box.child() {
                                    if let Ok(header_bar) = child.downcast::<gtk::HeaderBar>() {
                                        // Build menu
                                        let menu = Menu::new();

                                        let file_item = gtk::MenuItem::with_label("File");
                                        let file_menu = Menu::new();
                                        let minimize_mi = gtk::MenuItem::with_label("Minimize");
                                        let maximize_mi = gtk::MenuItem::with_label("Maximize");
                                        let quit_mi = gtk::MenuItem::with_label("Quit");
                                        file_menu.append(&minimize_mi);
                                        file_menu.append(&maximize_mi);
                                        file_menu.append(&quit_mi);
                                        file_item.set_submenu(Some(&file_menu));
                                        menu.append(&file_item);

                                        let edit_item = gtk::MenuItem::with_label("Edit");
                                        let edit_menu = Menu::new();
                                        let undo_mi = gtk::MenuItem::with_label("Undo");
                                        let redo_mi = gtk::MenuItem::with_label("Redo");
                                        let cut_mi = gtk::MenuItem::with_label("Cut");
                                        let copy_mi = gtk::MenuItem::with_label("Copy");
                                        let paste_mi = gtk::MenuItem::with_label("Paste");
                                        let select_all_mi = gtk::MenuItem::with_label("Select All");
                                        edit_menu.append(&undo_mi);
                                        edit_menu.append(&redo_mi);
                                        edit_menu.append(&cut_mi);
                                        edit_menu.append(&copy_mi);
                                        edit_menu.append(&paste_mi);
                                        edit_menu.append(&select_all_mi);
                                        edit_item.set_submenu(Some(&edit_menu));
                                        menu.append(&edit_item);

                                        let view_item = gtk::MenuItem::with_label("View");
                                        let view_menu = Menu::new();
                                        let devtools_mi = gtk::MenuItem::with_label("Toggle DevTools");
                                        let reload_mi = gtk::MenuItem::with_label("Reload");
                                        view_menu.append(&devtools_mi);
                                        view_menu.append(&reload_mi);
                                        view_item.set_submenu(Some(&view_menu));
                                        menu.append(&view_item);

                                        let win_mi = gtk::MenuItem::with_label("Window");
                                        let win_menu = Menu::new();
                                        let new_window_mi = gtk::MenuItem::with_label("New Window");
                                        let fullscreen_mi = gtk::MenuItem::with_label("Toggle Fullscreen");
                                        win_menu.append(&new_window_mi);
                                        win_menu.append(&fullscreen_mi);
                                        win_mi.set_submenu(Some(&win_menu));
                                        menu.append(&win_mi);

                                        let help_item = gtk::MenuItem::with_label("Help");
                                        let help_menu = Menu::new();
                                        let docs_mi = gtk::MenuItem::with_label("Documentation");
                                        let github_mi = gtk::MenuItem::with_label("GitHub");
                                        let about_mi = gtk::MenuItem::with_label("About");
                                        let update_mi = gtk::MenuItem::with_label("Check for Updates");
                                        help_menu.append(&docs_mi);
                                        help_menu.append(&github_mi);
                                        help_menu.append(&update_mi);
                                        help_menu.append(&about_mi);
                                        help_item.set_submenu(Some(&help_menu));
                                        menu.append(&help_item);

                                        menu.show_all();

                                        // Menu button
                                        let menu_btn = MenuButton::new();
                                        menu_btn.set_popup(Some(&menu));
                                        let menu_label = Label::new(Some("☰"));
                                        menu_label.set_widget_name("menu-btn-label");
                                        menu_btn.add(&menu_label);
                                        menu_btn.show_all();

                                        // Add menu button to existing HeaderBar
                                        header_bar.pack_start(&menu_btn);
                                        header_bar.show_all();

                                        // Menu item signals
                                        let w = window.clone();
                                        minimize_mi.connect_activate(move |_| { let _ = w.minimize(); });

                                        let w = window.clone();
                                        maximize_mi.connect_activate(move |_| {
                                            if w.is_maximized().unwrap_or(false) { let _ = w.unmaximize(); }
                                            else { let _ = w.maximize(); }
                                        });

                                        let ah = app_handle.clone();
                                        quit_mi.connect_activate(move |_| { ah.exit(0); });

                                        let w = window.clone();
                                        devtools_mi.connect_activate(move |_| {
                                            if w.is_devtools_open() { w.close_devtools(); } else { w.open_devtools(); }
                                        });

                                        let w = window.clone();
                                        reload_mi.connect_activate(move |_| { let _ = w.eval("location.reload();"); });

                                        let w = window.clone();
                                        fullscreen_mi.connect_activate(move |_| {
                                            let f = w.is_fullscreen().unwrap_or(false);
                                            let _ = w.set_fullscreen(!f);
                                        });

                                        let ah_new = app_handle.clone();
                                        new_window_mi.connect_activate(move |_| {
                                            let a = ah_new.clone();
                                            tauri::async_runtime::spawn(async move {
                                                let _ = window::create_new_window(a).await;
                                            });
                                        });

                                        docs_mi.connect_activate(|_| { let _ = open::that("https://chat.qwen.ai"); });
                                        github_mi.connect_activate(|_| { let _ = open::that("https://github.com/youssefvdel/qwen-studio"); });

                                        let ah = app_handle.clone();
                                        update_mi.connect_activate(move |_| {
                                            let a = ah.clone();
                                            tauri::async_runtime::spawn(async move { check_for_updates(&a, true).await; });
                                        });

                                        let ver = env!("CARGO_PKG_VERSION").to_string();
                                        let w = window.clone();
                                        about_mi.connect_activate(move |_| {
                                            let _ = w.eval(format!(r#"alert("Qwen Studio v{}");"#, ver));
                                        });

                                        log::info!("[Titlebar] Menu button added to existing HeaderBar");
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check for updates on startup (delayed to ensure webview is ready)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tokio::time::{sleep, Duration};
                sleep(Duration::from_secs(3)).await;
                check_for_updates(&app_handle, false).await;
            });

            // Periodic update check every 4 hours
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tokio::time::{sleep, Duration};
                sleep(Duration::from_secs(4 * 60 * 60)).await;
                loop {
                    check_for_updates(&app_handle, false).await;
                    sleep(Duration::from_secs(4 * 60 * 60)).await;
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
            window::create_new_window,
            window::read_clipboard_image,
            events::webview_loaded,
            install_update_with_progress,
            get_update_info,
            restart_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } = event
            {
                // Only the main window minimizes to tray; additional windows close normally
                if label == "main" {
                    api.prevent_close();
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                // Other windows (window-1, window-2, etc.) close naturally
            }
        });
}

/// Compares two semver version strings (e.g. "2.2.3").
/// Returns:  -1 if a < b,  0 if a == b,  1 if a > b
/// Handles versions with missing parts (e.g. "2.2" is treated as "2.2.0")
fn compare_versions(a: &str, b: &str) -> i8 {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    let len = std::cmp::max(va.len(), vb.len());
    for i in 0..len {
        let pa = *va.get(i).unwrap_or(&0);
        let pb = *vb.get(i).unwrap_or(&0);
        if pa < pb { return -1; }
        if pa > pb { return 1; }
    }
    0
}

async fn check_for_updates(app: &tauri::AppHandle, manual: bool) {
    use tauri_plugin_updater::UpdaterExt;
    use tauri::Emitter;

    let current_version = env!("CARGO_PKG_VERSION");

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("[Updater] Updater not available: {}", e);
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let remote_version = &update.version;
            log::info!(
                "[Updater] Remote version: {}, Local version: {}",
                remote_version,
                current_version
            );

            // Safety guard: only notify if remote is strictly NEWER
            // This prevents false positives if latest.json has same or older version
            if compare_versions(remote_version, current_version) <= 0 {
                log::info!(
                    "[Updater] Remote version {} is not newer than local {}. Skipping notification.",
                    remote_version,
                    current_version
                );
                return;
            }

            // Only show banner/notification for MANUAL checks
            // Auto-checks (startup + periodic) just log silently
            if manual {
                log::info!("[Updater] Update available (manual check): {}", remote_version);
                let version = remote_version.clone();
                let notes = update
                    .body
                    .as_deref()
                    .unwrap_or("No release notes")
                    .replace('\n', "\\n")
                    .replace('"', "\\\"");

                let _ = app.emit(
                    "update-available",
                    serde_json::json!({
                        "version": version,
                        "notes": notes
                    }),
                );
            } else {
                log::info!(
                    "[Updater] Update available (auto-check): {}. Banner suppressed — go to Settings > Updates to install.",
                    remote_version
                );
            }
        }
        Ok(None) => {
            if manual {
                log::info!("[Updater] Already up to date (v{})", current_version);
            }
        }
        Err(e) => {
            log::error!("[Updater] Update check failed: {}", e);
        }
    }
}

#[tauri::command]
async fn install_update_with_progress(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    use tauri::Emitter;

    let current_version = env!("CARGO_PKG_VERSION");

    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    // Safety guard: refuse to install if remote is not newer
    if compare_versions(&update.version, current_version) <= 0 {
        return Err(format!(
            "Remote version {} is not newer than current version {}. You're already up to date!",
            update.version, current_version
        ));
    }

    log::info!("[Updater] Downloading update {} → {}", current_version, update.version);

    let mut downloaded_bytes = 0u64;
    let mut total_bytes = 0u64;

    let bytes = update
        .download(
            |chunk_len, total| {
                downloaded_bytes += chunk_len as u64;
                if total_bytes == 0 {
                    total_bytes = total.unwrap_or(0);
                }
                let pct = if total_bytes > 0 {
                    (downloaded_bytes as f64 / total_bytes as f64) * 100.0
                } else {
                    0.0
                };
                let dl_mb = downloaded_bytes as f64 / 1048576.0;
                let total_mb = total_bytes as f64 / 1048576.0;
                let _ = app.emit(
                    "update-progress",
                    serde_json::json!({
                        "phase": "download",
                        "progress": pct,
                        "downloaded": format!("{:.1}", dl_mb),
                        "total": format!("{:.1}", total_mb),
                        "status": format!("Downloading... {:.0}%", pct)
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    log::info!("[Updater] Download complete, installing...");

    let _ = app.emit(
        "update-progress",
        serde_json::json!({
            "phase": "install",
            "progress": 100.0,
            "downloaded": "",
            "total": "",
            "status": "Installing..."
        }),
    );

    update.install(bytes).map_err(|e| e.to_string())?;

    log::info!("[Updater] Update installed successfully");
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[Updater] Restarting app");
    app.restart();
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    current_version: String,
    available: bool,
    latest_version: String,
    release_notes: String,
}

#[tauri::command]
async fn get_update_info(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;

    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let remote_version = &update.version;
            // Safety guard: only report as available if remote is strictly NEWER
            if compare_versions(remote_version, &current_version) <= 0 {
                log::info!(
                    "[Updater] get_update_info: Remote {} is not newer than local {}. Reporting up-to-date.",
                    remote_version,
                    current_version
                );
                Ok(UpdateInfo {
                    current_version: current_version.clone(),
                    available: false,
                    latest_version: current_version,
                    release_notes: String::new(),
                })
            } else {
                Ok(UpdateInfo {
                    current_version: current_version.clone(),
                    available: true,
                    latest_version: update.version.clone(),
                    release_notes: update
                        .body
                        .as_deref()
                        .unwrap_or("No release notes")
                        .to_string(),
                })
            }
        }
        Ok(None) => Ok(UpdateInfo {
            current_version: current_version.clone(),
            available: false,
            latest_version: current_version,
            release_notes: String::new(),
        }),
        Err(e) => Err(e.to_string()),
    }
}
