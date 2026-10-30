use tauri::{Emitter, Manager};
use url::Url;
use std::sync::atomic::{AtomicU32, Ordering};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

// Counter for unique window labels
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

/// Creates a new webview window with a unique label, loading chat.qwen.ai.
/// This allows the app to have multiple independent windows.
#[tauri::command]
pub async fn create_new_window(app: tauri::AppHandle) -> Result<String, String> {
    let id = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("window-{}", id);

    let url = "https://chat.qwen.ai".parse::<url::Url>().unwrap();
    let init_script = build_init_script();

    let window_builder = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::External(url),
    )
    .title("Qwen Studio")
    .inner_size(1280.0, 840.0)
    .min_inner_size(400.0, 600.0)
    .center()
    .resizable(true)
    .decorations(true)
    .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 AliDesktop(QWENCHAT/2.2.3)")
    .initialization_script(&init_script)
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

    window_builder.build().map_err(|e| e.to_string())?;

    log::info!("[Window] New window created: {}", label);
    Ok(label)
}

/// Builds the combined initialization script for all windows.
/// This ensures every window gets the same bridge, zoom, and settings functionality.
pub fn build_init_script() -> String {
    let electron_bridge = include_str!("../electron-bridge.js");

    let pre_load_script = r#"
        (function() {
            // Only run MCP injection on main chat pages, not on login/auth pages
            var hostname = window.location.hostname;
            var pathname = window.location.pathname;
            var isLoginPage = pathname.includes('login') || pathname.includes('auth') || pathname.includes('callback') || pathname.includes('oauth');
            
            if (hostname !== 'chat.qwen.ai' || isLoginPage) {
                return;
            }

            try {
                // Default qwen-core MCP server entry
                var qwenCoreEntry = {
                    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                    name: "qwen-core",
                    description: "Essential tools for file operations, search, and bash execution.",
                    type: "stdio",
                    params: { command: "npx", args: ["-y", "qwen-core"] },
                    enabled: true,
                    default: false,
                    connectionStatus: "available",
                    errorMessage: "",
                    tools: []
                };

                // Read existing MCP servers from localStorage (preserve user-added servers)
                var existing = null;
                try {
                    var raw = localStorage.getItem("LOCAL_MCP_SERVER");
                    if (raw) {
                        existing = JSON.parse(raw);
                        if (!Array.isArray(existing)) existing = null;
                    }
                } catch(e) {
                    existing = null;
                }

                if (existing && existing.length > 0) {
                    // Merge: ensure qwen-core is present, keep all user-added servers
                    var hasQwenCore = false;
                    for (var i = 0; i < existing.length; i++) {
                        if (existing[i].name === "qwen-core") {
                            hasQwenCore = true;
                            // Update qwen-core entry with latest config (preserve enabled state)
                            qwenCoreEntry.enabled = existing[i].enabled !== false;
                            existing[i] = qwenCoreEntry;
                            break;
                        }
                    }
                    if (!hasQwenCore) {
                        existing.unshift(qwenCoreEntry);
                    }
                    localStorage.setItem("LOCAL_MCP_SERVER", JSON.stringify(existing));
                } else {
                    // No existing config — write default with just qwen-core
                    localStorage.setItem("LOCAL_MCP_SERVER", JSON.stringify([qwenCoreEntry]));
                }
            } catch(e) {
                console.error("[PreLoad] MCP config injection failed:", e);
            }
        })();
    "#;

    let zoom_script = r##"
        (function() {
            let zoomLevel = 1.0;
            const ZOOM_STEP = 0.1;
            const MIN_ZOOM = 0.5;
            const MAX_ZOOM = 2.0;

            document.addEventListener('wheel', function(e) {
                if (e.ctrlKey) {
                    e.preventDefault();
                    if (e.deltaY < 0) {
                        zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
                    } else {
                        zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
                    }
                    document.body.style.zoom = zoomLevel;
                }
            }, { passive: false, capture: true });

            document.addEventListener('keydown', function(e) {
                if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
                    e.preventDefault();
                    zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
                    document.body.style.zoom = zoomLevel;
                }
                if (e.ctrlKey && e.key === '-') {
                    e.preventDefault();
                    zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
                    document.body.style.zoom = zoomLevel;
                }
                if (e.ctrlKey && (e.key === '0' || e.key === ')')) {
                    e.preventDefault();
                    zoomLevel = 1.0;
                    document.body.style.zoom = zoomLevel;
                }
            });
        })();
    "##;

    let settings_script = r##"
        (function() {
            var injected = false;

            function svgIcon(iconId, size) {
                size = size || 20;
                return '<svg width="' + size + '" height="' + size + '" fill="currentColor" aria-hidden="true" focusable="false" style="flex-shrink:0;color:rgb(247,248,252);"><use xlink:href="#' + iconId + '"></use></svg>';
            }

            function injectUpdatesTab() {
                if (injected) return;

                var sidebarContent = document.querySelector('.setting-side-bar-group-content');
                if (!sidebarContent) return;

                var aboutTab = null;
                var items = sidebarContent.querySelectorAll('.setting-side-bar-group-content-item');
                for (var i = 0; i < items.length; i++) {
                    var title = items[i].querySelector('.setting-side-bar-group-content-item-title');
                    if (title && title.textContent.trim() === 'About') {
                        aboutTab = items[i];
                        break;
                    }
                }

                var tab = document.createElement('div');
                tab.id = 'qwen-updates-tab';
                tab.className = 'setting-side-bar-group-content-item';
                tab.setAttribute('data-spm-anchor-id', '');
                tab.innerHTML = '<span role="img" class="anticon">' + svgIcon('icon-line-download-02', 14) + '</span><div class="setting-side-bar-group-content-item-title" data-spm-anchor-id="">Updates</div>';

                if (aboutTab) {
                    sidebarContent.insertBefore(tab, aboutTab);
                } else {
                    sidebarContent.appendChild(tab);
                }

                var panel = document.createElement('div');
                panel.id = 'qwen-updates-panel';
                panel.className = 'qwen-chat-setting-general';
                panel.style.display = 'none';
                panel.innerHTML =
                    '<div class="setting-content-title">' +
                        '<div class="setting-content-title-title">Updates</div>' +
                    '</div>' +
                    '<div id="qwen-update-content" style="max-width:520px;"></div>';

                var mainContent = document.querySelector('.setting-content');
                if (mainContent) {
                    mainContent.appendChild(panel);
                } else {
                    document.body.appendChild(panel);
                }

                tab.onclick = function() {
                    sidebarContent.querySelectorAll('.setting-side-bar-group-content-item').forEach(function(t) {
                        t.classList.remove('selected');
                    });
                    tab.classList.add('selected');

                    var contentArea = document.querySelector('.setting-content');
                    if (contentArea) {
                        contentArea.querySelectorAll(':scope > div').forEach(function(d) {
                            if (d.id !== 'qwen-updates-panel') d.style.display = 'none';
                        });
                    }

                    panel.style.display = 'block';
                    checkForUpdatesUI();
                };

                var observer = new MutationObserver(function(mutations) {
                    for (var i = 0; i < mutations.length; i++) {
                        var m = mutations[i];
                        if (m.attributeName === 'class' && m.target !== tab) {
                            if (m.target.classList.contains('selected')) {
                                tab.classList.remove('selected');
                                panel.style.display = 'none';
                            }
                        }
                    }
                });

                sidebarContent.querySelectorAll('.setting-side-bar-group-content-item').forEach(function(t) {
                    observer.observe(t, { attributes: true, attributeFilter: ['class'] });
                });

                injected = true;
            }

            function cardStyle() {
                return 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:24px;margin-bottom:16px;';
            }

            function iconCircleStyle(color) {
                return 'width:48px;height:48px;border-radius:50%;background:' + color + ';display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:rgb(247,248,252);';
            }

            function progressBarStyle() {
                return 'width:100%;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:16px 0 8px;';
            }

            function progressFillStyle(pct) {
                return 'height:100%;width:' + pct + '%;background:rgb(97,92,237);border-radius:3px;transition:width 0.3s cubic-bezier(0.4,0,0.2,1);';
            }

            function btnPrimaryStyle() {
                return 'padding:10px 24px;background:rgb(97,92,237);color:rgb(247,248,252);border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;height:40px;font-family:inherit;transition:background 0.15s ease,opacity 0.15s ease;';
            }

            function btnSecondaryStyle() {
                return 'padding:10px 24px;background:rgba(255,255,255,0.06);color:rgb(247,248,252);border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;height:40px;font-family:inherit;transition:background 0.15s ease;';
            }

            function labelStyle() {
                return 'font-size:14px;font-weight:400;color:rgb(247,248,252);';
            }

            function subtextStyle() {
                return 'font-size:13px;color:rgba(255,255,255,0.45);';
            }

            async function checkForUpdatesUI() {
                var content = document.getElementById('qwen-update-content');
                if (!content) return;
                content.innerHTML =
                    '<div style="' + cardStyle() + '">' +
                        '<div style="display:flex;align-items:center;gap:12px;">' +
                            '<div style="width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.04);display:flex;align-items:center;justify-content:center;color:rgb(247,248,252);">' +
                                svgIcon('icon-line-download-02', 16) +
                            '</div>' +
                            '<div class="qwen-chat-setting-content-item-label">Checking for updates...</div>' +
                        '</div>' +
                    '</div>';

                try {
                    var info = await window.__TAURI__.core.invoke('get_update_info');
                    if (info.available) {
                        content.innerHTML =
                            '<div style="' + cardStyle() + '">' +
                                '<div style="display:flex;align-items:flex-start;gap:16px;">' +
                                    '<div style="width:40px;height:40px;border-radius:10px;background:rgba(97,92,237,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgb(247,248,252);">' +
                                        svgIcon('icon-line-download-02', 20) +
                                    '</div>' +
                                    '<div style="flex:1;min-width:0;">' +
                                        '<div class="qwen-chat-setting-content-item-label" style="font-size:15px;font-weight:600;margin-bottom:4px;">Update Available</div>' +
                                        '<div style="' + subtextStyle() + '">v' + info.latest_version + ' &middot; you are on v' + info.current_version + '</div>' +
                                    '</div>' +
                                '</div>' +
                                (info.release_notes ? '<div style="margin-top:16px;padding:12px 16px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:13px;color:rgba(255,255,255,0.55);line-height:1.6;max-height:140px;overflow-y:auto;">' + info.release_notes.replace(/\n/g, '<br>') + '</div>' : '') +
                                '<div style="margin-top:20px;">' +
                                    '<button id="qwen-install-btn" style="' + btnPrimaryStyle() + '">Download &amp; Install</button>' +
                                '</div>' +
                            '</div>';
                        document.getElementById('qwen-install-btn').onclick = async function() {
                            startInstallUI();
                        };
                    } else {
                        content.innerHTML =
                            '<div style="' + cardStyle() + 'text-align:center;">' +
                                '<div style="' + iconCircleStyle('rgba(34,197,94,0.1)') + '">' +
                                    svgIcon('icon-line-check-01', 24) +
                                '</div>' +
                                '<div class="qwen-chat-setting-content-item-label" style="font-size:15px;font-weight:600;margin-bottom:4px;">You\'re up to date</div>' +
                                '<div style="' + subtextStyle() + 'margin-bottom:16px;">Running v' + info.current_version + '</div>' +
                                '<button id="qwen-check-btn" style="' + btnSecondaryStyle() + '">Check for Updates</button>' +
                            '</div>';
                        document.getElementById('qwen-check-btn').onclick = async function() {
                            var btn = document.getElementById('qwen-check-btn');
                            btn.textContent = 'Checking...';
                            btn.disabled = true;
                            btn.style.opacity = '0.6';
                            await checkForUpdatesUI();
                        };
                    }
                } catch(e) {
                    content.innerHTML =
                        '<div style="' + cardStyle() + '">' +
                            '<div style="display:flex;align-items:flex-start;gap:12px;">' +
                                '<div style="width:32px;height:32px;border-radius:8px;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgb(247,248,252);">' +
                                    svgIcon('icon-line-alert-circle', 16) +
                                '</div>' +
                                '<div style="flex:1;">' +
                                    '<div style="font-size:14px;font-weight:500;color:rgb(239,68,68);margin-bottom:4px;">Could not check for updates</div>' +
                                    '<div style="' + subtextStyle() + 'margin-bottom:16px;">' + e + '</div>' +
                                    '<button id="qwen-check-retry-btn" style="' + btnSecondaryStyle() + '">Check Again</button>' +
                                '</div>' +
                            '</div>' +
                        '</div>';
                    document.getElementById('qwen-check-retry-btn').onclick = async function() {
                        checkForUpdatesUI();
                    };
                }
            }

            async function startInstallUI() {
                var content = document.getElementById('qwen-update-content');
                if (!content) return;

                content.innerHTML =
                    '<div style="' + cardStyle() + '">' +
                        '<div style="display:flex;align-items:flex-start;gap:16px;">' +
                            '<div style="width:40px;height:40px;border-radius:10px;background:rgba(97,92,237,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgb(247,248,252);">' +
                                svgIcon('icon-line-download-02', 20) +
                            '</div>' +
                            '<div style="flex:1;min-width:0;">' +
                                '<div class="qwen-chat-setting-content-item-label" style="font-size:15px;font-weight:600;margin-bottom:4px;">Downloading Update</div>' +
                                '<div style="' + subtextStyle() + '" id="dl-status">Starting download...</div>' +
                            '</div>' +
                        '</div>' +
                        '<div style="' + progressBarStyle() + '"><div id="dl-bar" style="' + progressFillStyle(0) + '"></div></div>' +
                        '<div style="' + subtextStyle() + '" id="dl-bytes">0 / 0 MB</div>' +
                    '</div>';

                var unlisten = await window.__TAURI__.event.listen('update-progress', function(event) {
                    var data = event.payload;
                    var bar = document.getElementById('dl-bar');
                    var status = document.getElementById('dl-status');
                    var bytes = document.getElementById('dl-bytes');
                    if (bar) bar.style.width = data.progress + '%';
                    if (status) status.textContent = data.status;
                    if (bytes && data.downloaded) bytes.textContent = data.downloaded + ' / ' + data.total + ' MB';
                });

                try {
                    await window.__TAURI__.core.invoke('install_update_with_progress');
                    unlisten();

                    content.innerHTML =
                        '<div style="' + cardStyle() + 'text-align:center;">' +
                            '<div style="' + iconCircleStyle('rgba(34,197,94,0.1)') + '">' +
                                svgIcon('icon-line-check-01', 24) +
                            '</div>' +
                            '<div class="qwen-chat-setting-content-item-label" style="font-size:15px;font-weight:600;margin-bottom:4px;">Update Installed</div>' +
                            '<div style="' + subtextStyle() + 'margin-bottom:20px;">Restart the app to apply changes</div>' +
                            '<button id="qwen-restart-btn" style="' + btnPrimaryStyle() + '">Restart Now</button>' +
                        '</div>';
                    document.getElementById('qwen-restart-btn').onclick = async function() {
                        var btn = document.getElementById('qwen-restart-btn');
                        btn.textContent = 'Restarting...';
                        btn.disabled = true;
                        btn.style.opacity = '0.6';
                        await window.__TAURI__.core.invoke('restart_app');
                    };
                } catch(e) {
                    unlisten();
                    content.innerHTML =
                        '<div style="' + cardStyle() + '">' +
                            '<div style="display:flex;align-items:flex-start;gap:12px;">' +
                                '<div style="width:32px;height:32px;border-radius:8px;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgb(247,248,252);">' +
                                    svgIcon('icon-line-alert-circle', 16) +
                                '</div>' +
                                '<div style="flex:1;">' +
                                    '<div style="font-size:14px;font-weight:500;color:rgb(239,68,68);margin-bottom:4px;">Update failed</div>' +
                                    '<div style="' + subtextStyle() + 'margin-bottom:16px;">' + e + '</div>' +
                                    '<button id="qwen-retry-btn" style="' + btnSecondaryStyle() + '">Retry</button>' +
                                '</div>' +
                            '</div>' +
                        '</div>';
                    document.getElementById('qwen-retry-btn').onclick = async function() {
                        startInstallUI();
                    };
                }
            }

            var checkInterval = setInterval(function() {
                if (window.location.href.indexOf('/settings') !== -1) {
                    injectUpdatesTab();
                }
            }, 500);

            window.addEventListener('popstate', function() {
                if (window.location.href.indexOf('/settings') !== -1) {
                    setTimeout(injectUpdatesTab, 300);
                }
            });

            if (window.location.href.indexOf('/settings') !== -1) {
                setTimeout(injectUpdatesTab, 500);
            }

            // Global update banner
            window.__TAURI__.event.listen('update-available', function(event) {
                if (document.getElementById('qwen-update-banner')) return;
                var data = event.payload;
                var style = document.createElement('style');
                style.id = 'qwen-banner-styles';
                style.textContent = '#qwen-banner-go:hover { background: rgb(117, 112, 257) !important; } #qwen-banner-dismiss:hover { background: rgba(255,255,255,0.08) !important; color: rgb(247,248,252) !important; } @keyframes bannerSlideIn { from { right: -500px; opacity: 0; } to { right: 16px; opacity: 1; } } @keyframes bannerFadeOut { from { right: 16px; opacity: 1; } to { right: -500px; opacity: 0; } } #qwen-update-banner { animation: bannerSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards; } #qwen-update-banner.dismissing { animation: bannerFadeOut 0.25s ease forwards; }';
                document.head.appendChild(style);
                var banner = document.createElement('div');
                banner.id = 'qwen-update-banner';
                banner.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;background:rgb(46,46,51);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px;font-family:system-ui,ui-sans-serif,-apple-system,BlinkMacSystemFont,Inter,NotoSansHans,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2);max-width:480px;width:calc(100% - 32px);';
                banner.innerHTML = '<div style="width:32px;height:32px;border-radius:8px;background:rgba(97,92,237,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:rgb(247,248,252);">' +
                    svgIcon('icon-line-download-02', 16) +
                '</div>' +
                '<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;color:rgb(247,248,252);margin-bottom:2px;">Update ' + data.version + ' available</div>' +
                '<div style="font-size:12px;color:rgba(255,255,255,0.5);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + data.notes.substring(0, 100) + '</div></div>' +
                '<div style="display:flex;gap:8px;flex-shrink:0;">' +
                '<button id="qwen-banner-go" style="padding:7px 16px;background:rgb(97,92,237);color:rgb(247,248,252);border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;height:32px;font-family:inherit;transition:background 0.15s ease;">View</button>' +
                '<button id="qwen-banner-dismiss" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:transparent;color:rgba(255,255,255,0.4);border:none;border-radius:6px;font-size:16px;cursor:pointer;transition:background 0.15s ease, color 0.15s ease;">&#x2715;</button></div>';
                document.body.appendChild(banner);
                document.getElementById('qwen-banner-go').addEventListener('click', function() {
                    var b = document.getElementById('qwen-update-banner');
                    if (b) { b.classList.add('dismissing'); setTimeout(function() { b.remove(); }, 250); }
                    window.location.href = 'https://chat.qwen.ai/settings';
                });
                document.getElementById('qwen-banner-dismiss').addEventListener('click', function() {
                    var b = document.getElementById('qwen-update-banner');
                    if (b) { b.classList.add('dismissing'); setTimeout(function() { b.remove(); var s = document.getElementById('qwen-banner-styles'); if (s) s.remove(); }, 250); }
                });
            });
        })();
    "##;

    format!("{}\n{}\n{}\n{}", pre_load_script, zoom_script, electron_bridge, settings_script)
}

