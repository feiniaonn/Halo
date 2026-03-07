use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::Emitter;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use windows::core::Interface;

const EVENT_SYSTEM_OVERVIEW_UPDATED: &str = "system:overview-updated";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSystemOverview {
    pub cpu_usage: f64,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub gpu_usage: Option<f64>,
    pub gpu_memory_used_bytes: Option<u64>,
    pub gpu_memory_total_bytes: Option<u64>,
    pub gpu_memory_shared_used_bytes: Option<u64>,
    pub gpu_memory_shared_total_bytes: Option<u64>,
    pub gpu_adapter_dedicated_used_bytes: Option<u64>,
    pub gpu_adapter_shared_used_bytes: Option<u64>,
    pub app_cpu_usage: Option<f64>,
    pub app_memory_used_bytes: Option<u64>,
    pub app_disk_read_bytes_per_sec: Option<u64>,
    pub app_disk_write_bytes_per_sec: Option<u64>,
    pub app_gpu_usage: Option<f64>,
    pub app_gpu_memory_used_bytes: Option<u64>,
    pub app_gpu_memory_total_bytes: Option<u64>,
    pub uptime_secs: u64,
    pub host_name: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
}

impl Default for DashboardSystemOverview {
    fn default() -> Self {
        Self {
            cpu_usage: 0.0,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
            disk_used_bytes: 0,
            disk_total_bytes: 0,
            gpu_usage: None,
            gpu_memory_used_bytes: None,
            gpu_memory_total_bytes: None,
            gpu_memory_shared_used_bytes: None,
            gpu_memory_shared_total_bytes: None,
            gpu_adapter_dedicated_used_bytes: None,
            gpu_adapter_shared_used_bytes: None,
            app_cpu_usage: None,
            app_memory_used_bytes: None,
            app_disk_read_bytes_per_sec: None,
            app_disk_write_bytes_per_sec: None,
            app_gpu_usage: None,
            app_gpu_memory_used_bytes: None,
            app_gpu_memory_total_bytes: None,
            uptime_secs: 0,
            host_name: static_host_name(),
            os_name: Some(std::env::consts::OS.to_string()),
            os_version: None,
        }
    }
}

fn static_host_name() -> Option<String> {
    static HOST_NAME: OnceLock<Option<String>> = OnceLock::new();
    HOST_NAME
        .get_or_init(|| std::env::var("COMPUTERNAME").ok())
        .clone()
}

#[derive(Clone)]
pub struct DashboardOverviewState(pub Arc<Mutex<DashboardSystemOverview>>);

impl Default for DashboardOverviewState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(DashboardSystemOverview::default())))
    }
}

#[tauri::command]
pub fn dashboard_system_overview(
    state: tauri::State<'_, DashboardOverviewState>,
) -> DashboardSystemOverview {
    state
        .0
        .lock()
        .map(|v| v.clone())
        .unwrap_or_else(|_| DashboardSystemOverview::default())
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct CpuSample {
    idle: u64,
    kernel: u64,
    user: u64,
    initialized: bool,
}

#[cfg(target_os = "windows")]
fn cpu_sample_store() -> &'static Mutex<CpuSample> {
    static STORE: OnceLock<Mutex<CpuSample>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(CpuSample::default()))
}

#[cfg(target_os = "windows")]
fn filetime_to_u64(value: windows::Win32::Foundation::FILETIME) -> u64 {
    ((value.dwHighDateTime as u64) << 32) | value.dwLowDateTime as u64
}

