use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use url::Url;

const DEFAULT_UPDATER_ENDPOINT: &str = "http://192.168.1.120:1421/latest.json";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdaterConfig {
    pub endpoint: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdaterCheckResult {
    pub available: bool,
    pub current_version: Option<String>,
    pub version: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UpdaterEndpointProbeResult {
    pub reachable: bool,
    pub status: Option<u16>,
    pub elapsed_ms: Option<u128>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct UpdaterStatusEvent {
    state: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterDownloadEvent {
    chunk_length: usize,
    content_length: Option<u64>,
}

fn updater_config_path() -> PathBuf {
    crate::settings::get_music_data_dir()
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("updater.json")
}

fn normalize_endpoint_input(input: &str) -> String {
    let trimmed = input.trim().trim_matches(|c| c == '"' || c == '\'');
    if trimmed.is_empty() {
        return String::new();
    }

    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };

    let Ok(mut url) = Url::parse(&with_scheme) else {
        return trimmed.to_string();
    };

    if matches!(url.path(), "" | "/") {
        let _ = url.set_path("/latest.json");
    }

    if url.host_str() == Some("192.168.1.120") && url.port().is_none() {
        let _ = url.set_port(Some(1421));
    }

    url.to_string()
}

fn default_config() -> UpdaterConfig {
    UpdaterConfig {
        endpoint: DEFAULT_UPDATER_ENDPOINT.to_string(),
    }
}

fn load_config() -> UpdaterConfig {
    let path = updater_config_path();
    let Ok(text) = std::fs::read_to_string(path) else {
        return default_config();
    };
    let parsed = serde_json::from_str::<UpdaterConfig>(&text).unwrap_or_else(|_| default_config());
    let normalized = normalize_endpoint_input(&parsed.endpoint);
    if normalized.trim().is_empty() {
        default_config()
    } else {
        UpdaterConfig {
            endpoint: normalized,
        }
    }
}

fn save_config(value: &UpdaterConfig) -> Result<(), String> {
    let path = updater_config_path();
    crate::settings::ensure_parent(&path)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn config_store() -> &'static Mutex<UpdaterConfig> {
    static STORE: OnceLock<Mutex<UpdaterConfig>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(load_config()))
}

#[tauri::command]
pub fn updater_get_config() -> Result<UpdaterConfig, String> {
    config_store()
        .lock()
        .map(|v| v.clone())
        .map_err(|_| "updater config lock poisoned".to_string())
}

#[tauri::command]
pub fn updater_set_config(endpoint: String) -> Result<(), String> {
    let mut guard = config_store()
        .lock()
        .map_err(|_| "updater config lock poisoned".to_string())?;
    let normalized = normalize_endpoint_input(&endpoint);
    guard.endpoint = if normalized.trim().is_empty() {
        DEFAULT_UPDATER_ENDPOINT.to_string()
    } else {
        normalized
    };
    save_config(&guard)
}

fn normalize_version_tag(v: &str) -> String {
    v.trim().trim_start_matches('v').to_ascii_lowercase()
}

fn parse_semver(v: &str) -> Option<(u64, u64, u64)> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?i)^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$")
            .expect("invalid semver regex")
    });

    let captures = re.captures(v)?;
    let major = captures.get(1)?.as_str().parse::<u64>().ok()?;
    let minor = captures.get(2)?.as_str().parse::<u64>().ok()?;
    let patch = captures.get(3)?.as_str().parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn compare_semver(left: &str, right: &str) -> Option<Ordering> {
    let l = parse_semver(left)?;
    let r = parse_semver(right)?;
    Some(l.cmp(&r))
}

fn extract_note_version(body: &str) -> Option<String> {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        regex::Regex::new(r"(?i)\[\s*halo\s*v?(\d+\.\d+\.\d+)\s*\]")
            .expect("invalid note version regex")
    });
    let caps = re.captures(body)?;
    Some(caps.get(1)?.as_str().to_string())
}

