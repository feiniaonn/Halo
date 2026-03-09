use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const DEFAULT_HELPER_PORTS: [u16; 3] = [9966, 1072, 9999];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatHelperStatus {
    pub running: bool,
    pub healthy: bool,
    pub pid: Option<u32>,
    pub ports: Vec<u16>,
    pub started_at_ms: Option<u64>,
    pub helper_jar_path: Option<String>,
    pub last_failure: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompatHelperTrace {
    pub port: u16,
    pub method: String,
    pub path: String,
    pub query: String,
    pub target_url: Option<String>,
    pub response_status: Option<u16>,
    pub failure: Option<String>,
    pub body_snippet: Option<String>,
    pub captured_at_ms: u64,
}

struct CompatHelperProcessState {
    child: Option<Child>,
    #[cfg(target_os = "windows")]
    job: Option<WindowsJobObject>,
    ports: Vec<u16>,
    started_at_ms: Option<u64>,
    helper_jar_path: Option<PathBuf>,
    last_failure: Option<String>,
}

impl Default for CompatHelperProcessState {
    fn default() -> Self {
        Self {
            child: None,
            #[cfg(target_os = "windows")]
            job: None,
            ports: DEFAULT_HELPER_PORTS.to_vec(),
            started_at_ms: None,
            helper_jar_path: None,
            last_failure: None,
        }
    }
}

static HELPER_STATE: OnceLock<Mutex<CompatHelperProcessState>> = OnceLock::new();

fn helper_state() -> &'static Mutex<CompatHelperProcessState> {
    HELPER_STATE.get_or_init(|| Mutex::new(CompatHelperProcessState::default()))
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn normalize_ports(ports: &[u16]) -> Vec<u16> {
    let mut normalized = ports
        .iter()
        .copied()
        .filter(|port| *port > 0)
        .collect::<Vec<_>>();
    normalized.sort_unstable();
    normalized.dedup();
    if normalized.is_empty() {
        DEFAULT_HELPER_PORTS.to_vec()
    } else {
        normalized
    }
}

fn resolve_helper_jar(app: &AppHandle) -> Result<PathBuf, String> {
    for dir in crate::spider_compat::resolve_compat_dirs(app) {
        let candidate = dir.join("compat_helper.jar");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("compat_helper.jar not found in any resource candidate path".to_string())
}

async fn query_helper_health(port: u16) -> bool {
    let client = match crate::media_cmds::build_client() {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

async fn query_all_ports_healthy(ports: &[u16]) -> bool {
    for port in ports {
        if !query_helper_health(*port).await {
            return false;
        }
    }
    true
}

fn update_process_exit_state(state: &mut CompatHelperProcessState) {
    let Some(child) = state.child.as_mut() else {
        return;
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            state.last_failure = Some(format!("compat helper exited early: {status}"));
            state.child = None;
            #[cfg(target_os = "windows")]
            {
                state.job = None;
            }
        }
        Ok(None) => {}
        Err(err) => {
            state.last_failure = Some(format!("compat helper state probe failed: {err}"));
            state.child = None;
            #[cfg(target_os = "windows")]
            {
                state.job = None;
            }
        }
    }
}

#[cfg(target_os = "windows")]
struct WindowsJobObject(isize);

#[cfg(target_os = "windows")]
impl Drop for WindowsJobObject {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(windows::Win32::Foundation::HANDLE(
                self.0 as *mut std::ffi::c_void,
            ));
        }
    }
}

#[cfg(target_os = "windows")]
fn bind_child_to_job_object(child: &Child) -> Result<WindowsJobObject, String> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let job = unsafe { CreateJobObjectW(None, None) }
        .map_err(|err| format!("create job object: {err}"))?;
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|err| format!("set job object limits: {err}"))?;

        let process_handle = HANDLE(child.as_raw_handle() as *mut c_void);
        AssignProcessToJobObject(job, process_handle)
            .map_err(|err| format!("assign process to job object: {err}"))?;
    }

    Ok(WindowsJobObject(job.0 as isize))
}

fn spawn_helper_process(
    app: &AppHandle,
    helper_jar_path: &PathBuf,
    ports: &[u16],
) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

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
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(helper_jar_path)
        .arg("com.halo.compat.CompatHelperServer")
        .env(
            "HALO_HELPER_PORTS",
            ports
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(","),
        )
        .env("JAVA_HOME", java_home)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
        .spawn()
        .map_err(|err| format!("spawn compat helper: {err}"))
}