#[cfg(target_os = "windows")]
fn read_cpu_usage_percent() -> f64 {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;

    let mut idle = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();

    if unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.is_err() {
        return 0.0;
    }

    let now = CpuSample {
        idle: filetime_to_u64(idle),
        kernel: filetime_to_u64(kernel),
        user: filetime_to_u64(user),
        initialized: true,
    };

    let mut store = match cpu_sample_store().lock() {
        Ok(v) => v,
        Err(_) => return 0.0,
    };

    if !store.initialized {
        *store = now;
        return 0.0;
    }

    let prev = *store;
    *store = now;

    let idle_delta = now.idle.saturating_sub(prev.idle);
    let kernel_delta = now.kernel.saturating_sub(prev.kernel);
    let user_delta = now.user.saturating_sub(prev.user);
    let total_delta = kernel_delta.saturating_add(user_delta);
    if total_delta == 0 {
        return 0.0;
    }
    let busy = total_delta.saturating_sub(idle_delta);
    (busy as f64 / total_delta as f64 * 100.0).clamp(0.0, 100.0)
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct ProcessSample {
    kernel: u64,
    user: u64,
    read_bytes: u64,
    write_bytes: u64,
    at_ms: u64,
    initialized: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct ProcessOverview {
    cpu_usage: Option<f64>,
    memory_used_bytes: Option<u64>,
    disk_read_bytes_per_sec: Option<u64>,
    disk_write_bytes_per_sec: Option<u64>,
}

#[cfg(target_os = "windows")]
fn process_sample_store() -> &'static Mutex<ProcessSample> {
    static STORE: OnceLock<Mutex<ProcessSample>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(ProcessSample::default()))
}

#[cfg(target_os = "windows")]
fn now_unix_ms_u64() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v| v.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn read_process_overview() -> ProcessOverview {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, GetProcessIoCounters, GetProcessTimes, IO_COUNTERS,
    };

    let process = unsafe { GetCurrentProcess() };
    let mut create = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe { GetProcessTimes(process, &mut create, &mut exit, &mut kernel, &mut user) }.is_err()
    {
        return ProcessOverview::default();
    }

    let mut mem = PROCESS_MEMORY_COUNTERS::default();
    let _ = unsafe {
        GetProcessMemoryInfo(
            process,
            &mut mem,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };

    let mut io = IO_COUNTERS::default();
    let _ = unsafe { GetProcessIoCounters(process, &mut io) };

    let now = ProcessSample {
        kernel: filetime_to_u64(kernel),
        user: filetime_to_u64(user),
        read_bytes: io.ReadTransferCount,
        write_bytes: io.WriteTransferCount,
        at_ms: now_unix_ms_u64(),
        initialized: true,
    };

    let mut out = ProcessOverview {
        cpu_usage: None,
        memory_used_bytes: Some(mem.WorkingSetSize as u64),
        disk_read_bytes_per_sec: None,
        disk_write_bytes_per_sec: None,
    };

    let mut store = match process_sample_store().lock() {
        Ok(v) => v,
        Err(_) => return out,
    };
    if !store.initialized {
        *store = now;
        return out;
    }

    let prev = *store;
    *store = now;

    let elapsed_ms = now.at_ms.saturating_sub(prev.at_ms);
    if elapsed_ms == 0 {
        return out;
    }
    let elapsed_secs = elapsed_ms as f64 / 1000.0;
    if elapsed_secs <= 0.0 {
        return out;
    }

    let proc_delta_100ns = now
        .kernel
        .saturating_sub(prev.kernel)
        .saturating_add(now.user.saturating_sub(prev.user));
    let wall_delta_100ns = elapsed_ms.saturating_mul(10_000);
    let cores = std::thread::available_parallelism()
        .map(|v| v.get() as f64)
        .unwrap_or(1.0)
        .max(1.0);

    if wall_delta_100ns > 0 {
        let cpu =
            (proc_delta_100ns as f64 / wall_delta_100ns as f64 / cores * 100.0).clamp(0.0, 100.0);
        out.cpu_usage = Some(cpu);
    }

    let read_delta = now.read_bytes.saturating_sub(prev.read_bytes);
    let write_delta = now.write_bytes.saturating_sub(prev.write_bytes);
    out.disk_read_bytes_per_sec = Some((read_delta as f64 / elapsed_secs).round() as u64);
    out.disk_write_bytes_per_sec = Some((write_delta as f64 / elapsed_secs).round() as u64);

    out
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct GpuMemoryOverview {
    local_used_bytes: u64,
    local_total_bytes: u64,
    shared_used_bytes: u64,
    shared_total_bytes: u64,
}

#[cfg(target_os = "windows")]
fn read_primary_gpu_memory_overview() -> Option<GpuMemoryOverview> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIAdapter3, IDXGIFactory1, DXGI_ADAPTER_DESC1,
        DXGI_MEMORY_SEGMENT_GROUP_LOCAL, DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL,
        DXGI_QUERY_VIDEO_MEMORY_INFO,
    };

    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1().ok()? };

    let mut index: u32 = 0;
    let mut selected: Option<(u64, GpuMemoryOverview)> = None;
    loop {
        let adapter: IDXGIAdapter1 = match unsafe { factory.EnumAdapters1(index) } {
            Ok(v) => v,
            Err(_) => break,
        };
        index = index.saturating_add(1);

        let desc: DXGI_ADAPTER_DESC1 = match unsafe { adapter.GetDesc1() } {
            Ok(v) => v,
            Err(_) => continue,
        };
        let adapter3: IDXGIAdapter3 = match adapter.cast() {
            Ok(v) => v,
            Err(_) => continue,
        };

        let mut local = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
        let mut shared = DXGI_QUERY_VIDEO_MEMORY_INFO::default();
        let local_ok = unsafe {
            adapter3.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &mut local)
        }
        .is_ok();
        let shared_ok = unsafe {
            adapter3.QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_NON_LOCAL, &mut shared)
        }
        .is_ok();
        if !local_ok && !shared_ok {
            continue;
        }

        let local_total = if local.Budget > 0 {
            local.Budget as u64
        } else {
            desc.DedicatedVideoMemory as u64
        };
        let shared_total = if shared.Budget > 0 {
            shared.Budget as u64
        } else {
            desc.SharedSystemMemory as u64
        };
        let item = GpuMemoryOverview {
            local_used_bytes: local.CurrentUsage as u64,
            local_total_bytes: local_total,
            shared_used_bytes: shared.CurrentUsage as u64,
            shared_total_bytes: shared_total,
        };
        let score = local_total.max(shared_total);
        match selected {
            Some((best_score, _)) if best_score >= score => {}
            _ => selected = Some((score, item)),
        }
    }

    selected.map(|(_, v)| v).filter(|v| {
        v.local_total_bytes > 0
            || v.local_used_bytes > 0
            || v.shared_total_bytes > 0
            || v.shared_used_bytes > 0
    })
}