fn first_non_empty_string(payload: &serde_json::Value, pointers: &[&str]) -> Option<String> {
    pointers.iter().find_map(|pointer| {
        payload
            .pointer(pointer)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn parse_check_result(payload: &serde_json::Value) -> UpdaterCheckResult {
    let current = env!("CARGO_PKG_VERSION").trim().to_string();
    let latest_raw = first_non_empty_string(
        payload,
        &[
            "/version",
            "/tag_name",
            "/data/version",
            "/data/tag_name",
            "/latest/version",
            "/latest/tag_name",
        ],
    );
    let date = first_non_empty_string(
        payload,
        &[
            "/pub_date",
            "/date",
            "/published_at",
            "/data/pub_date",
            "/data/date",
            "/latest/pub_date",
            "/latest/date",
        ],
    );
    let body = first_non_empty_string(
        payload,
        &[
            "/notes",
            "/body",
            "/release_notes",
            "/data/notes",
            "/data/body",
            "/latest/notes",
            "/latest/body",
        ],
    );

    let relation = latest_raw
        .as_deref()
        .and_then(|v| compare_semver(v, &current));

    let available = match relation {
        Some(Ordering::Greater) => true,
        Some(Ordering::Equal | Ordering::Less) => false,
        None => latest_raw
            .as_deref()
            .map(|v| normalize_version_tag(v) != normalize_version_tag(&current))
            .unwrap_or(false),
    };

    let version = match relation {
        Some(Ordering::Greater) => latest_raw.clone(),
        Some(Ordering::Equal | Ordering::Less) => Some(current.clone()),
        None => latest_raw.clone(),
    };

    let body = if available {
        match (body, version.as_deref()) {
            (Some(content), Some(latest)) => {
                if let Some(note_version) = extract_note_version(&content) {
                    if compare_semver(&note_version, latest) != Some(Ordering::Equal) {
                        None
                    } else {
                        Some(content)
                    }
                } else {
                    Some(content)
                }
            }
            (other, _) => other,
        }
    } else {
        None
    };

    UpdaterCheckResult {
        available,
        current_version: Some(current),
        version,
        date,
        body,
    }
}

fn pick_update_payload_root(payload: serde_json::Value) -> serde_json::Value {
    if let Some(v) = payload.get("latest").filter(|v| v.is_object()) {
        return v.clone();
    }
    if let Some(v) = payload.get("data").filter(|v| v.is_object()) {
        return v.clone();
    }
    payload
}

fn absolutize_url(base: &str, candidate: &str) -> Option<String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return None;
    }

    if Url::parse(trimmed).is_ok() {
        return Some(trimmed.to_string());
    }

    let base_url = Url::parse(base).ok()?;
    base_url.join(trimmed).ok().map(|v| v.to_string())
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const PLATFORM_KEYS: &[&str] = &["windows-x86_64", "windows-x86_64-msvc", "windows_x86_64"];
#[cfg(all(target_os = "windows", target_arch = "x86"))]
const PLATFORM_KEYS: &[&str] = &["windows-i686", "windows-x86", "windows_i686"];
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const PLATFORM_KEYS: &[&str] = &["windows-aarch64", "windows_arm64", "windows-aarch64-msvc"];
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const PLATFORM_KEYS: &[&str] = &["linux-x86_64", "linux_x86_64"];
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const PLATFORM_KEYS: &[&str] = &["darwin-x86_64", "macos-x86_64"];
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const PLATFORM_KEYS: &[&str] = &["darwin-aarch64", "macos-aarch64"];
#[cfg(not(any(
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86"),
    all(target_os = "windows", target_arch = "aarch64"),
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64"),
)))]
const PLATFORM_KEYS: &[&str] = &[];

#[cfg(target_os = "windows")]
fn windows_installer_rank(url: &str) -> Option<u8> {
    let lower = url.to_ascii_lowercase();
    if lower.ends_with(".exe") || lower.contains(".exe?") {
        Some(0)
    } else if lower.ends_with(".msi") || lower.contains(".msi?") {
        Some(1)
    } else {
        None
    }
}

