use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Serialize)]
pub(crate) struct DaemonArg {
    #[serde(rename = "type")]
    pub(crate) arg_type: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DaemonCallRequest {
    pub(crate) jar_path: String,
    pub(crate) site_key: String,
    pub(crate) class_hint: String,
    pub(crate) ext: String,
    pub(crate) spider_method: String,
    pub(crate) args: Vec<DaemonArg>,
    pub(crate) compat_jars: String,
    pub(crate) fallback_jar: Option<String>,
    pub(crate) prefer_compat_runtime: bool,
    pub(crate) precall_methods: String,
    pub(crate) proxy_base_url: String,
    pub(crate) js_runtime_root: String,
    pub(crate) lib_dir: String,
}

#[derive(Debug, Clone)]
pub(crate) struct DaemonCallResponse {
    pub(crate) class_name: Option<String>,
    pub(crate) payload: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonEnvelope {
    id: u64,
    ok: bool,
    result: Option<serde_json::Value>,
    class_name: Option<String>,
    error: Option<String>,
}

struct SpiderDaemonProcess {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<DaemonEnvelope, String>>>>,
    healthy: AtomicBool,
}

impl SpiderDaemonProcess {
    fn new(stdin: ChildStdin, child: Child) -> Self {
        Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: Mutex::new(HashMap::new()),
            healthy: AtomicBool::new(true),
        }
    }
}

struct DaemonRequestGuard {
    process: Arc<SpiderDaemonProcess>,
    request_id: u64,
    request_sent: AtomicBool,
    finished: AtomicBool,
}

impl DaemonRequestGuard {
    fn new(process: Arc<SpiderDaemonProcess>, request_id: u64) -> Self {
        Self {
            process,
            request_id,
            request_sent: AtomicBool::new(false),
            finished: AtomicBool::new(false),
        }
    }

    fn mark_sent(&self) {
        self.request_sent.store(true, Ordering::SeqCst);
    }

    fn disarm(&self) {
        self.finished.store(true, Ordering::SeqCst);
    }
}

impl Drop for DaemonRequestGuard {
    fn drop(&mut self) {
        if self.finished.load(Ordering::SeqCst) {
            return;
        }

        let process = self.process.clone();
        let request_id = self.request_id;
        let request_sent = self.request_sent.load(Ordering::SeqCst);

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                remove_pending_request(&process, request_id).await;
                if request_sent {
                    let _ = send_cancel_command(&process, request_id).await;
                }
            });
        }
    }
}

#[derive(Default)]
struct SpiderDaemonManager {
    process: Option<Arc<SpiderDaemonProcess>>,
    next_request_id: AtomicU64,
}