fn status_from_state(state: &CompatHelperProcessState, healthy: bool) -> CompatHelperStatus {
    CompatHelperStatus {
        running: state.child.is_some(),
        healthy,
        pid: state.child.as_ref().map(std::process::Child::id),
        ports: state.ports.clone(),
        started_at_ms: state.started_at_ms,
        helper_jar_path: state
            .helper_jar_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        last_failure: state.last_failure.clone(),
    }
}

pub(crate) async fn ensure_compat_helper_started(
    app: &AppHandle,
    ports: &[u16],
) -> Result<CompatHelperStatus, String> {
    let normalized_ports = normalize_ports(ports);

    let was_running = {
        let mut guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        update_process_exit_state(&mut guard);
        guard.ports = normalized_ports.clone();
        guard.child.is_some()
    };

    if was_running && query_all_ports_healthy(&normalized_ports).await {
        let guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        return Ok(status_from_state(&guard, true));
    }

    {
        let mut guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        if let Some(child) = guard.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.child = None;
        #[cfg(target_os = "windows")]
        {
            guard.job = None;
        }
    }

    let helper_jar_path = resolve_helper_jar(app)?;
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[CompatHelper] starting helper on ports {} from {}",
        normalized_ports
            .iter()
            .map(u16::to_string)
            .collect::<Vec<_>>()
            .join(", "),
        helper_jar_path.display()
    ));

    let child = spawn_helper_process(app, &helper_jar_path, &normalized_ports)?;
    #[cfg(target_os = "windows")]
    let job = bind_child_to_job_object(&child)?;

    {
        let mut guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        guard.child = Some(child);
        #[cfg(target_os = "windows")]
        {
            guard.job = Some(job);
        }
        guard.started_at_ms = Some(now_unix_ms());
        guard.helper_jar_path = Some(helper_jar_path);
        guard.last_failure = None;
    }

    let start_deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    while tokio::time::Instant::now() < start_deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if query_all_ports_healthy(&normalized_ports).await {
            let guard = helper_state()
                .lock()
                .map_err(|_| "compat helper state lock poisoned".to_string())?;
            return Ok(status_from_state(&guard, true));
        }
    }

    let mut guard = helper_state()
        .lock()
        .map_err(|_| "compat helper state lock poisoned".to_string())?;
    update_process_exit_state(&mut guard);
    let err = "compat helper failed health checks on required ports".to_string();
    guard.last_failure = Some(err.clone());
    Err(err)
}

pub(crate) async fn current_compat_helper_status(
    app: &AppHandle,
) -> Result<CompatHelperStatus, String> {
    let helper_path = resolve_helper_jar(app).ok();
    let ports = {
        let mut guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        update_process_exit_state(&mut guard);
        if guard.helper_jar_path.is_none() {
            guard.helper_jar_path = helper_path;
        }
        guard.ports.clone()
    };

    let healthy = query_all_ports_healthy(&ports).await;
    let guard = helper_state()
        .lock()
        .map_err(|_| "compat helper state lock poisoned".to_string())?;
    Ok(status_from_state(&guard, healthy))
}

pub(crate) async fn fetch_last_trace(ports: &[u16]) -> Option<CompatHelperTrace> {
    let client = crate::media_cmds::build_client().ok()?;
    for port in normalize_ports(ports) {
        let url = format!("http://127.0.0.1:{port}/trace/last");
        let response = client
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            continue;
        }
        if let Ok(trace) = response.json::<CompatHelperTrace>().await {
            return Some(trace);
        }
    }
    None
}

#[tauri::command]
pub async fn compat_helper_status(app: tauri::AppHandle) -> Result<CompatHelperStatus, String> {
    current_compat_helper_status(&app).await
}

#[tauri::command]
pub async fn compat_helper_start(
    app: tauri::AppHandle,
    ports: Option<Vec<u16>>,
) -> Result<CompatHelperStatus, String> {
    ensure_compat_helper_started(&app, ports.as_deref().unwrap_or(&DEFAULT_HELPER_PORTS)).await
}

#[tauri::command]
pub async fn compat_helper_stop() -> Result<CompatHelperStatus, String> {
    let mut guard = helper_state()
        .lock()
        .map_err(|_| "compat helper state lock poisoned".to_string())?;

    if let Some(child) = guard.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }

    guard.child = None;
    #[cfg(target_os = "windows")]
    {
        guard.job = None;
    }
    guard.last_failure = None;

    Ok(status_from_state(&guard, false))
}

#[tauri::command]
pub async fn compat_helper_trace_last_failure() -> Result<Option<CompatHelperTrace>, String> {
    let ports = {
        let guard = helper_state()
            .lock()
            .map_err(|_| "compat helper state lock poisoned".to_string())?;
        guard.ports.clone()
    };
    Ok(fetch_last_trace(&ports).await)
}
