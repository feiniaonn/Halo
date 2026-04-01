use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const MIN_BACKGROUND_BLUR: f64 = 0.0;
const MAX_BACKGROUND_BLUR: f64 = 36.0;
const DEFAULT_BACKGROUND_BLUR: f64 = 12.0;

const DEFAULT_MINI_MODE_WIDTH: f64 = 700.0;
const DEFAULT_MINI_MODE_HEIGHT: f64 = 50.0;
const MIN_MINI_MODE_WIDTH: f64 = 400.0;
const MAX_MINI_MODE_WIDTH: f64 = 1000.0;
const MIN_MINI_MODE_HEIGHT: f64 = 20.0;
const MAX_MINI_MODE_HEIGHT: f64 = 50.0;

fn default_background_blur() -> f64 {
    DEFAULT_BACKGROUND_BLUR
}

fn default_mini_mode_width() -> f64 {
    DEFAULT_MINI_MODE_WIDTH
}

fn default_mini_mode_height() -> f64 {
    DEFAULT_MINI_MODE_HEIGHT
}

fn normalize_background_blur(value: f64) -> f64 {
    let clamped = value.clamp(MIN_BACKGROUND_BLUR, MAX_BACKGROUND_BLUR);
    (clamped * 10.0).round() / 10.0
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppSettingsResponse {
    pub storage_root: Option<String>,
    pub storage_display_path: String,
    pub legacy_roots: Vec<String>,
    pub launch_at_login: bool,
    #[serde(default)]
    pub developer_mode: bool,
    pub close_behavior: String,
    pub background_type: Option<String>,
    pub background_path: Option<String>,
    pub background_image_path: Option<String>,
    pub background_video_path: Option<String>,
    #[serde(default = "default_background_blur")]
    pub background_blur: f64,
    pub allow_component_download: bool,
    pub mini_restore_mode: String,
    #[serde(default = "default_mini_mode_width")]
    pub mini_mode_width: f64,
    #[serde(default = "default_mini_mode_height")]
    pub mini_mode_height: f64,
}

impl Default for AppSettingsResponse {
    fn default() -> Self {
        Self {
            storage_root: None,
            storage_display_path: default_storage_display_path(),
            legacy_roots: Vec::new(),
            launch_at_login: false,
            developer_mode: false,
            close_behavior: "tray".to_string(),
            background_type: Some("none".to_string()),
            background_path: None,
            background_image_path: None,
            background_video_path: None,
            background_blur: default_background_blur(),
            allow_component_download: false,
            mini_restore_mode: "both".to_string(),
            mini_mode_width: default_mini_mode_width(),
            mini_mode_height: default_mini_mode_height(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MigrationProgress {
    pub running: bool,
    pub total: u64,
    pub done: u64,
    pub current_legacy_base: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Default)]
pub struct MigrationController;

fn app_data_dir() -> PathBuf {
    if let Ok(guard) = settings_store().lock() {
        if let Some(storage_root) = guard
            .storage_root
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            return PathBuf::from(storage_root).join("HaloTemp");
        }
    }
    default_app_data_dir()
}
fn default_app_data_dir() -> PathBuf {
    if let Some(dir) = dirs::data_local_dir() {
        return dir.join("Halo");
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".halo")
}

fn default_storage_display_path() -> String {
    default_app_data_dir().to_string_lossy().to_string()
}

fn settings_file_path() -> PathBuf {
    default_app_data_dir().join("settings.json")
}

fn load_settings_from_disk() -> AppSettingsResponse {
    let path = settings_file_path();
    let Ok(text) = std::fs::read_to_string(path) else {
        return AppSettingsResponse::default();
    };
    serde_json::from_str::<AppSettingsResponse>(&text).unwrap_or_default()
}

fn save_settings_to_disk(value: &AppSettingsResponse) -> Result<(), String> {
    let path = settings_file_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn normalize_settings(mut value: AppSettingsResponse) -> AppSettingsResponse {
    value.close_behavior = match value.close_behavior.as_str() {
        "exit" | "tray" | "tray_mini" => value.close_behavior,
        _ => "tray".to_string(),
    };
    value.mini_restore_mode = match value.mini_restore_mode.as_str() {
        "button" | "double_click" | "both" => value.mini_restore_mode,
        _ => "both".to_string(),
    };

    value.mini_mode_width = value
        .mini_mode_width
        .clamp(MIN_MINI_MODE_WIDTH, MAX_MINI_MODE_WIDTH);
    value.mini_mode_height = value
        .mini_mode_height
        .clamp(MIN_MINI_MODE_HEIGHT, MAX_MINI_MODE_HEIGHT);

    value.storage_root = value
        .storage_root
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);
    value.storage_display_path = value
        .storage_root
        .as_deref()
        .map(|root| {
            PathBuf::from(root)
                .join("HaloTemp")
                .to_string_lossy()
                .to_string()
        })
        .unwrap_or_else(default_storage_display_path);

    let bg = value
        .background_type
        .clone()
        .unwrap_or_else(|| "none".to_string());
    value.background_blur = normalize_background_blur(value.background_blur);
    match bg.as_str() {
        "image" => {
            value.background_video_path = None;
            value.background_path = value.background_image_path.clone();
        }
        "video" => {
            value.background_image_path = None;
            value.background_path = value.background_video_path.clone();
        }
        _ => {
            value.background_type = Some("none".to_string());
            value.background_path = None;
            value.background_image_path = None;
            value.background_video_path = None;
        }
    }

    value
}

fn settings_store() -> &'static Mutex<AppSettingsResponse> {
    static STORE: OnceLock<Mutex<AppSettingsResponse>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(normalize_settings(load_settings_from_disk())))
}

fn update_settings<F>(mutator: F) -> Result<(), String>
where
    F: FnOnce(&mut AppSettingsResponse),
{
    let mut guard = settings_store()
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    mutator(&mut guard);
    *guard = normalize_settings(guard.clone());
    save_settings_to_disk(&guard)
}

#[tauri::command]
pub fn get_app_settings() -> Result<AppSettingsResponse, String> {
    let guard = settings_store()
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    let value = guard.clone();
    Ok(value)
}

#[tauri::command]
pub fn set_storage_root(path: Option<String>) -> Result<(), String> {
    update_settings(|s| {
        s.storage_root = path;
    })
}

#[tauri::command]
pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
    update_settings(|s| {
        s.launch_at_login = enabled;
    })
}

