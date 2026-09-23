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
    #[serde(
        rename = "transportType",
        default,
        skip_serializing_if = "Option::is_none"
    )]
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
        let bridge_path = resolve_bridge_path();

        // Snapshot the environment the bridge will inherit: a GUI-launched app
        // and a shell-launched one can have very different PATHs, and "npx not
        // found" / "node not found" are the first suspects when every MCP
        // server comes up red.
        if let Ok(path) = std::env::var("PATH") {
            let interesting: Vec<&str> = path
                .split(';')
                .filter(|p| {
                    let l = p.to_lowercase();
                    l.contains("node") || l.contains("npm") || l.contains("cargo") || l.contains("uv")
                })
                .collect();
            log::info!("[Bridge] PATH entries (node/npm/cargo/uv): {:#?}", interesting);
        }

        log::info!("[Bridge] Spawning: node {}", bridge_path);
        let mut child = Command::new("node")
            .arg(bridge_path)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| {
                log::error!("[Bridge] spawn failed: {}", e);
                anyhow::anyhow!("spawn node: {}", e)
            })?;
        log::info!("[Bridge] Spawned PID {} (spawn OK)", child.id().unwrap_or(0));

        let pending: Arc<Mutex<PendingMap>> = Arc::new(Mutex::new(HashMap::new()));
        let request_id = Arc::new(std::sync::atomic::AtomicU64::new(0));

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("No stdin"))?;
        let stdin = Arc::new(tokio::sync::Mutex::new(stdin));
        log::info!("[Bridge] stdin pipe acquired");

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("No stdout"))?;
        let pending_read = Arc::clone(&pending);
        tokio::spawn(read_bridge_stdout(stdout, pending_read));
        log::info!("[Bridge] stdout reader spawned");

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(read_bridge_stderr(stderr));
            log::info!("[Bridge] stderr reader spawned");
        } else {
            log::warn!("[Bridge] stderr pipe missing");
        }

        log::info!("[Bridge] Bridge::new complete, child kept alive via _child");
        Ok(Self {
            stdin,
            request_id,
            pending,
            _child: child,
        })
    }

    async fn send(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        let id = self
            .request_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let msg = serde_json::json!({
            "id": id,
            "method": method,
            "params": params,
        });
        log::info!("[Bridge] send #{} method={}", id, method);

        let mut line = serde_json::to_string(&msg)?;
        line.push('\n');
        {
            let mut stdin = self.stdin.lock().await;
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;
        }
        log::info!("[Bridge] sent #{} method={}, waiting for reply", id, method);

        let (sender, receiver) = tokio::sync::oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, sender);
        }

        let res = tokio::time::timeout(Duration::from_secs(60), receiver)
            .await
            .map_err(|_| {
                log::error!("[Bridge] request #{} timed out after 60s", id);
                anyhow::anyhow!("Bridge request timed out")
            })?
            .map_err(|_| {
                log::error!("[Bridge] request #{} channel closed (bridge died?)", id);
                anyhow::anyhow!("Bridge channel closed")
            })?;
        match &res {
            Ok(v) => log::info!("[Bridge] reply #{} ok ({} bytes)", id, v.to_string().len()),
            Err(e) => log::error!("[Bridge] reply #{} error: {}", id, e),
        }
        res
    }
}


async fn read_bridge_stdout(stdout: tokio::process::ChildStdout, pending: Arc<Mutex<PendingMap>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => {
                // EOF on the bridge's stdout means the node process died (or
                // closed its stdout). This is the single most important log
                // line when MCP is red on startup, and any waiter must be told
                // instead of hanging for 60s.
                log::error!("[Bridge] EOF on stdout: bridge process exited/unreachable");
                // Fail every in-flight request so send() unblocks immediately.
                let mut drained = Vec::new();
                if let Ok(mut pending) = pending.try_lock() {
                    for (_, sender) in pending.drain() {
                        drained.push(sender);
                    }
                }
                for sender in drained {
                    let _ = sender.send(Err(anyhow::anyhow!(
                        "Bridge stdout closed, process died"
                    )));
                }
                return;
            }
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                log::info!("[Bridge] << {}", trimmed);
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let (Some(id), Some(result)) =
                        (msg.get("id").and_then(|v| v.as_u64()), msg.get("result"))
                    {
                        if let Ok(mut pending) = pending.try_lock() {
                            if let Some(sender) = pending.remove(&id) {
                                let _ = sender.send(Ok(result.clone()));
                            }
                        }
                    } else if let (Some(id), Some(error)) =
                        (msg.get("id").and_then(|v| v.as_u64()), msg.get("error"))
                    {
                        if let Ok(mut pending) = pending.try_lock() {
                            if let Some(sender) = pending.remove(&id) {
                                let msg = error
                                    .get("message")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("unknown error");
                                let _ = sender.send(Err(anyhow::anyhow!("{}", msg)));
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("[Bridge] Read error: {}", e);
                return;
            }
        }
    }
}

