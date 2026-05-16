use tauri::{Emitter, Manager};

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

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
pub async fn open_external_link(_app: tauri::AppHandle, url: String) -> Result<bool, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(false);
    }
    open::that(&url).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn switch_theme(app: tauri::AppHandle, theme: String) -> Result<(), String> {
    log::info!("[Theme] switch_theme: {}", theme);
    app.emit("event_from_main", serde_json::json!({
        "type": "theme_changed",
        "payload": theme
    }))
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
    app.emit("event_from_main", serde_json::json!({
        "type": "language_changed",
        "payload": ln
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_title_bar_for_system_theme(
    app: tauri::AppHandle,
    is_dark: bool,
) -> Result<(), String> {
    app.emit("event_from_main", serde_json::json!({
        "type": "system_theme_changed",
        "payload": is_dark
    }))
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_language() -> Result<String, String> {
    Ok("en-US".to_string())
}

pub async fn setup_deep_link(_app: &tauri::AppHandle) {
    log::info!("[DeepLink] Protocol handler setup (qwen://)");
}
