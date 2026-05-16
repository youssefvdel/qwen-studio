use std::path::PathBuf;

pub fn get_settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("qwen-studio");

    if !config_dir.exists() {
        let _ = std::fs::create_dir_all(&config_dir);
    }

    config_dir.join("settings.json")
}

#[tauri::command]
pub async fn get_setting(
    _app: tauri::AppHandle,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let path = get_settings_path();
    if let Ok(content) = std::fs::read_to_string(path) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            return Ok(settings.get(&key).cloned());
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn set_setting(
    _app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let path = get_settings_path();
    let mut settings = std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    if let Some(obj) = settings.as_object_mut() {
        obj.insert(key, value);
    }

    std::fs::write(path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())
}