async fn read_bridge_stderr(stderr: tokio::process::ChildStderr) {
    let mut reader = BufReader::new(stderr);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => {
                log::info!("[Bridge] stderr EOF (bridge process exited)");
                return;
            }
            Ok(_) => {
                // Read raw bytes and lossy-decode: on Windows the bridge's
                // stderr can carry CP1251 lines from cmd.exe (e.g. "uvx is not
                // recognized") — read_line() would die on invalid UTF-8, close
                // the pipe, and the bridge then dies on EPIPE when it tries to
                // log again. Losing a mojibake line beats killing the bridge.
                let text = String::from_utf8_lossy(&buf);
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    // info! (not debug!): tauri_plugin_log defaults to Info, and
                    // the bridge's own lines ("connected: X", "connect FAILED",
                    // per-server statuses) are exactly what is needed to tell a
                    // green server from a red one when triaging MCP startup.
                    log::info!("[Bridge] {}", trimmed);
                }
            }
            Err(e) => {
                log::error!("[Bridge] stderr read error: {}", e);
                return;
            }
        }
    }
}

pub type McpState = Arc<Mutex<Option<Arc<Bridge>>>>;

/// Locate mcp-bridge.mjs.
///
/// In an installed (bundled) app the file ships as a bundle resource next to
/// the executable; in a dev build it lives in the project root. The old
/// CARGO_MANIFEST_DIR-only lookup baked the build machine's path into the
/// binary, so the installed app could not find the bridge at all.
fn resolve_bridge_path() -> String {
    let candidates = [
        // Bundled app: the bridge ships inside mcp-runtime/ next to its
        // node_modules (ESM resolution walks up from the script's directory).
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("mcp-runtime").join("mcp-bridge.mjs"))),
        // Dev build: project root.
        Some(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("mcp-bridge.mjs")),
    ];
    for candidate in candidates.into_iter().flatten() {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    // Fall back to the dev path so the spawn error names a real location.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("mcp-bridge.mjs")
        .to_string_lossy()
        .to_string()
}

/// Locate the bundled MCP runtime (tsx + qwen-core) for the Windows qwen-core
/// launcher. Installed apps ship it as the `mcp-runtime/` resource; dev builds
/// use the project's own node_modules.
fn mcp_runtime_dir() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let bundled = exe_dir.join("mcp-runtime");
    if bundled.join("node_modules").exists() {
        return Some(bundled);
    }
    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf();
    if dev.join("node_modules").exists() {
        return Some(dev);
    }
    None
}

fn get_default_config() -> HashMap<String, McpServerConfig> {
    let mut config = HashMap::new();
    let home_dir = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/tmp".to_string());
    let projects_dir = format!("{}/Projects", home_dir);

    // Auto-add qwen-core (28 tools + 3 prompts) - runs from local ~/Projects/qwen-core
    config.insert("qwen-core".to_string(), qwen_core_config());

    config.insert(
        "Filesystem".to_string(),
        McpServerConfig {
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
        },
    );

    config.insert(
        "Sequential-Thinking".to_string(),
        McpServerConfig {
            command: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-sequential-thinking".to_string(),
            ],
            transport_type: Some("stdio".to_string()),
            ..Default::default()
        },
    );

    config
}

/// The bundled qwen-core launcher (`npx -y qwen-core`) runs its `bin/qwen-core`
/// shim, which does `child_process.spawn('npx', ['tsx', ...])` with no shell.
/// On Windows there is no `npx.exe` (only `npx.cmd`), so that spawn dies with
/// ENOENT and qwen-core comes up red. Run the prebuilt entry point directly
/// instead: `node <mcp-runtime>/node_modules/qwen-core/dist/index.mjs`, falling
/// back to `node <tsx cli> <qwen-core src/index.ts>` for older versions that
/// only ship TypeScript sources.
#[cfg(windows)]
fn qwen_core_config() -> McpServerConfig {
    let mut args: Vec<String> = Vec::new();
    if let Some(runtime) = mcp_runtime_dir() {
        let dist = runtime
            .join("node_modules")
            .join("qwen-core")
            .join("dist")
            .join("index.mjs");
        if dist.exists() {
            args.push(dist.to_string_lossy().to_string());
        } else {
            let tsx = runtime
                .join("node_modules")
                .join("tsx")
                .join("dist")
                .join("cli.mjs");
            let src = runtime
                .join("node_modules")
                .join("qwen-core")
                .join("src")
                .join("index.ts");
            if tsx.exists() && src.exists() {
                args.push(tsx.to_string_lossy().to_string());
                args.push(src.to_string_lossy().to_string());
            }
        }
    }
    if args.is_empty() {
        // No runtime found: keep the portable launcher and let the connect
        // error explain itself instead of silently pointing at a dead path.
        args = vec!["-y".to_string(), "qwen-core".to_string()];
        return McpServerConfig {
            command: "npx".to_string(),
            args,
            transport_type: Some("stdio".to_string()),
            source: Some("official".to_string()),
            from_: Some("builtin".to_string()),
            disabled: false,
            ..Default::default()
        };
    }
    McpServerConfig {
        command: "node".to_string(),
        args,
        transport_type: Some("stdio".to_string()),
        source: Some("official".to_string()),
        from_: Some("builtin".to_string()),
        disabled: false,
        ..Default::default()
    }
}

