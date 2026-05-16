use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::settings;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(rename = "transportType", default, skip_serializing_if = "Option::is_none")]
    pub transport_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(rename = "from", default, skip_serializing_if = "Option::is_none")]
    pub from_: Option<String>,
    #[serde(rename = "fromId", default, skip_serializing_if = "Option::is_none")]
    pub from_id: Option<String>,
    #[serde(default)]
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolCallParams {
    #[serde(rename = "serverName")]
    pub server_name: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    #[serde(rename = "toolArguments", skip_serializing_if = "Option::is_none")]
    pub tool_arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolListParams {
    #[serde(rename = "serverName")]
    pub server_name: String,
}

type PendingMap = HashMap<u64, tokio::sync::oneshot::Sender<Result<serde_json::Value>>>;

pub struct Bridge {
    stdin: Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>,
    request_id: Arc<std::sync::atomic::AtomicU64>,
    pending: Arc<Mutex<PendingMap>>,
    _child: tokio::process::Child,
}

impl Bridge {
    async fn new() -> Result<Self> {
        let bridge_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/mcp-bridge.mjs"
        );

        let mut child = Command::new("node")
            .arg(bridge_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        log::info!("[Bridge] Spawned PID {}", child.id().unwrap_or(0));

        let pending: Arc<Mutex<PendingMap>> = Arc::new(Mutex::new(HashMap::new()));
        let request_id = Arc::new(std::sync::atomic::AtomicU64::new(0));

        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("No stdin"))?;
        let stdin = Arc::new(tokio::sync::Mutex::new(stdin));

        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("No stdout"))?;
        let pending_read = Arc::clone(&pending);
        tokio::spawn(read_bridge_stdout(stdout, pending_read));

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(read_bridge_stderr(stderr));
        }

        Ok(Self {
            stdin,
            request_id,
            pending,
            _child: child,
        })
    }

    async fn send(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        let id = self.request_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let msg = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let mut line = serde_json::to_string(&msg)?;
        line.push('\n');
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }

        let (sender, receiver) = tokio::sync::oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, sender);
        }

        tokio::time::timeout(Duration::from_secs(60), receiver)
            .await
            .map_err(|_| anyhow::anyhow!("Bridge request timed out"))?
            .map_err(|_| anyhow::anyhow!("Bridge channel closed"))?
    }
}

async fn read_bridge_stdout(
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<PendingMap>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                log::debug!("[Bridge] Stdout closed");
                return;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let (Some(id), Some(result)) = (msg.get("id").and_then(|v| v.as_u64()), msg.get("result")) {
                        if let Ok(mut pending) = pending.try_lock() {
                            if let Some(sender) = pending.remove(&id) {
                                let _ = sender.send(Ok(result.clone()));
                            }
                        }
                    } else if let (Some(id), Some(error)) = (msg.get("id").and_then(|v| v.as_u64()), msg.get("error")) {
                        if let Ok(mut pending) = pending.try_lock() {
                            if let Some(sender) = pending.remove(&id) {
                                let msg = error.get("message").and_then(|m| m.as_str()).unwrap_or("unknown error");
                                let _ = sender.send(Err(anyhow::anyhow!("{}", msg)));
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::debug!("[Bridge] Read error: {}", e);
                return;
            }
        }
    }
}

async fn read_bridge_stderr(stderr: tokio::process::ChildStderr) {
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    log::debug!("[Bridge] {}", trimmed);
                }
            }
            Err(_) => break,
        }
    }
}

pub type McpState = Arc<Mutex<Option<Arc<Bridge>>>>;

fn get_default_config() -> HashMap<String, McpServerConfig> {
    let mut config = HashMap::new();
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp".to_string());
    let projects_dir = format!("{}/Projects", home_dir);

    // Auto-add qwen-core (28 tools + 3 prompts)
    config.insert("qwen-core".to_string(), McpServerConfig {
        command: "npx".to_string(),
        args: vec!["-y".to_string(), "qwen-core".to_string()],
        transport_type: Some("stdio".to_string()),
        source: Some("official".to_string()),
        from_: Some("builtin".to_string()),
        disabled: false,
        ..Default::default()
    });

    config.insert("Filesystem".to_string(), McpServerConfig {
        command: "npx".to_string(),
        args: vec![
            "-y".to_string(),
            "@modelcontextprotocol/server-filesystem".to_string(),
            home_dir,
            "/tmp".to_string(),
            projects_dir,
        ],
        transport_type: Some("stdio".to_string()),
        ..Default::default()
    });

    config.insert("Sequential-Thinking".to_string(), McpServerConfig {
        command: "npx".to_string(),
        args: vec!["-y".to_string(), "@modelcontextprotocol/server-sequential-thinking".to_string()],
        transport_type: Some("stdio".to_string()),
        ..Default::default()
    });

    config
}

