use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogOptions {
    pub title: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buttons: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_id: Option<usize>,
}

#[tauri::command]
pub async fn show_native_dialog(
    app: tauri::AppHandle,
    options: DialogOptions,
) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let kind = match options.title.to_lowercase().as_str() {
        "error" => MessageDialogKind::Error,
        "warning" => MessageDialogKind::Warning,
        _ => MessageDialogKind::Info,
    };

    let result = app
        .dialog()
        .message(&options.message)
        .title(&options.title)
        .kind(kind)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();

    Ok(if result { "ok".to_string() } else { "cancel".to_string() })
}

#[tauri::command]
pub async fn request_file_access(
    app: tauri::AppHandle,
    purpose: String,
    return_file: Option<bool>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .set_title(&purpose)
        .pick_file(move |file_handle| {
            let _ = tx.send(file_handle.and_then(|f| f.as_path().map(|p| p.to_string_lossy().to_string())));
        });

    let file_path = rx.recv().map_err(|e| e.to_string())?.ok_or("No file selected")?;

    let mut result = serde_json::json!({
        "filePath": file_path
    });

    if return_file.unwrap_or(false) {
        let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        result["file"] = serde_json::Value::String(content);
    }

    Ok(result)
}