#[tauri::command]
pub fn set_developer_mode(enabled: bool) -> Result<(), String> {
    update_settings(|s| {
        s.developer_mode = enabled;
    })
}

#[tauri::command]
pub fn set_close_behavior(behavior: String) -> Result<(), String> {
    update_settings(|s| {
        s.close_behavior = behavior;
    })
}

#[tauri::command]
pub fn get_close_behavior() -> String {
    settings_store()
        .lock()
        .map(|v| v.close_behavior.clone())
        .unwrap_or_else(|_| "tray".to_string())
}

#[tauri::command]
pub fn set_mini_restore_mode(mode: String) -> Result<(), String> {
    update_settings(|s| {
        s.mini_restore_mode = mode;
    })
}

#[tauri::command]
pub fn set_mini_mode_size(width: f64, height: f64) -> Result<(), String> {
    update_settings(|s| {
        s.mini_mode_width = width;
        s.mini_mode_height = height;
    })
}

#[tauri::command]
pub fn set_allow_component_download(enabled: bool) -> Result<(), String> {
    update_settings(|s| {
        s.allow_component_download = enabled;
    })
}

#[tauri::command]
pub fn set_background_blur(blur: f64) -> Result<(), String> {
    update_settings(|s| {
        s.background_blur = blur;
    })
}