fn normalize_config(mut config: HashMap<String, McpServerConfig>) -> HashMap<String, McpServerConfig> {
    if cfg!(target_os = "linux") {
        if let Some(fs_config) = config.get_mut("Filesystem") {
            let home_dir = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/tmp".to_string());
            let projects_dir = format!("{}/Projects", home_dir);

            // Replace macOS /Users paths with Linux home dir
            fs_config.args = fs_config.args.iter()
                .map(|arg| {
                    if arg == "/Users" || arg.starts_with("/Users/") {
                        home_dir.clone()
                    } else {
                        arg.clone()
                    }
                })
                .collect();

            // Ensure home and projects dirs are present
            let has_home = fs_config.args.iter().any(|a| a == &home_dir);
            let has_projects = fs_config.args.iter().any(|a| a == &projects_dir);
            if !has_home {
                fs_config.args.push(home_dir.clone());
            }
            if !has_projects {
                fs_config.args.push(projects_dir);
            }
            // Always include /tmp
            if !fs_config.args.iter().any(|a| a == "/tmp") {
                fs_config.args.push("/tmp".to_string());
            }
        }
    }
    config
}

fn load_mcp_config() -> Result<HashMap<String, McpServerConfig>, String> {
    let config_path = settings::get_settings_path();
    if let Ok(content) = std::fs::read_to_string(config_path) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(servers) = settings.get("mcpServers") {
                let config: HashMap<String, McpServerConfig> = serde_json::from_value(servers.clone()).map_err(|e| e.to_string())?;
                return Ok(normalize_config(config));
            }
        }
    }
    Ok(get_default_config())
}

pub async fn ensure_bridge(app: &tauri::AppHandle) -> Result<Arc<Bridge>, String> {
    let state = app.state::<McpState>();
    let mut guard = state.lock().await;

    if let Some(ref bridge) = *guard {
        log::info!("[Bridge] Reusing existing bridge");
        return Ok(Arc::clone(bridge));
    }

    log::info!("[Bridge] Starting MCP bridge...");
    let bridge = Arc::new(Bridge::new().await.map_err(|e| {
        log::error!("[Bridge] Failed to spawn: {}", e);
        format!("Bridge spawn: {}", e)
    })?);

    // Send current config
    let config = load_mcp_config()?;
    log::info!("[Bridge] Loaded config with {} servers: {:?}", config.len(), config.keys().collect::<Vec<_>>());
    for (name, cfg) in &config {
        log::info!("[Bridge]   Server '{}' command={} args={:?}", name, cfg.command, cfg.args);
    }
    bridge.send("updateConfig", serde_json::json!({ "config": config })).await
        .map_err(|e| {
            log::error!("[Bridge] Config update failed: {}", e);
            format!("Bridge config: {}", e)
        })?;

    *guard = Some(Arc::clone(&bridge));
    log::info!("[Bridge] Ready");
    Ok(bridge)
}

#[tauri::command]
pub async fn mcp_client_connect(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[MCP] >>> mcp_client_connect invoked");
    log::info!("[MCP] Caller: UI or startup sync");
    match ensure_bridge(&app).await {
        Ok(_) => { log::info!("[MCP] <<< mcp_client_connect OK"); Ok(()) }
        Err(e) => { log::error!("[MCP] <<< mcp_client_connect FAILED: {}", e); Err(e) }
    }
}

#[tauri::command]
pub async fn mcp_client_close(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[MCP] >>> mcp_client_close invoked");
    let state = app.state::<McpState>();
    let mut guard = state.lock().await;
    if let Some(ref bridge) = *guard {
        let _ = bridge.send("disconnect", serde_json::json!({})).await;
    }
    *guard = None;
    log::info!("[MCP] <<< mcp_client_close OK, Bridge released");
    Ok(())
}