fn pick_download_url(payload: &serde_json::Value, endpoint: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    let mut preferred_windows_installer = None::<(u8, String)>;
    let mut fallback = None::<String>;

    let direct = first_non_empty_string(
        payload,
        &[
            "/url",
            "/downloadUrl",
            "/download_url",
            "/installer",
            "/installerUrl",
            "/installer_url",
            "/artifact/url",
        ],
    )
    .and_then(|v| absolutize_url(endpoint, &v));
    if let Some(url) = direct {
        #[cfg(target_os = "windows")]
        {
            if let Some(rank) = windows_installer_rank(&url) {
                preferred_windows_installer = Some((rank, url.clone()));
            } else if fallback.is_none() {
                fallback = Some(url.clone());
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            return Some(url);
        }
    }

    if let Some(platforms) = payload.get("platforms").and_then(|v| v.as_object()) {
        for key in PLATFORM_KEYS {
            if let Some(url) = platforms
                .get(*key)
                .and_then(|v| v.get("url"))
                .and_then(|v| v.as_str())
                .and_then(|v| absolutize_url(endpoint, v))
            {
                #[cfg(target_os = "windows")]
                {
                    if let Some(rank) = windows_installer_rank(&url) {
                        let should_replace = preferred_windows_installer
                            .as_ref()
                            .map(|(current_rank, _)| rank < *current_rank)
                            .unwrap_or(true);
                        if should_replace {
                            preferred_windows_installer = Some((rank, url.clone()));
                        }
                    } else if fallback.is_none() {
                        fallback = Some(url.clone());
                    }
                    continue;
                }

                #[cfg(not(target_os = "windows"))]
                {
                    return Some(url);
                }
            }
        }

        if let Some(url) = platforms.values().find_map(|entry| {
            entry
                .get("url")
                .and_then(|v| v.as_str())
                .and_then(|v| absolutize_url(endpoint, v))
        }) {
            #[cfg(target_os = "windows")]
            {
                if let Some(rank) = windows_installer_rank(&url) {
                    let should_replace = preferred_windows_installer
                        .as_ref()
                        .map(|(current_rank, _)| rank < *current_rank)
                        .unwrap_or(true);
                    if should_replace {
                        preferred_windows_installer = Some((rank, url.clone()));
                    }
                } else if fallback.is_none() {
                    fallback = Some(url.clone());
                }
            }

            #[cfg(not(target_os = "windows"))]
            {
                return Some(url);
            }
        }
    }

    if let Some(items) = payload.get("assets").and_then(|v| v.as_array()) {
        for item in items {
            let Some(url) = item
                .get("url")
                .or_else(|| item.get("browser_download_url"))
                .or_else(|| item.get("downloadUrl"))
                .or_else(|| item.get("download_url"))
                .and_then(|v| v.as_str())
                .and_then(|v| absolutize_url(endpoint, v))
            else {
                continue;
            };

            #[cfg(target_os = "windows")]
            {
                if let Some(next_rank) = windows_installer_rank(&url) {
                    let should_replace = preferred_windows_installer
                        .as_ref()
                        .map(|(current_rank, _)| next_rank < *current_rank)
                        .unwrap_or(true);
                    if should_replace {
                        preferred_windows_installer = Some((next_rank, url.clone()));
                    }
                    continue;
                }
            }

            if fallback.is_none() {
                fallback = Some(url);
            }
        }
    }

    #[cfg(target_os = "windows")]
    if let Some((_, url)) = preferred_windows_installer {
        return Some(url);
    }

    if fallback.is_some() {
        return fallback;
    }

    None
}

fn safe_file_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect();
    cleaned.trim().to_string()
}

fn infer_download_file_name(download_url: &str, version: Option<&str>) -> String {
    if let Ok(parsed) = Url::parse(download_url) {
        if let Some(name) = parsed
            .path_segments()
            .and_then(|mut it| it.next_back())
            .filter(|v| !v.trim().is_empty())
        {
            let clean = safe_file_name(name);
            if !clean.is_empty() {
                return clean;
            }
        }
    }

    let suffix = version
        .map(|v| {
            v.chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
        })
        .unwrap_or_else(|| "latest".to_string());
    #[cfg(target_os = "windows")]
    let ext = ".exe";
    #[cfg(not(target_os = "windows"))]
    let ext = ".bin";
    format!("halo_update_{suffix}{ext}")
}

