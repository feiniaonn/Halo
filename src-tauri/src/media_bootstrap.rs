use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaBootstrapPolicy {
    pub clear_frontend_storage: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
struct MediaBootstrapMarker {
    version: String,
    executable_path: String,
    cleared_at_ms: u64,
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn executable_path_string() -> String {
    std::env::current_exe()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn marker_path(app: &AppHandle) -> std::path::PathBuf {
    let base_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("halo"));
    base_dir
        .join("bootstrap")
        .join("media-runtime-cleared.json")
}

fn persist_marker(app: &AppHandle) -> Result<(), String> {
    let marker = MediaBootstrapMarker {
        version: app.package_info().version.to_string(),
        executable_path: executable_path_string(),
        cleared_at_ms: now_unix_ms(),
    };
    let path = marker_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let payload = serde_json::to_vec_pretty(&marker).map_err(|err| err.to_string())?;
    std::fs::write(path, payload).map_err(|err| err.to_string())
}

async fn clear_backend_runtime_caches(_app: &AppHandle) -> Result<(), String> {
    crate::spider_cmds_runtime::clear_spider_execution_reports();
    crate::spider_local_service::clear_spider_local_state().await;
    let result = crate::spider_cmds::clear_spider_cached_artifacts();
    result
}

#[tauri::command]
pub async fn prepare_media_bootstrap(
    app: tauri::AppHandle,
) -> Result<MediaBootstrapPolicy, String> {
    if cfg!(debug_assertions) {
        clear_backend_runtime_caches(&app).await?;
        return Ok(MediaBootstrapPolicy {
            clear_frontend_storage: true,
            reason: Some("dev".to_string()),
        });
    }

    let marker_exists = marker_path(&app).is_file();
    if marker_exists {
        return Ok(MediaBootstrapPolicy {
            clear_frontend_storage: false,
            reason: None,
        });
    }

    clear_backend_runtime_caches(&app).await?;
    persist_marker(&app)?;
    Ok(MediaBootstrapPolicy {
        clear_frontend_storage: true,
        reason: Some("install".to_string()),
    })
}
