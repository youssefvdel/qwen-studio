use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

struct PendingEvents {
    events: Vec<AppEvent>,
}

#[tauri::command]
pub async fn webview_loaded(app: tauri::AppHandle, id: String) -> Result<(), String> {
    log::info!("[Event] webview_loaded: {}", id);

    let state = app.state::<Mutex<PendingEvents>>();
    let mut pending = state.lock().unwrap();

    for event in pending.events.drain(..) {
        app.emit("event_from_main", &event).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn setup_event_forwarding(app: &tauri::AppHandle) {
    app.manage(Mutex::new(PendingEvents {
        events: Vec::new(),
    }));

    let app_handle = app.clone();
    app_handle.clone().listen_any("event_to_main", move |event| {
        if let Ok(payload) = serde_json::from_str::<AppEvent>(event.payload()) {
            log::info!("[Event] event_to_main: {}", payload.event_type);

            let state = app_handle.state::<Mutex<PendingEvents>>();
            let pending = state.lock().unwrap();

            if pending.events.is_empty() {
                if let Err(e) = app_handle.emit("event_from_main", &payload) {
                    log::error!("[Event] Failed to emit event: {}", e);
                }
            }
        }
    });
}