#[tauri::command]
pub fn prepare_video_optimizer() -> bool {
    false
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn set_background(
    background_type: Option<String>,
    background_path: Option<String>,
    backgroundType: Option<String>,
    backgroundPath: Option<String>,
) -> Result<(), String> {
    let kind = background_type
        .or(backgroundType)
        .unwrap_or_else(|| "none".to_string());
    let path = background_path.or(backgroundPath);
    update_settings(|s| {
        s.background_type = Some(kind.clone());
        match kind.as_str() {
            "image" => {
                s.background_image_path = path.clone();
                s.background_video_path = None;
                s.background_path = path.clone();
            }
            "video" => {
                s.background_video_path = path.clone();
                s.background_image_path = None;
                s.background_path = path.clone();
            }
            _ => {
                s.background_type = Some("none".to_string());
                s.background_path = None;
                s.background_image_path = None;
                s.background_video_path = None;
            }
        }
    })
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ImportBackgroundAssetArgs {
    #[serde(alias = "filePath")]
    pub file_path: String,
    pub kind: String,
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn import_background_asset(
    args: Option<ImportBackgroundAssetArgs>,
    filePath: Option<String>,
    kind: Option<String>,
) -> Result<String, String> {
    let (src_path, kind) = if let Some(payload) = args {
        (payload.file_path, payload.kind)
    } else {
        (
            filePath.ok_or_else(|| "filePath is required".to_string())?,
            kind.ok_or_else(|| "kind is required".to_string())?,
        )
    };

    let kind_norm = match kind.as_str() {
        "image" => "images",
        "video" => "videos",
        _ => return Err("kind must be image or video".to_string()),
    };

    let src = PathBuf::from(&src_path);
    if !src.is_file() {
        return Err("source file not found".to_string());
    }

    let ext = src
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let name = format!("bg_{}.{}", chrono::Local::now().timestamp_millis(), ext);
    let dst = app_data_dir()
        .join("backgrounds")
        .join(kind_norm)
        .join(name);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;

    let kind_value = if kind_norm == "images" {
        "image"
    } else {
        "video"
    };
    let dst_string = dst.to_string_lossy().to_string();
    let _ = set_background(
        Some(kind_value.to_string()),
        Some(dst_string.clone()),
        None,
        None,
    );

    Ok(dst_string)
}

#[tauri::command]
pub fn migrate_legacy_data(_remove_source: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn start_migrate_legacy_data(_remove_source: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn cancel_migrate_legacy_data() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_migration_progress() -> MigrationProgress {
    MigrationProgress::default()
}

pub fn get_music_data_dir() -> PathBuf {
    app_data_dir().join("music")
}

pub fn get_vod_data_dir() -> PathBuf {
    app_data_dir().join("vod")
}

pub fn get_ai_data_dir() -> PathBuf {
    app_data_dir().join("ai")
}

pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        default_storage_display_path, normalize_settings, AppSettingsResponse, MAX_BACKGROUND_BLUR,
    };

    #[test]
    fn default_storage_path_is_real_directory() {
        let value = AppSettingsResponse::default();
        assert_eq!(value.storage_root, None);
        assert_eq!(value.storage_display_path, default_storage_display_path());
        assert!(!value.storage_display_path.trim().is_empty());
        assert_ne!(
            value.storage_display_path.to_ascii_lowercase(),
            "default storage"
        );
    }

    #[test]
    fn custom_storage_root_display_points_to_halotemp() {
        let mut value = AppSettingsResponse::default();
        value.storage_root = Some("D:\\MyData".to_string());
        let normalized = normalize_settings(value);
        assert_eq!(
            normalized.storage_display_path.replace('/', "\\"),
            "D:\\MyData\\HaloTemp"
        );
    }

    #[test]
    fn background_blur_is_clamped() {
        let mut value = AppSettingsResponse::default();
        value.background_blur = 200.0;
        let normalized = normalize_settings(value);
        assert_eq!(normalized.background_blur, MAX_BACKGROUND_BLUR);
    }
}