fn updater_download_dir() -> PathBuf {
    std::env::temp_dir().join("halo-updater")
}

fn emit_status(app: &tauri::AppHandle, state: &str) {
    let _ = app.emit(
        "updater:status",
        UpdaterStatusEvent {
            state: state.to_string(),
        },
    );
}

fn emit_download_progress(
    app: &tauri::AppHandle,
    chunk_length: usize,
    content_length: Option<u64>,
) {
    let _ = app.emit(
        "updater:download",
        UpdaterDownloadEvent {
            chunk_length,
            content_length,
        },
    );
}

fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Payload cache — avoids re-fetching the update manifest within a short window.
// Both `updater_check` and `updater_download_and_install` share this cache,
// so a check→install sequence only issues one network request.
// ---------------------------------------------------------------------------
struct PayloadCache {
    payload: serde_json::Value,
    endpoint: String,
    fetched_at: Instant,
}

fn payload_cache() -> &'static Mutex<Option<PayloadCache>> {
    static CACHE: OnceLock<Mutex<Option<PayloadCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

async fn fetch_update_payload(endpoint: &str) -> Result<serde_json::Value, String> {
    let client = build_client(12)?;
    let resp = client
        .get(endpoint.trim())
        .send()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("更新源响应异常: HTTP {}", resp.status()));
    }

    let payload = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("更新源 JSON 解析失败: {e}"))?;
    Ok(pick_update_payload_root(payload))
}

/// Fetch the update manifest, reusing a cached copy if it was fetched
/// within the last 60 seconds from the same endpoint.
async fn fetch_update_payload_cached(endpoint: &str) -> Result<serde_json::Value, String> {
    const TTL_SECS: u64 = 60;

    // Try to return a cached entry first (lock is released before the await).
    let cached = payload_cache().lock().ok().and_then(|guard| {
        guard.as_ref().and_then(|entry| {
            if entry.endpoint == endpoint && entry.fetched_at.elapsed().as_secs() < TTL_SECS {
                Some(entry.payload.clone())
            } else {
                None
            }
        })
    });

    if let Some(payload) = cached {
        return Ok(payload);
    }

    // Cache miss — do a real fetch.
    let payload = fetch_update_payload(endpoint).await?;

    if let Ok(mut guard) = payload_cache().lock() {
        *guard = Some(PayloadCache {
            payload: payload.clone(),
            endpoint: endpoint.to_string(),
            fetched_at: Instant::now(),
        });
    }

    Ok(payload)
}

/// Invalidate the cache so the next check always fetches a fresh copy.
fn invalidate_payload_cache() {
    if let Ok(mut guard) = payload_cache().lock() {
        *guard = None;
    }
}

async fn download_update_file(
    app: &tauri::AppHandle,
    download_url: &str,
    target_path: &Path,
) -> Result<(), String> {
    let client = build_client(180)?;
    let mut resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("下载安装包失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载安装包失败: HTTP {}", resp.status()));
    }

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content_length = resp.content_length();
    let mut file = tokio::fs::File::create(target_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("下载数据失败: {e}"))?
    {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        emit_download_progress(app, chunk.len(), content_length);
    }
    file.flush().await.map_err(|e| e.to_string())?;

    if downloaded == 0 {
        return Err("下载安装包失败: 空响应".to_string());
    }

    Ok(())
}

/// Download with automatic retry on failure.
/// Waits 2 s before the second attempt and 4 s before the third.
/// Any partial file is removed before each retry.
async fn download_update_file_with_retry(
    app: &tauri::AppHandle,
    download_url: &str,
    target_path: &Path,
) -> Result<(), String> {
    const MAX_ATTEMPTS: u32 = 3;
    let mut last_err = String::new();

    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            let delay_secs = 2u64.pow(attempt - 1); // 2 s, then 4 s
            tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
            // Remove any partial file from the previous attempt.
            let _ = tokio::fs::remove_file(target_path).await;
        }

        match download_update_file(app, download_url, target_path).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = e;
            }
        }
    }

    Err(format!(
        "下载安装包失败（已重试 {} 次）：{}",
        MAX_ATTEMPTS - 1,
        last_err
    ))
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsInstallerKind {
    Unknown,
    Msi,
    Exe,
}