#[cfg(not(windows))]
fn qwen_core_config() -> McpServerConfig {
    McpServerConfig {
        command: "npx".to_string(),
        args: vec!["-y".to_string(), "qwen-core".to_string()],
        transport_type: Some("stdio".to_string()),
        source: Some("official".to_string()),
        from_: Some("builtin".to_string()),
        disabled: false,
        ..Default::default()
    }
}

fn normalize_config(
    mut config: HashMap<String, McpServerConfig>,
) -> HashMap<String, McpServerConfig> {
    // Windows: rewrite the bundled qwen-core launcher (see qwen_core_config).
    // This also heals a stale persisted settings.json that still has the old
    // `npx -y qwen-core` command which cannot start on Windows.
    #[cfg(windows)]
    {
        if config.contains_key("qwen-core") {
            config.insert("qwen-core".to_string(), qwen_core_config());
        }
    }

    // The bundled Filesystem config ships with macOS/Linux paths. On any other
    // OS those paths don't exist, `server-filesystem` refuses to start and the
    // MCP menu shows the server as red — so rewrite them to real local paths.
    if cfg!(target_os = "linux") || cfg!(target_os = "windows") {
        if let Some(fs_config) = config.get_mut("Filesystem") {
            // Drop the `@latest` tag: it forces npx to resolve the version via
            // the npm registry on every cold start, which is slow enough to
            // blow the connect timeout when several servers spawn in parallel.
            // A bare package name uses the local npx cache instead.
            fs_config.args = fs_config
                .args
                .iter()
                .map(|arg| {
                    if arg.starts_with("@modelcontextprotocol/server-filesystem@") {
                        "@modelcontextprotocol/server-filesystem".to_string()
                    } else {
                        arg.clone()
                    }
                })
                .collect();

            let home_dir = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/tmp".to_string());
            let projects_dir = format!("{}/Projects", home_dir);
            // Linux keeps `/tmp`; Windows has no such path, so use its temp dir.
            let scratch_dir = if cfg!(target_os = "windows") {
                std::env::temp_dir().to_string_lossy().to_string()
            } else {
                "/tmp".to_string()
            };

            fs_config.args = fs_config
                .args
                .iter()
                .map(|arg| {
                    if arg == "/Users" || arg.starts_with("/Users/") {
                        home_dir.clone()
                    } else if arg == "/tmp" {
                        scratch_dir.clone()
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
            // Always include a writable scratch dir
            if !fs_config.args.iter().any(|a| a == &scratch_dir) {
                fs_config.args.push(scratch_dir);
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
                let config: HashMap<String, McpServerConfig> =
                    serde_json::from_value(servers.clone()).map_err(|e| e.to_string())?;
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
    log::info!(
        "[Bridge] Loaded config with {} servers: {:?}",
        config.len(),
        config.keys().collect::<Vec<_>>()
    );
    for (name, cfg) in &config {
        log::info!(
            "[Bridge]   Server '{}' command={} args={:?}",
            name,
            cfg.command,
            cfg.args
        );
    }
    let reply = bridge
        .send("updateConfig", serde_json::json!({ "config": config }))
        .await
        .map_err(|e| {
            log::error!("[Bridge] Config update failed: {}", e);
            format!("Bridge config: {}", e)
        })?;

    // The bridge answers with { config, statuses }. Log every server so the
    // console shows exactly which one is green and why a red one failed.
    match reply.get("statuses").and_then(|s| s.as_object()) {
        Some(statuses) => {
            let mut up = 0usize;
            for (name, st) in statuses {
                if st.get("status").and_then(|s| s.as_str()) == Some("connected") {
                    up += 1;
                    log::info!("[Bridge]   GREEN  {}", name);
                } else {
                    let err = st
                        .get("error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("unknown error");
                    log::error!("[Bridge]   RED    {}: {}", name, err);
                }
            }
            log::info!("[Bridge] {} connected, {} failed", up, statuses.len() - up);
        }
        None => log::warn!("[Bridge] updateConfig reply has no statuses (old bridge?)"),
    }

    *guard = Some(Arc::clone(&bridge));
    log::info!("[Bridge] Ready");
    Ok(bridge)
}

#[tauri::command]
pub async fn mcp_client_connect(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("[MCP] >>> mcp_client_connect invoked");
    log::info!("[MCP] Caller: UI or startup sync");
    match ensure_bridge(&app).await {
        Ok(_) => {
            log::info!("[MCP] <<< mcp_client_connect OK");
            Ok(())
        }
        Err(e) => {
            log::error!("[MCP] <<< mcp_client_connect FAILED: {}", e);
            Err(e)
        }
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
    log::info!(
        "[MCP] >>> mcp_client_tool_list invoked, serverName={}",
        params.server_name
    );
    let bridge = ensure_bridge(&app).await?;
    let name = params.server_name.clone();
    match bridge
        .send("listTools", serde_json::json!({ "serverName": name }))
        .await
    {
        Ok(result) => {
            let tool_count = result
                .get("tools")
                .and_then(|t| t.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            log::info!(
                "[MCP] <<< mcp_client_tool_list OK, {} tools for {}",
                tool_count,
                name
            );
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
    log::info!(
        "[MCP] >>> mcp_client_tool_call invoked, serverName={}, toolName={}",
        params.server_name,
        params.tool_name
    );
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
            log::error!(
                "[MCP] <<< mcp_client_tool_call FAILED for {}.{}: {}",
                name,
                tool,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn mcp_client_get_config(
    _app: tauri::AppHandle,
) -> Result<HashMap<String, McpServerConfig>, String> {
    log::info!("[MCP] >>> mcp_client_get_config invoked");
    log::info!(
        "[MCP] Reading from file: {:?}",
        settings::get_settings_path()
    );
    let config = load_mcp_config()?;
    log::info!(
        "[MCP] <<< mcp_client_get_config OK, {} servers: {:?}",
        config.len(),
        config.keys().collect::<Vec<_>>()
    );
    for (name, cfg) in &config {
        log::info!(
            "[MCP]   Server '{}' command={} args={:?}",
            name,
            cfg.command,
            cfg.args
        );
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
        log::info!(
            "[MCP]   Incoming server '{}' command={} args={:?}",
            name,
            cfg.command,
            cfg.args
        );
    }

    // Load current file config
    let file_config = load_mcp_config().unwrap_or_default();
    log::info!(
        "[MCP] Current file config has {} servers: {:?}",
        file_config.len(),
        file_config.keys().collect::<Vec<_>>()
    );

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

    log::info!(
        "[MCP] Merged config has {} servers: {:?}",
        merged.len(),
        merged.keys().collect::<Vec<_>>()
    );

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
        obj.insert(
            "mcpServers".to_string(),
            serde_json::to_value(&merged).unwrap(),
        );
    }
    let content = serde_json::to_string_pretty(&settings).unwrap();
    log::info!("[MCP] Writing {} bytes", content.len());
    log::info!("[MCP] File content:\n{}", content);
    std::fs::write(&config_path, &content).map_err(|e| {
        log::error!("[MCP] Write failed: {}", e);
        e.to_string()
    })?;

    let bridge = ensure_bridge(&app).await?;
    let result: Result<HashMap<String, McpServerConfig>, String> = bridge
        .send(
            "updateConfig",
            serde_json::json!({ "config": merged.clone() }),
        )
        .await
        .map(|v| {
            // New bridge shape: { config, statuses }. Log the statuses here too
            // so a manual config change reports per-server health.
            if let Some(statuses) = v.get("statuses").and_then(|s| s.as_object()) {
                for (name, st) in statuses {
                    match st.get("status").and_then(|s| s.as_str()) {
                        Some("connected") => log::info!("[MCP]   GREEN  {}", name),
                        _ => log::error!(
                            "[MCP]   RED    {}: {}",
                            name,
                            st.get("error")
                                .and_then(|e| e.as_str())
                                .unwrap_or("unknown error")
                        ),
                    }
                }
            }
            let cfg_value = v.get("config").cloned().unwrap_or(v);
            serde_json::from_value::<HashMap<String, McpServerConfig>>(cfg_value)
                .unwrap_or_default()
        })
        .map_err(|e| e.to_string());

    match &result {
        Ok(config) => log::info!(
            "[MCP] <<< mcp_client_update_config OK, {} servers",
            config.len()
        ),
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
        bridge
            .send("updateConfig", serde_json::json!({ "config": config }))
            .await
            .expect("Failed to update config");

        // List tools
        let result = bridge
            .send(
                "listTools",
                serde_json::json!({ "serverName": "Filesystem" }),
            )
            .await
            .expect("Failed to list tools");

        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .expect("No tools");
        println!("Filesystem tools: {}", tools.len());
        assert!(!tools.is_empty(), "Should have filesystem tools");
    }

    #[tokio::test]
    async fn test_bridge_sequential_thinking() {
        let bridge = Bridge::new().await.expect("Failed to start bridge");

        let config = get_default_config();
        bridge
            .send("updateConfig", serde_json::json!({ "config": config }))
            .await
            .expect("Failed to update config");

        let result = bridge
            .send(
                "listTools",
                serde_json::json!({ "serverName": "Sequential-Thinking" }),
            )
            .await
            .expect("Failed to list tools");

        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .expect("No tools");
        println!("Sequential-Thinking tools: {}", tools.len());
        assert!(!tools.is_empty(), "Should have sequential thinking tools");
    }

    // --- Windows path-normalization contracts (see feat/windows-build) ---
    // The chat sends Filesystem configs with macOS/Linux paths (`/Users`, `/tmp`).
    // On Windows those don't exist, so `server-filesystem` refuses to start and
    // the MCP menu shows the server as red. normalize_config must rewrite them.

    // Only args that look like filesystem paths are subject to existence checks;
    // `-y` and `@scope/pkg` are npx flags/package names, not paths.
    fn looks_like_path(arg: &str) -> bool {
        arg.starts_with('/') || arg.starts_with("\\\\") || arg.as_bytes().get(1) == Some(&b':')
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_default_config_has_no_posix_tmp() {
        let cfg = normalize_config(get_default_config());
        let fs = cfg
            .get("Filesystem")
            .expect("default config must contain Filesystem");
        for a in &fs.args {
            assert_ne!(a, "/tmp", "posix /tmp leaked into windows config");
            assert!(
                !a.starts_with("/Users"),
                "macOS /Users path leaked into windows config: {}",
                a
            );
            if looks_like_path(a) {
                assert!(
                    std::path::Path::new(a).exists(),
                    "Filesystem path arg must exist on windows: {}",
                    a
                );
            }
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_normalize_replaces_mac_and_tmp_paths() {
        let mut m = HashMap::new();
        m.insert(
            "Filesystem".to_string(),
            McpServerConfig {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string(),
                    "/Users".to_string(),
                    "/tmp".to_string(),
                ],
                transport_type: Some("stdio".to_string()),
                ..Default::default()
            },
        );

        let out = normalize_config(m);
        let fs = out.get("Filesystem").unwrap();

        for a in &fs.args {
            assert!(!a.starts_with("/Users"), "macOS path not replaced: {}", a);
            assert_ne!(a, "/tmp", "posix /tmp not replaced");
        }

        let home = dirs::home_dir().unwrap().to_string_lossy().to_string();
        let temp = std::env::temp_dir().to_string_lossy().to_string();
        assert!(
            fs.args.iter().any(|a| a == &home),
            "home dir must be present after normalize: {:?}",
            fs.args
        );
        assert!(
            fs.args.iter().any(|a| a == &temp),
            "temp dir must be present after normalize: {:?}",
            fs.args
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_normalize_is_idempotent() {
        let once = normalize_config(get_default_config());
        let twice = normalize_config(once.clone());
        assert_eq!(
            once.get("Filesystem").unwrap().args,
            twice.get("Filesystem").unwrap().args,
            "normalizing twice must not duplicate or churn paths"
        );
    }

    // Cross-platform invariant: a path that already exists on this OS must be
    // preserved by normalize_config (we only rewrite known-bad posix paths).
    #[test]
    fn normalize_preserves_existing_valid_paths() {
        let valid = std::env::temp_dir().to_string_lossy().to_string();
        let mut m = HashMap::new();
        m.insert(
            "Filesystem".to_string(),
            McpServerConfig {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string(),
                    valid.clone(),
                ],
                transport_type: Some("stdio".to_string()),
                ..Default::default()
            },
        );

        let out = normalize_config(m);
        let fs = out.get("Filesystem").unwrap();
        assert!(
            fs.args.iter().any(|a| a == &valid),
            "valid existing path was dropped: {:?}",
            fs.args
        );
    }
}