#[cfg(target_os = "windows")]
fn read_gpu_usage_percent_by_counter() -> (Option<f64>, Option<f64>) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let pid = std::process::id();
    let script = format!(
        r#"$ErrorActionPreference='SilentlyContinue'
$samples = (Get-Counter '\GPU Engine(*)\Utilization Percentage').CounterSamples
if (-not $samples) {{ '' ; exit 0 }}
$system = ($samples | Measure-Object -Property CookedValue -Maximum).Maximum
$process = ($samples | Where-Object {{ $_.InstanceName -like '*pid_{pid}_*' }} | Measure-Object -Property CookedValue -Maximum).Maximum
if ($null -eq $system) {{ $system = 0 }}
if ($null -eq $process) {{ $process = 0 }}
[PSCustomObject]@{{system=[double]$system;process=[double]$process}} | ConvertTo-Json -Compress"#
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoLogo", "-NoProfile", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let Ok(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return (None, None);
    }
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    let system = parsed
        .get("system")
        .and_then(|v| v.as_f64())
        .map(|v| v.clamp(0.0, 100.0));
    let process = parsed
        .get("process")
        .and_then(|v| v.as_f64())
        .map(|v| v.clamp(0.0, 100.0));
    (system, process)
}

#[cfg(target_os = "windows")]
fn to_wide_null(input: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(input)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn collect_windows_overview() -> DashboardSystemOverview {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::System::SystemInformation::{
        GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    let mut out = DashboardSystemOverview::default();
    out.cpu_usage = read_cpu_usage_percent();

    let mut mem = MEMORYSTATUSEX::default();
    mem.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut mem) }.is_ok() {
        out.memory_total_bytes = mem.ullTotalPhys;
        out.memory_used_bytes = mem.ullTotalPhys.saturating_sub(mem.ullAvailPhys);
    }

    let process = read_process_overview();
    out.app_cpu_usage = process.cpu_usage;
    out.app_memory_used_bytes = process.memory_used_bytes;
    out.app_disk_read_bytes_per_sec = process.disk_read_bytes_per_sec;
    out.app_disk_write_bytes_per_sec = process.disk_write_bytes_per_sec;

    let drive = std::env::var("SystemDrive")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "C:".to_string());
    let root = format!("{}\\", drive.trim_end_matches('\\'));
    let wide = to_wide_null(&root);
    let mut free_available = 0u64;
    let mut total = 0u64;
    let mut free_total = 0u64;
    if unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(wide.as_ptr()),
            Some(&mut free_available),
            Some(&mut total),
            Some(&mut free_total),
        )
    }
    .is_ok()
    {
        out.disk_total_bytes = total;
        out.disk_used_bytes = total.saturating_sub(free_total);
    }

    if let Some(gpu_mem) = read_primary_gpu_memory_overview() {
        out.gpu_memory_used_bytes = Some(gpu_mem.local_used_bytes);
        out.gpu_memory_total_bytes = Some(gpu_mem.local_total_bytes);
        out.gpu_memory_shared_used_bytes = Some(gpu_mem.shared_used_bytes);
        out.gpu_memory_shared_total_bytes = Some(gpu_mem.shared_total_bytes);
        out.gpu_adapter_dedicated_used_bytes = Some(gpu_mem.local_used_bytes);
        out.gpu_adapter_shared_used_bytes = Some(gpu_mem.shared_used_bytes);
        out.app_gpu_memory_used_bytes = Some(gpu_mem.local_used_bytes);
        out.app_gpu_memory_total_bytes = Some(gpu_mem.local_total_bytes);

        if out.gpu_usage.is_none() && gpu_mem.local_total_bytes > 0 {
            out.gpu_usage = Some(
                (gpu_mem.local_used_bytes as f64 / gpu_mem.local_total_bytes as f64 * 100.0)
                    .clamp(0.0, 100.0),
            );
        }
        if out.app_gpu_usage.is_none() && gpu_mem.local_total_bytes > 0 {
            out.app_gpu_usage = Some(
                (gpu_mem.local_used_bytes as f64 / gpu_mem.local_total_bytes as f64 * 100.0)
                    .clamp(0.0, 100.0),
            );
        }
    }

    let (gpu_system, gpu_process) = read_gpu_usage_percent_by_counter();
    if gpu_system.is_some() {
        out.gpu_usage = gpu_system;
    }
    if gpu_process.is_some() {
        out.app_gpu_usage = gpu_process;
    }

    // Uptime is intentionally rounded to minute-level granularity.
    out.uptime_secs = (unsafe { GetTickCount64() } / 1000 / 60) * 60;
    out.host_name = static_host_name();
    out.os_name = Some("windows".to_string());
    out
}

#[cfg(not(target_os = "windows"))]
fn collect_windows_overview() -> DashboardSystemOverview {
    DashboardSystemOverview::default()
}

pub fn start_system_overview_sampler(app: tauri::AppHandle, state: DashboardOverviewState) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let mut overview = collect_windows_overview();
            if let Ok(mut guard) = state.0.lock() {
                if guard.host_name.is_some() {
                    overview.host_name = guard.host_name.clone();
                }
                *guard = overview.clone();
            }
            let _ = handle.emit(EVENT_SYSTEM_OVERVIEW_UPDATED, overview);
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}