#[cfg(target_os = "windows")]
fn detect_installed_windows_installer_kind(install_dir: Option<&Path>) -> WindowsInstallerKind {
    let Some(dir) = install_dir else {
        return WindowsInstallerKind::Unknown;
    };

    let uninstall_link = dir.join("Uninstall Halo.lnk");
    if uninstall_link.exists() {
        return WindowsInstallerKind::Msi;
    }

    let uninstall_exe = dir.join("uninstall.exe");
    if uninstall_exe.exists() {
        return WindowsInstallerKind::Exe;
    }

    WindowsInstallerKind::Unknown
}

#[cfg(target_os = "windows")]
fn detect_package_windows_installer_kind(target_path: &Path) -> WindowsInstallerKind {
    match target_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "msi" => WindowsInstallerKind::Msi,
        "exe" => WindowsInstallerKind::Exe,
        _ => WindowsInstallerKind::Unknown,
    }
}

#[cfg(target_os = "windows")]
fn clean_windows_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        value
    }
}

#[cfg(target_os = "windows")]
fn build_windows_installer_script(
    ext: &str,
    installer_path: &str,
    install_dir: Option<&Path>,
) -> String {
    if ext == "msi" {
        let dir_arg = install_dir
            .map(clean_windows_path)
            .map(|d| format!("INSTALLDIR=\"{d}\""))
            .unwrap_or_default();
        format!(
            "timeout /t 3 /nobreak >nul & start \"\" /wait msiexec /i \"{installer}\" /qn /norestart {dir}",
            installer = installer_path,
            dir = dir_arg,
        )
    } else {
        let dir_arg = install_dir
            .map(clean_windows_path)
            .map(|d| format!("/D=\"{d}\""))
            .unwrap_or_default();
        format!(
            "timeout /t 3 /nobreak >nul & start \"\" /wait \"{installer}\" /S {dir}",
            installer = installer_path,
            dir = dir_arg,
        )
    }
}

