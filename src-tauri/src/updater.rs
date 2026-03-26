use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::Emitter;
use tauri_plugin_updater::UpdaterExt;
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

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").trim().to_string()
}

fn updater_endpoint() -> Result<String, String> {
    let endpoint = config_store()
        .lock()
        .map_err(|_| "updater config lock poisoned".to_string())?
        .endpoint
        .clone();
    if endpoint.trim().is_empty() {
        return Err("Updater endpoint is not configured.".to_string());
    }
    Ok(endpoint)
}

fn build_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .map_err(|e| e.to_string())
}

fn build_official_updater(
    app: &tauri::AppHandle,
    endpoint: &str,
    timeout: Duration,
) -> Result<tauri_plugin_updater::Updater, String> {
    let parsed =
        Url::parse(endpoint.trim()).map_err(|e| format!("Updater endpoint is invalid: {e}"))?;

    app.updater_builder()
        .endpoints(vec![parsed])
        .map_err(|e| format!("Failed to configure updater endpoint: {e}"))?
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to initialize updater: {e}"))
}

fn map_update_result(update: &tauri_plugin_updater::Update) -> UpdaterCheckResult {
    UpdaterCheckResult {
        available: true,
        current_version: Some(update.current_version.clone()),
        version: Some(update.version.clone()),
        date: update.date.map(|value| value.to_string()),
        body: update.body.clone(),
    }
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

#[tauri::command]
pub fn updater_get_config() -> Result<UpdaterConfig, String> {
    config_store()
        .lock()
        .map(|value| value.clone())
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

#[tauri::command]
pub async fn updater_check(app: tauri::AppHandle) -> Result<UpdaterCheckResult, String> {
    let endpoint = updater_endpoint()?;
    let updater = build_official_updater(&app, &endpoint, Duration::from_secs(12))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?;

    Ok(match update {
        Some(update) => map_update_result(&update),
        None => {
            let version = current_version();
            UpdaterCheckResult {
                available: false,
                current_version: Some(version.clone()),
                version: Some(version),
                date: None,
                body: None,
            }
        }
    })
}

#[tauri::command]
pub async fn updater_download_and_install(app: tauri::AppHandle) -> Result<(), String> {
    let endpoint = updater_endpoint()?;
    let updater = build_official_updater(&app, &endpoint, Duration::from_secs(180))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for updates: {e}"))?
        .ok_or_else(|| "no_update".to_string())?;

    emit_status(&app, "downloading");
    let bytes = update
        .download(
            |chunk_length, content_length| {
                emit_download_progress(&app, chunk_length, content_length)
            },
            || emit_status(&app, "downloaded"),
        )
        .await
        .map_err(|e| format!("Failed to download update: {e}"))?;

    update
        .install(bytes)
        .map_err(|e| format!("Failed to install update: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn updater_probe_endpoint(
    endpoint: Option<String>,
) -> Result<UpdaterEndpointProbeResult, String> {
    let target = endpoint
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_endpoint_input(&value))
        .or_else(|| {
            config_store()
                .lock()
                .ok()
                .map(|value| value.endpoint.clone())
        })
        .unwrap_or_default();

    if target.trim().is_empty() {
        return Ok(UpdaterEndpointProbeResult {
            reachable: false,
            status: None,
            elapsed_ms: None,
            message: Some("Updater endpoint is empty.".to_string()),
        });
    }

    let client = build_client(8)?;
    let started = Instant::now();
    let response = client.get(target.trim()).send().await;
    match response {
        Ok(value) => Ok(UpdaterEndpointProbeResult {
            reachable: value.status().is_success(),
            status: Some(value.status().as_u16()),
            elapsed_ms: Some(started.elapsed().as_millis()),
            message: if value.status().is_success() {
                Some("Connection succeeded.".to_string())
            } else {
                Some(format!("HTTP {}", value.status()))
            },
        }),
        Err(error) => Ok(UpdaterEndpointProbeResult {
            reachable: false,
            status: None,
            elapsed_ms: Some(started.elapsed().as_millis()),
            message: Some(format!("Connection failed: {error}")),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_endpoint_input;

    #[test]
    fn normalize_endpoint_adds_default_path_and_port() {
        assert_eq!(
            normalize_endpoint_input("192.168.1.120"),
            "http://192.168.1.120:1421/latest.json"
        );
    }

    #[test]
    fn normalize_endpoint_preserves_existing_path() {
        assert_eq!(
            normalize_endpoint_input("https://updates.example.com/releases/latest.json"),
            "https://updates.example.com/releases/latest.json"
        );
    }
}