#[tauri::command]
pub async fn mcp_client_tool_list(
    app: tauri::AppHandle,
    params: ToolListParams,
) -> Result<serde_json::Value, String> {
    log::info!("[MCP] >>> mcp_client_tool_list invoked, serverName={}", params.server_name);
    let bridge = ensure_bridge(&app).await?;
    let name = params.server_name.clone();
    match bridge.send("listTools", serde_json::json!({ "serverName": name })).await {
        Ok(result) => {
            let tool_count = result.get("tools").and_then(|t| t.as_array()).map(|a| a.len()).unwrap_or(0);
            log::info!("[MCP] <<< mcp_client_tool_list OK, {} tools for {}", tool_count, name);
            Ok(result)
        }
        Err(e) => {
            log::error!("[MCP] <<< mcp_client_tool_list FAILED for {}: {}", name, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn mcp_client_tool_call(
    app: tauri::AppHandle,
    params: ToolCallParams,
) -> Result<serde_json::Value, String> {
    log::info!("[MCP] >>> mcp_client_tool_call invoked, serverName={}, toolName={}",
        params.server_name, params.tool_name);
    log::info!("[MCP] Tool arguments: {:?}", params.tool_arguments);
    let bridge = ensure_bridge(&app).await?;
    let name = params.server_name.clone();
    let tool = params.tool_name.clone();
    let payload = serde_json::to_value(&params).map_err(|e| format!("serialize: {}", e))?;
    log::info!("[MCP] Bridge payload: {}", payload);
    match bridge.send("callTool", payload).await {
        Ok(result) => {
            log::info!("[MCP] <<< mcp_client_tool_call OK, {}.{}", name, tool);
            Ok(result)
        }
        Err(e) => {
            log::error!("[MCP] <<< mcp_client_tool_call FAILED for {}.{}: {}", name, tool, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn mcp_client_get_config(
    _app: tauri::AppHandle,
) -> Result<HashMap<String, McpServerConfig>, String> {
    log::info!("[MCP] >>> mcp_client_get_config invoked");
    log::info!("[MCP] Reading from file: {:?}", settings::get_settings_path());
    let config = load_mcp_config()?;
    log::info!("[MCP] <<< mcp_client_get_config OK, {} servers: {:?}", config.len(), config.keys().collect::<Vec<_>>());
    for (name, cfg) in &config {
        log::info!("[MCP]   Server '{}' command={} args={:?}", name, cfg.command, cfg.args);
    }
    Ok(config)
}

#[tauri::command]
#[allow(clippy::map_entry)]
pub async fn mcp_client_update_config(
    app: tauri::AppHandle,
    config: HashMap<String, McpServerConfig>,
) -> Result<HashMap<String, McpServerConfig>, String> {
    log::info!("[MCP] >>> mcp_client_update_config invoked");
    log::info!("[MCP] Incoming config with {} servers", config.len());
    for (name, cfg) in &config {
        log::info!("[MCP]   Incoming server '{}' command={} args={:?}", name, cfg.command, cfg.args);
    }

    // Load current file config
    let file_config = load_mcp_config().unwrap_or_default();
    log::info!("[MCP] Current file config has {} servers: {:?}", file_config.len(), file_config.keys().collect::<Vec<_>>());

    // Merge: incoming config + file config (preserves user's manual edits)
    let mut merged = config;
    for (name, cfg) in file_config {
        if !merged.contains_key(&name) {
            log::info!("[MCP] Preserving file config for server: {}", name);
            merged.insert(name, cfg);
        }
    }

    // Auto-add qwen-core if not present (ensures it's always available)
    if !merged.contains_key("qwen-core") {
        let defaults = get_default_config();
        if let Some(qwen_core) = defaults.get("qwen-core") {
            log::info!("[MCP] Auto-adding qwen-core (default server)");
            merged.insert("qwen-core".to_string(), qwen_core.clone());
        }
    }

    log::info!("[MCP] Merged config has {} servers: {:?}", merged.len(), merged.keys().collect::<Vec<_>>());

    // Normalize paths for Linux (replace /Users with home dir)
    let merged = normalize_config(merged);
    for (name, cfg) in &merged {
        log::info!("[MCP]   Normalized '{}' args: {:?}", name, cfg.args);
    }

    let config_path = settings::get_settings_path();
    log::info!("[MCP] Saving to: {:?}", config_path);
    let mut settings = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    if let Some(obj) = settings.as_object_mut() {
        obj.insert("mcpServers".to_string(), serde_json::to_value(&merged).unwrap());
    }
    let content = serde_json::to_string_pretty(&settings).unwrap();
    log::info!("[MCP] Writing {} bytes", content.len());
    log::info!("[MCP] File content:\n{}", content);
    std::fs::write(&config_path, &content)
        .map_err(|e| {
            log::error!("[MCP] Write failed: {}", e);
            e.to_string()
        })?;

    let bridge = ensure_bridge(&app).await?;
    let result: Result<HashMap<String, McpServerConfig>, String> = bridge.send("updateConfig", serde_json::json!({ "config": merged.clone() })).await
        .map(|v| serde_json::from_value(v).unwrap_or_default())
        .map_err(|e| e.to_string());
    
    match &result {
        Ok(config) => log::info!("[MCP] <<< mcp_client_update_config OK, {} servers", config.len()),
        Err(e) => log::error!("[MCP] <<< mcp_client_update_config FAILED: {}", e),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_bridge_filesystem() {
        let bridge = Bridge::new().await.expect("Failed to start bridge");
        
        // Send config with filesystem server
        let config = get_default_config();
        bridge.send("updateConfig", serde_json::json!({ "config": config })).await
            .expect("Failed to update config");
        
        // List tools
        let result = bridge.send("listTools", serde_json::json!({ "serverName": "Filesystem" })).await
            .expect("Failed to list tools");
        
        let tools = result.get("tools").and_then(|t| t.as_array()).expect("No tools");
        println!("Filesystem tools: {}", tools.len());
        assert!(!tools.is_empty(), "Should have filesystem tools");
    }

    #[tokio::test]
    async fn test_bridge_sequential_thinking() {
        let bridge = Bridge::new().await.expect("Failed to start bridge");
        
        let config = get_default_config();
        bridge.send("updateConfig", serde_json::json!({ "config": config })).await
            .expect("Failed to update config");
        
        let result = bridge.send("listTools", serde_json::json!({ "serverName": "Sequential-Thinking" })).await
            .expect("Failed to list tools");
        
        let tools = result.get("tools").and_then(|t| t.as_array()).expect("No tools");
        println!("Sequential-Thinking tools: {}", tools.len());
        assert!(!tools.is_empty(), "Should have sequential thinking tools");
    }
}