static SPIDER_DAEMON_MANAGER: LazyLock<Mutex<SpiderDaemonManager>> =
    LazyLock::new(|| Mutex::new(SpiderDaemonManager::default()));

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn daemon_classpath(app: &AppHandle) -> Result<(PathBuf, String), String> {
    let candidate_paths = {
        let mut paths = Vec::new();

        if let Ok(resource_dir) = app.path().resource_dir() {
            paths.push(resource_dir.join("resources").join("jar"));
            paths.push(resource_dir.join("jar"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            paths.push(cwd.join("src-tauri").join("resources").join("jar"));
            paths.push(cwd.join("resources").join("jar"));
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                paths.push(exe_dir.join("resources").join("jar"));
                paths.push(exe_dir.join("jar"));
            }
        }

        paths
    };

    for base_path in candidate_paths {
        let bridge_jar = base_path.join("bridge.jar");
        if !bridge_jar.is_file() {
            continue;
        }

        let mut classpath_parts = vec![clean_path(&bridge_jar)];
        let libs_root = base_path.join("libs");
        if libs_root.is_dir() {
            classpath_parts.push(clean_path(&libs_root.join("*")));
        }
        let cp_separator = if cfg!(windows) { ";" } else { ":" };
        return Ok((bridge_jar, classpath_parts.join(cp_separator)));
    }

    Err("bridge.jar not found in any candidate path".to_string())
}

async fn fail_all_pending(process: &Arc<SpiderDaemonProcess>, reason: String) {
    process.healthy.store(false, Ordering::SeqCst);
    let pending = {
        let mut pending = process.pending.lock().await;
        pending.drain().collect::<Vec<_>>()
    };
    for (_, sender) in pending {
        let _ = sender.send(Err(reason.clone()));
    }
}

async fn mark_process_unhealthy(process: &Arc<SpiderDaemonProcess>, reason: String) {
    fail_all_pending(process, reason).await;
    let mut manager = SPIDER_DAEMON_MANAGER.lock().await;
    if manager
        .process
        .as_ref()
        .map(|current| Arc::ptr_eq(current, process))
        .unwrap_or(false)
    {
        manager.process = None;
    }
}

async fn spawn_daemon_process(app: &AppHandle) -> Result<Arc<SpiderDaemonProcess>, String> {
    let (_bridge_jar, classpath) = daemon_classpath(app)?;
    let java_bin = crate::java_runtime::resolve_java_binary(app)?;
    let java_home = crate::java_runtime::resolve_java_home(app)?;

    let mut command = Command::new(&java_bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg("-Xmx512m")
        .arg("-cp")
        .arg(classpath)
        .arg("com.halo.spider.BridgeDaemon")
        .env("JAVA_HOME", java_home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|err| format!("spawn spider daemon failed: {err}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "spider daemon stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "spider daemon stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "spider daemon stderr unavailable".to_string())?;

    let process = Arc::new(SpiderDaemonProcess::new(stdin, child));

    {
        let stdout_process = process.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<DaemonEnvelope>(trimmed) {
                            Ok(envelope) => {
                                let sender = {
                                    let mut pending = stdout_process.pending.lock().await;
                                    pending.remove(&envelope.id)
                                };
                                if let Some(sender) = sender {
                                    let _ = sender.send(Ok(envelope));
                                }
                            }
                            Err(err) => {
                                crate::spider_cmds::append_spider_debug_log(&format!(
                                    "[SpiderDaemon] failed to parse stdout line: {} | {}",
                                    err, trimmed
                                ));
                            }
                        }
                    }
                    Ok(None) => {
                        mark_process_unhealthy(
                            &stdout_process,
                            "spider daemon stdout closed".to_string(),
                        )
                        .await;
                        break;
                    }
                    Err(err) => {
                        mark_process_unhealthy(
                            &stdout_process,
                            format!("read spider daemon stdout failed: {err}"),
                        )
                        .await;
                        break;
                    }
                }
            }
        });
    }

    {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                eprintln!("[SpiderDaemon:Log] {}", trimmed);
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderDaemon] {}",
                    trimmed
                ));
            }
        });
    }

    Ok(process)
}

async fn ensure_daemon_started(app: &AppHandle) -> Result<Arc<SpiderDaemonProcess>, String> {
    let mut manager = SPIDER_DAEMON_MANAGER.lock().await;
    if let Some(process) = manager.process.as_ref() {
        if process.healthy.load(Ordering::SeqCst) {
            return Ok(process.clone());
        }
        manager.process = None;
    }

    let process = spawn_daemon_process(app).await?;
    manager.process = Some(process.clone());
    Ok(process)
}

pub(crate) async fn warmup_daemon(app: &AppHandle) -> Result<(), String> {
    ensure_daemon_started(app).await.map(|_| ())
}

async fn next_message_id() -> u64 {
    let manager = SPIDER_DAEMON_MANAGER.lock().await;
    manager.next_request_id.fetch_add(1, Ordering::SeqCst) + 1
}

async fn remove_pending_request(process: &Arc<SpiderDaemonProcess>, request_id: u64) {
    let mut pending = process.pending.lock().await;
    pending.remove(&request_id);
}

async fn write_daemon_message(
    process: &Arc<SpiderDaemonProcess>,
    payload_text: &str,
    failure_context: &str,
) -> Result<(), String> {
    let mut stdin = process.stdin.lock().await;
    if let Err(err) = stdin.write_all(payload_text.as_bytes()).await {
        drop(stdin);
        let reason = format!("{failure_context}: {err}");
        mark_process_unhealthy(process, reason.clone()).await;
        return Err(reason);
    }
    if let Err(err) = stdin.write_all(b"\n").await {
        drop(stdin);
        let reason = format!("{failure_context}: {err}");
        mark_process_unhealthy(process, reason.clone()).await;
        return Err(reason);
    }
    if let Err(err) = stdin.flush().await {
        drop(stdin);
        let reason = format!("{failure_context}: {err}");
        mark_process_unhealthy(process, reason.clone()).await;
        return Err(reason);
    }

    Ok(())
}