#[cfg(target_os = "windows")]
fn launch_installer(target_path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let ext = target_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    let current_exe = std::env::current_exe().ok();
    let install_dir = current_exe
        .as_ref()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());
    let installed_kind = detect_installed_windows_installer_kind(install_dir.as_deref());
    let package_kind = detect_package_windows_installer_kind(target_path);

    if matches!(
        (installed_kind, package_kind),
        (WindowsInstallerKind::Msi, WindowsInstallerKind::Exe)
            | (WindowsInstallerKind::Exe, WindowsInstallerKind::Msi)
    ) {
        return Err(format!(
            "检测到当前安装类型与更新包类型不一致：当前为 {}，更新包为 {}。为避免生成重复安装，请发布相同类型的安装包，或先手动卸载后重装一次。",
            match installed_kind {
                WindowsInstallerKind::Msi => "MSI",
                WindowsInstallerKind::Exe => "EXE",
                WindowsInstallerKind::Unknown => "未知",
            },
            match package_kind {
                WindowsInstallerKind::Msi => "MSI",
                WindowsInstallerKind::Exe => "EXE",
                WindowsInstallerKind::Unknown => "未知",
            }
        ));
    }

    // Strategy: spawn a hidden cmd.exe that:
    //   1. Waits 3 s for app.exit(0) to release file locks
    //   2. Runs the installer silently via `start /wait`
    //
    // We intentionally do NOT `start` the current exe again here.
    // On Windows, `current_exe()` may include a verbatim `\\?\` prefix, which
    // breaks `cmd start` and triggers "Windows 找不到文件 '\\'". Re-launching
    // here can also create duplicate processes or duplicate app entries when
    // the installer already performs its own restart/shortcut handling.
    let installer_path = clean_windows_path(target_path);
    let script = build_windows_installer_script(&ext, &installer_path, install_dir.as_deref());

    std::process::Command::new("cmd")
        .args(["/c", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("启动安装脚本失败: {e}"))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_installer(_target_path: &Path) -> Result<(), String> {
    Err("当前平台暂不支持自动安装".to_string())
}

#[tauri::command]
pub async fn updater_check() -> Result<UpdaterCheckResult, String> {
    let endpoint = config_store()
        .lock()
        .map_err(|_| "updater config lock poisoned".to_string())?
        .endpoint
        .clone();
    if endpoint.trim().is_empty() {
        return Err("更新源未配置".to_string());
    }

    // Use the shared payload cache so a subsequent download_and_install call
    // within 60 s reuses this result without an extra network round-trip.
    let payload = fetch_update_payload_cached(endpoint.trim()).await?;
    Ok(parse_check_result(&payload))
}

#[tauri::command]
pub async fn updater_download_and_install(app: tauri::AppHandle) -> Result<(), String> {
    let endpoint = config_store()
        .lock()
        .map_err(|_| "updater config lock poisoned".to_string())?
        .endpoint
        .clone();
    if endpoint.trim().is_empty() {
        return Err("更新源未配置".to_string());
    }

    // Reuse the cached manifest from a preceding updater_check call (if within
    // the 60-second TTL) so we never make duplicate network trips.
    let payload = fetch_update_payload_cached(endpoint.trim()).await?;
    let check = parse_check_result(&payload);
    if !check.available {
        return Err("no_update".to_string());
    }

    let download_url = pick_download_url(&payload, endpoint.trim())
        .ok_or_else(|| "更新源未提供可下载安装包地址".to_string())?;
    let file_name = infer_download_file_name(&download_url, check.version.as_deref());
    let target_path = updater_download_dir().join(file_name);

    emit_status(&app, "downloading");
    // Retry up to 3 times with exponential back-off (2 s, 4 s) to handle
    // transient network failures.
    download_update_file_with_retry(&app, &download_url, &target_path).await?;
    emit_status(&app, "downloaded");

    // Invalidate the cache after a successful download so that the user can
    // trigger a fresh check after a future version is published.
    invalidate_payload_cache();

    launch_installer(&target_path)?;
    emit_status(&app, "installed");

    // Give the frontend 800 ms to receive the "installed" status before we exit.
    // The installer (NSIS/MSI) will launch the new version itself once the old
    // process releases its file locks.
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    app.exit(0);

    Ok(())
}

#[tauri::command]
pub async fn updater_probe_endpoint(
    endpoint: Option<String>,
) -> Result<UpdaterEndpointProbeResult, String> {
    let target = endpoint
        .filter(|v| !v.trim().is_empty())
        .or_else(|| config_store().lock().ok().map(|v| v.endpoint.clone()))
        .unwrap_or_default();

    if target.trim().is_empty() {
        return Ok(UpdaterEndpointProbeResult {
            reachable: false,
            status: None,
            elapsed_ms: None,
            message: Some("更新源为空".to_string()),
        });
    }

    let client = build_client(8)?;

    let started = Instant::now();
    let resp = client.get(target.trim()).send().await;
    match resp {
        Ok(v) => Ok(UpdaterEndpointProbeResult {
            reachable: v.status().is_success(),
            status: Some(v.status().as_u16()),
            elapsed_ms: Some(started.elapsed().as_millis()),
            message: if v.status().is_success() {
                Some("连接成功".to_string())
            } else {
                Some(format!("HTTP {}", v.status()))
            },
        }),
        Err(e) => Ok(UpdaterEndpointProbeResult {
            reachable: false,
            status: None,
            elapsed_ms: Some(started.elapsed().as_millis()),
            message: Some(format!("连接失败: {e}")),
        }),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[cfg(target_os = "windows")]
    use std::path::Path;

    #[cfg(target_os = "windows")]
    use super::{
        build_windows_installer_script, clean_windows_path,
        detect_installed_windows_installer_kind, detect_package_windows_installer_kind,
        WindowsInstallerKind,
    };
    use super::{infer_download_file_name, parse_check_result, pick_download_url};

    #[test]
    fn check_result_treats_v_prefix_as_same_version() {
        let payload = json!({ "version": format!("v{}", env!("CARGO_PKG_VERSION")) });
        let result = parse_check_result(&payload);
        assert!(!result.available);
    }

    #[test]
    fn pick_download_url_prefers_platform_url() {
        let payload = json!({
            "version": "0.9.0",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://example.com/HaloSetup.msi"
                }
            }
        });
        let url = pick_download_url(&payload, "https://example.com/latest.json")
            .expect("missing download url");
        assert!(url.contains("HaloSetup.msi"));
    }

    #[test]
    fn pick_download_url_supports_relative_url() {
        let payload = json!({ "url": "./downloads/HaloSetup.exe" });
        let url = pick_download_url(&payload, "https://updates.example.com/latest.json")
            .expect("missing download url");
        assert_eq!(url, "https://updates.example.com/downloads/HaloSetup.exe");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn pick_download_url_prefers_exe_over_msi_from_assets() {
        let payload = json!({
            "assets": [
                { "url": "https://updates.example.com/HaloSetup.msi" },
                { "url": "https://updates.example.com/HaloSetup.exe" }
            ]
        });
        let url = pick_download_url(&payload, "https://updates.example.com/latest.json")
            .expect("missing download url");
        assert!(url.ends_with("HaloSetup.exe"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn pick_download_url_prefers_exe_over_direct_msi() {
        let payload = json!({
            "url": "https://updates.example.com/HaloSetup.msi",
            "assets": [
                { "url": "https://updates.example.com/HaloSetup.exe" }
            ]
        });
        let url = pick_download_url(&payload, "https://updates.example.com/latest.json")
            .expect("missing download url");
        assert!(url.ends_with("HaloSetup.exe"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detect_installed_windows_installer_kind_recognizes_msi_marker() {
        let temp = std::env::temp_dir().join(format!(
            "halo-updater-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp).expect("tempdir");
        std::fs::write(temp.join("Uninstall Halo.lnk"), b"shortcut").expect("marker");
        assert_eq!(
            detect_installed_windows_installer_kind(Some(&temp)),
            WindowsInstallerKind::Msi
        );
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn detect_package_windows_installer_kind_uses_extension() {
        assert_eq!(
            detect_package_windows_installer_kind(Path::new("HaloSetup.msi")),
            WindowsInstallerKind::Msi
        );
        assert_eq!(
            detect_package_windows_installer_kind(Path::new("HaloSetup.exe")),
            WindowsInstallerKind::Exe
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn clean_windows_path_removes_verbatim_prefix() {
        assert_eq!(
            clean_windows_path(Path::new(r"\\?\D:\Halo\HaloSetup.exe")),
            r"D:\Halo\HaloSetup.exe"
        );
        assert_eq!(
            clean_windows_path(Path::new(r"\\?\UNC\server\share\HaloSetup.exe")),
            r"\\server\share\HaloSetup.exe"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn build_windows_installer_script_uses_clean_paths() {
        let script = build_windows_installer_script(
            "exe",
            &clean_windows_path(Path::new(r"\\?\D:\Temp\HaloSetup.exe")),
            Some(Path::new(r"\\?\D:\Halo")),
        );
        assert!(script.contains(r#""D:\Temp\HaloSetup.exe""#));
        assert!(script.contains(r#"/D="D:\Halo""#));
        assert!(!script.contains(r"\\?\"));
    }

    #[test]
    fn infer_download_file_name_has_fallback() {
        let name = infer_download_file_name("not-a-valid-url", Some("v0.3.19"));
        assert!(name.starts_with("halo_update_"));
        assert!(!name.is_empty());
    }

    #[test]
    fn check_result_rejects_older_remote_version() {
        let payload = json!({ "version": "0.3.98", "notes": "old notes" });
        let result = parse_check_result(&payload);
        assert!(!result.available);
        assert_eq!(result.version, Some(env!("CARGO_PKG_VERSION").to_string()));
        assert!(result.body.is_none());
    }

    #[test]
    fn check_result_ignores_mismatched_note_version() {
        let payload = json!({
            "version": "999.0.0",
            "notes": "[Halo 0.3.15]\nold note"
        });
        let result = parse_check_result(&payload);
        assert!(result.available);
        assert_eq!(result.version, Some("999.0.0".to_string()));
        assert!(result.body.is_none());
    }
}