#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    Ok(APP_VERSION.to_string())
}

#[tauri::command]
pub async fn get_platform_info() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH
    }))
}

#[tauri::command]
pub async fn open_devtool(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_hidden_devtools(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
            log::info!("DevTools closed");
            Ok(false)
        } else {
            window.open_devtools();
            log::info!("DevTools opened");
            Ok(true)
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            window.hide().map_err(|e| e.to_string())?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_external_link(app: tauri::AppHandle, url: String) -> Result<bool, String> {
    // Deep-link handling disabled (auth handled in-WebView now)
    // if url.starts_with("qwen://") {
    //     log::info!(
    //         "[DeepLink] Caught qwen:// URL in open_external_link: {}",
    //         url
    //     );
    //     handle_deep_link_url(&app, &url).await;
    //     return Ok(true);
    // }

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(false);
    }

    // Auth/login URLs → navigate inside the WebView instead of opening external browser
    let auth_domains = [
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

    let is_auth_url = auth_domains.iter().any(|domain| url.contains(domain))
        || url.contains("/login")
        || url.contains("/auth")
        || url.contains("/oauth")
        || url.contains("/callback")
        || url.contains("/signin")
        || url.contains("/signup");

    if is_auth_url {
        log::info!("[Auth] Navigating to login page in WebView: {}", url);
        // Navigate the current window to the auth URL
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(format!(
                "window.location.href = '{}';",
                url.replace('\'', "\\'")
            ));
            return Ok(true);
        }
    }

    log::info!("[Link] Opening URL in system browser: {}", url);
    open::that(&url).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn switch_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    log::info!("[Theme] switch_theme: {}", theme);
    app.emit(
        "event_from_main",
        serde_json::json!({
            "type": "theme_changed",
            "payload": theme
        }),
    )
    .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            let is_dark = theme == "dark";
            window
                .set_theme(Some(if is_dark {
                    tauri::Theme::Dark
                } else {
                    tauri::Theme::Light
                }))
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn switch_ln(app: tauri::AppHandle, ln: String) -> Result<(), String> {
    log::info!("[Language] switch_ln: {}", ln);
    app.emit(
        "event_from_main",
        serde_json::json!({
            "type": "language_changed",
            "payload": ln
        }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_title_bar_for_system_theme(
    app: tauri::AppHandle,
    is_dark: bool,
) -> Result<(), String> {
    app.emit(
        "event_from_main",
        serde_json::json!({
            "type": "system_theme_changed",
            "payload": is_dark
        }),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_language() -> Result<String, String> {
    Ok("en-US".to_string())
}

/// Reads clipboard image using GTK's native clipboard API and returns base64-encoded PNG.
/// This is more reliable than Tauri's clipboard-manager plugin on Linux because it handles
/// more image formats (PNG, BMP, etc.) that screenshot tools and file managers use.
///
/// CRITICAL FIX: Previously `wait_for_image()` would block FOREVER when clipboard had text
/// (no image), which hung the entire paste flow. Now checks `wait_is_image_available()` first
/// and has a 2-second timeout to prevent blocking text paste.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn read_clipboard_image() -> Result<String, String> {
    use base64::Engine;

    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();

    // CRITICAL FIX: Use `invoke()` instead of `idle_add_local()`.
    // `idle_add_local()` requires the calling thread to own the GLib main context,
    // but Tauri commands run on tokio worker threads → causes panic:
    // "default main context already acquired by another thread"
    //
    // `invoke()` is thread-safe: it schedules the closure on the main thread's
    // main context without requiring ownership, so it works from any thread.
    glib::MainContext::default().invoke(move || {
        let result = (|| -> Result<Vec<u8>, String> {
            let clipboard = gtk::Clipboard::get(&gtk::gdk::Atom::intern("CLIPBOARD"));

            // CRITICAL: Check if clipboard has image BEFORE calling wait_for_image().
            // wait_for_image() BLOCKS until clipboard owner responds, which can hang
            // forever if clipboard contains text (not an image). This check is fast
            // and non-blocking.
            if !clipboard.wait_is_image_available() {
                return Err("No image in clipboard".to_string());
            }

            let pixbuf = clipboard
                .wait_for_image()
                .ok_or_else(|| "No image in clipboard".to_string())?;

            log::info!(
                "[Clipboard] Got pixbuf: {}x{} pixels, {} channels",
                pixbuf.width(),
                pixbuf.height(),
                pixbuf.n_channels()
            );

            // Save pixbuf as PNG bytes in memory
            let png_bytes = pixbuf
                .save_to_bufferv("png", &[])
                .map_err(|e| format!("PNG save failed: {}", e))?;

            log::info!("[Clipboard] PNG encoded: {} bytes", png_bytes.len());
            Ok(png_bytes)
        })();

        let _ = tx.send(result);
    });

    // CRITICAL: Add timeout to prevent hanging. If clipboard doesn't have an image
    // and the GTK callback doesn't fire (e.g., GLib main loop is busy), we timeout
    // after 2 seconds so text paste can proceed.
    let png_bytes = match tokio::time::timeout(
        tokio::time::Duration::from_secs(2),
        tokio::task::spawn_blocking(move || {
            rx.recv()
                .map_err(|e| format!("Channel recv error: {}", e))?
        }),
    )
    .await
    {
        Ok(task_result) => task_result.map_err(|e| format!("Task join error: {}", e))??,
        Err(_) => return Err("Timeout: clipboard image read took > 2s".to_string()),
    };

    // Encode to base64 for JS consumption
    let encoded = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    log::info!("[Clipboard] Base64 encoded: {} chars", encoded.len());
    Ok(encoded)
}

/// Stub for non-Linux platforms (clipboard image paste uses native APIs there)
#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub async fn read_clipboard_image() -> Result<String, String> {
    Err("read_clipboard_image is only available on Linux".to_string())
}

#[allow(dead_code)]
pub async fn setup_deep_link(app: &tauri::AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;

    #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
    {
        if let Err(e) = app.deep_link().register_all() {
            log::error!("[DeepLink] Failed to register schemes: {}", e);
        }
    }

    log::info!("[DeepLink] Protocol handler registered (qwen://)");

    let app_handle = app.clone();
    if let Ok(Some(urls)) = app_handle.deep_link().get_current() {
        for url in urls {
            log::info!("[DeepLink] App started with URL: {}", url);
            let app = app_handle.clone();
            let url_str = url.to_string();
            tauri::async_runtime::spawn(async move {
                handle_deep_link_url(&app, &url_str).await;
            });
        }
    }
}

#[allow(dead_code)]
pub async fn handle_deep_link_url(app: &tauri::AppHandle, url: &str) {
    match Url::parse(url) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("");
            let query: std::collections::HashMap<_, _> = parsed.query_pairs().collect();

            match host {
                "open" | "auth" | "login" | "callback" => {
                    let token = query
                        .get("token")
                        .or_else(|| query.get("code"))
                        .or_else(|| query.get("sid"))
                        .or_else(|| query.get("ticket"));

                    if let Some(token) = token {
                        log::info!("[DeepLink] Auth token received, length: {}", token.len());
                        if let Some(window) = app.get_webview_window("main") {
                            let token = token.to_string();

                            let _ = window.show();
                            let _ = window.set_focus();

                            let current_url =
                                window.url().map(|u| u.to_string()).unwrap_or_default();
                            log::info!("[DeepLink] Current webview URL: {}", current_url);

                            if !current_url.contains("chat.qwen.ai") {
                                log::info!("[DeepLink] Navigating to chat.qwen.ai first");
                                let _ =
                                    window.eval("window.location.href = 'https://chat.qwen.ai';");
                                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                            }

                            let _ = window.eval(format!(
                                r#"(function() {{
                                    try {{
                                        document.cookie = "token={token}; domain=.qwen.ai; path=/; max-age=2592000";
                                        document.cookie = "sid={token}; domain=.qwen.ai; path=/; max-age=2592000";
                                        document.cookie = "ticket={token}; domain=.qwen.ai; path=/; max-age=2592000";
                                        localStorage.setItem("token", "{token}");
                                        localStorage.setItem("sid", "{token}");
                                        localStorage.setItem("ticket", "{token}");
                                        localStorage.setItem("auth_token", "{token}");
                                        localStorage.setItem("qwen_auth_token", "{token}");
                                        sessionStorage.setItem("token", "{token}");
                                        sessionStorage.setItem("sid", "{token}");
                                        console.log("[DeepLink] Token and cookies injected");
                                    }} catch(e) {{
                                        console.error("[DeepLink] Injection failed:", e);
                                    }}
                                }})();"#
                            ));

                            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                            let _ = window.eval("window.location.reload();");
                        }
                    } else {
                        log::warn!(
                            "[DeepLink] No token/code/sid/ticket in URL. Query params: {:?}",
                            query.keys().collect::<Vec<_>>()
                        );
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                _ => {
                    log::info!("[DeepLink] Unknown host: {}", host);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        }
        Err(e) => {
            log::error!("[DeepLink] Failed to parse URL: {}", e);
        }
    }
}