async fn send_cancel_command(
    process: &Arc<SpiderDaemonProcess>,
    target_request_id: u64,
) -> Result<(), String> {
    if !process.healthy.load(Ordering::SeqCst) {
        return Ok(());
    }

    let cancel_message_id = next_message_id().await;
    let payload = serde_json::json!({
        "id": cancel_message_id,
        "method": "cancel",
        "params": {
            "requestId": target_request_id,
        },
    });

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderDaemon] cancelling in-flight request {}",
        target_request_id
    ));

    write_daemon_message(
        process,
        &payload.to_string(),
        "write spider daemon cancel failed",
    )
    .await
}

async fn send_shutdown_command(process: &Arc<SpiderDaemonProcess>) -> Result<(), String> {
    if !process.healthy.load(Ordering::SeqCst) {
        return Ok(());
    }

    let shutdown_message_id = next_message_id().await;
    let payload = serde_json::json!({
        "id": shutdown_message_id,
        "method": "shutdown",
    });

    write_daemon_message(
        process,
        &payload.to_string(),
        "write spider daemon shutdown failed",
    )
    .await
}

fn parse_daemon_response(envelope: DaemonEnvelope) -> Result<DaemonCallResponse, String> {
    if !envelope.ok {
        return Err(
            envelope
                .error
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "spider daemon returned an unknown error".to_string()),
        );
    }

    let class_name = envelope
        .class_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let payload = match envelope.result {
        None | Some(serde_json::Value::Null) => "{}".to_string(),
        Some(serde_json::Value::String(result)) => {
            let trimmed = result.trim();
            if trimmed.is_empty() {
                "{}".to_string()
            } else {
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(serde_json::Value::Array(items)) => items
                        .first()
                        .map(|value| value.to_string())
                        .unwrap_or_else(|| "{}".to_string()),
                    Ok(value) => value.to_string(),
                    Err(_) => result,
                }
            }
        }
        Some(serde_json::Value::Array(items)) => items
            .first()
            .map(|value| value.to_string())
            .unwrap_or_else(|| "{}".to_string()),
        Some(value) => value.to_string(),
    };

    Ok(DaemonCallResponse { class_name, payload })
}

pub(crate) async fn daemon_call(
    app: &AppHandle,
    request: DaemonCallRequest,
    timeout: Duration,
) -> Result<DaemonCallResponse, String> {
    let process = ensure_daemon_started(app).await?;
    let request_id = next_message_id().await;
    let request_guard = DaemonRequestGuard::new(process.clone(), request_id);

    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = process.pending.lock().await;
        pending.insert(request_id, sender);
    }

    let payload = serde_json::json!({
        "id": request_id,
        "method": "call",
        "params": request,
    });
    let payload_text = payload.to_string();

    if let Err(err) = write_daemon_message(
        &process,
        &payload_text,
        "write spider daemon stdin failed",
    )
    .await
    {
        remove_pending_request(&process, request_id).await;
        request_guard.disarm();
        return Err(err);
    }
    request_guard.mark_sent();

    let envelope = match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(Ok(envelope))) => envelope,
        Ok(Ok(Err(err))) => {
            request_guard.disarm();
            return Err(err);
        }
        Ok(Err(_)) => {
            request_guard.disarm();
            return Err("spider daemon response channel closed".to_string());
        }
        Err(_) => {
            remove_pending_request(&process, request_id).await;
            let _ = send_cancel_command(&process, request_id).await;
            request_guard.disarm();
            return Err(format!(
                "spider daemon execution timeout exceeded after {}s",
                timeout.as_secs()
            ));
        }
    };

    request_guard.disarm();
    parse_daemon_response(envelope)
}

pub(crate) async fn shutdown_daemon() {
    let process = {
        let mut manager = SPIDER_DAEMON_MANAGER.lock().await;
        manager.process.take()
    };

    let Some(process) = process else {
        return;
    };

    let _ = send_shutdown_command(&process).await;
    process.healthy.store(false, Ordering::SeqCst);
    fail_all_pending(&process, "spider daemon shut down".to_string()).await;
    let mut child = process.child.lock().await;
    let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
    let _ = child.kill().await;
}
