use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusicSettings {
    pub music_control_target_mode: String,
    pub music_control_timeout_ms: u64,
    pub music_control_retry_count: u8,
    #[serde(default, alias = "music_control_whitelist_source_ids")]
    pub music_control_whitelist: Vec<String>,
    pub music_mini_controls_enabled: bool,
    pub music_mini_show_stats_without_session: bool,
    pub music_mini_visible_keys: Vec<String>,
    pub music_hotkeys_enabled: bool,
    pub music_hotkeys_scope: String,
    pub music_hotkeys_bindings: HashMap<String, Option<String>>,
    pub music_lyrics_enabled: bool,
    pub music_lyrics_show_translation: bool,
    pub music_lyrics_show_romanized: bool,
    pub music_lyrics_auto_follow: bool,
    pub music_lyrics_provider_mode: String,
    pub music_lyrics_offset_ms: i64,
    pub music_lyrics_manual_lock_ms: u64,
    pub music_lyrics_font_size: u32,
    pub music_lyrics_scrape_enabled: bool,
    pub music_lyrics_scrape_notice_ack: bool,
}

impl Default for MusicSettings {
    fn default() -> Self {
        let mut bindings = HashMap::new();
        bindings.insert("play_pause".to_string(), None);
        bindings.insert("next".to_string(), None);
        bindings.insert("previous".to_string(), None);
        bindings.insert(
            "restore_mini_home".to_string(),
            Some("Control+Shift+H".to_string()),
        );

        Self {
            music_control_target_mode: "native".to_string(),
            music_control_timeout_ms: 1200,
            music_control_retry_count: 1,
            music_control_whitelist: Vec::new(),
            music_mini_controls_enabled: false,
            music_mini_show_stats_without_session: false,
            music_mini_visible_keys: vec!["play_pause".into(), "next".into()],
            music_hotkeys_enabled: false,
            music_hotkeys_scope: "focus".to_string(),
            music_hotkeys_bindings: bindings,
            music_lyrics_enabled: true,
            music_lyrics_show_translation: true,
            music_lyrics_show_romanized: false,
            music_lyrics_auto_follow: true,
            music_lyrics_provider_mode: "auto".to_string(),
            music_lyrics_offset_ms: 0,
            music_lyrics_manual_lock_ms: 8000,
            music_lyrics_font_size: 14,
            music_lyrics_scrape_enabled: false,
            music_lyrics_scrape_notice_ack: false,
        }
    }
}

fn settings_file_path() -> PathBuf {
    get_music_data_dir().join("settings.json")
}

fn normalize_settings(mut value: MusicSettings) -> MusicSettings {
    if value.music_control_target_mode == "browser" {
        value.music_control_target_mode = "native".to_string();
    } else if !matches!(value.music_control_target_mode.as_str(), "auto" | "native") {
        value.music_control_target_mode = "native".to_string();
    }
    if !matches!(value.music_hotkeys_scope.as_str(), "focus" | "global") {
        value.music_hotkeys_scope = "focus".to_string();
    }

    value.music_control_timeout_ms = value.music_control_timeout_ms.clamp(200, 5000);
    value.music_control_retry_count = value.music_control_retry_count.clamp(0, 5);
    value.music_lyrics_offset_ms = value.music_lyrics_offset_ms.clamp(-5000, 5000);
    value.music_lyrics_manual_lock_ms = value.music_lyrics_manual_lock_ms.clamp(1000, 30000);
    value.music_lyrics_font_size = value.music_lyrics_font_size.clamp(10, 40);

    if value.music_mini_visible_keys.is_empty() {
        value.music_mini_visible_keys = vec!["play_pause".into(), "next".into()];
    }

    for key in ["previous", "play_pause", "next", "restore_mini_home"] {
        value
            .music_hotkeys_bindings
            .entry(key.to_string())
            .or_insert(None);
    }

    value.music_control_whitelist = value
        .music_control_whitelist
        .into_iter()
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .collect::<Vec<_>>();
    value.music_control_whitelist.sort();
    value.music_control_whitelist.dedup();
    value.music_lyrics_enabled = true;

    value
}

fn load_settings_from_disk() -> MusicSettings {
    let path = settings_file_path();
    let Ok(text) = std::fs::read_to_string(path) else {
        return MusicSettings::default();
    };
    serde_json::from_str::<MusicSettings>(&text).unwrap_or_default()
}

fn save_settings_to_disk(value: &MusicSettings) -> Result<(), String> {
    let path = settings_file_path();
    crate::settings::ensure_parent(&path)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn settings_store() -> &'static Mutex<MusicSettings> {
    static STORE: OnceLock<Mutex<MusicSettings>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(normalize_settings(load_settings_from_disk())))
}

#[tauri::command]
pub fn get_music_settings() -> Result<MusicSettings, String> {
    let guard = settings_store()
        .lock()
        .map_err(|_| "music settings lock poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn set_music_settings(app: tauri::AppHandle, patch: serde_json::Value) -> Result<(), String> {
    let mut guard = settings_store()
        .lock()
        .map_err(|_| "music settings lock poisoned".to_string())?;

    if let Some(v) = patch
        .get("music_control_target_mode")
        .and_then(|v| v.as_str())
    {
        guard.music_control_target_mode = v.to_string();
    }
    if let Some(v) = patch
        .get("music_control_timeout_ms")
        .and_then(|v| v.as_u64())
    {
        guard.music_control_timeout_ms = v;
    }
    if let Some(v) = patch
        .get("music_control_retry_count")
        .and_then(|v| v.as_u64())
    {
        guard.music_control_retry_count = v as u8;
    }

    let whitelist_value = patch
        .get("music_control_whitelist")
        .or_else(|| patch.get("music_control_whitelist_source_ids"));
    if let Some(v) = whitelist_value.and_then(|v| v.as_array()) {
        guard.music_control_whitelist = v
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
    }

    if let Some(v) = patch
        .get("music_mini_controls_enabled")
        .and_then(|v| v.as_bool())
    {
        guard.music_mini_controls_enabled = v;
    }
    if let Some(v) = patch
        .get("music_mini_show_stats_without_session")
        .and_then(|v| v.as_bool())
    {
        guard.music_mini_show_stats_without_session = v;
    }
    if let Some(v) = patch
        .get("music_mini_visible_keys")
        .and_then(|v| v.as_array())
    {
        guard.music_mini_visible_keys = v
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .collect();
    }

    if let Some(v) = patch.get("music_hotkeys_enabled").and_then(|v| v.as_bool()) {
        guard.music_hotkeys_enabled = v;
    }
    if let Some(v) = patch.get("music_hotkeys_scope").and_then(|v| v.as_str()) {
        guard.music_hotkeys_scope = v.to_string();
    }
    if let Some(obj) = patch
        .get("music_hotkeys_bindings")
        .and_then(|v| v.as_object())
    {
        let mut next = guard.music_hotkeys_bindings.clone();
        for (k, v) in obj {
            if v.is_null() {
                next.insert(k.clone(), None);
            } else if let Some(s) = v.as_str() {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    next.insert(k.clone(), None);
                } else {
                    next.insert(k.clone(), Some(trimmed.to_string()));
                }
            }
        }
        guard.music_hotkeys_bindings = next;
    }

    if let Some(v) = patch.get("music_lyrics_enabled").and_then(|v| v.as_bool()) {
        guard.music_lyrics_enabled = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_show_translation")
        .and_then(|v| v.as_bool())
    {
        guard.music_lyrics_show_translation = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_show_romanized")
        .and_then(|v| v.as_bool())
    {
        guard.music_lyrics_show_romanized = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_auto_follow")
        .and_then(|v| v.as_bool())
    {
        guard.music_lyrics_auto_follow = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_provider_mode")
        .and_then(|v| v.as_str())
    {
        guard.music_lyrics_provider_mode = v.to_string();
    }
    if let Some(v) = patch.get("music_lyrics_offset_ms").and_then(|v| v.as_i64()) {
        guard.music_lyrics_offset_ms = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_manual_lock_ms")
        .and_then(|v| v.as_u64())
    {
        guard.music_lyrics_manual_lock_ms = v;
    }
    if let Some(v) = patch.get("music_lyrics_font_size").and_then(|v| v.as_u64()) {
        guard.music_lyrics_font_size = v as u32;
    }
    if let Some(v) = patch
        .get("music_lyrics_scrape_enabled")
        .and_then(|v| v.as_bool())
    {
        guard.music_lyrics_scrape_enabled = v;
    }
    if let Some(v) = patch
        .get("music_lyrics_scrape_notice_ack")
        .and_then(|v| v.as_bool())
    {
        guard.music_lyrics_scrape_notice_ack = v;
    }
    let normalized = normalize_settings(guard.clone());
    *guard = normalized.clone();
    save_settings_to_disk(&normalized)?;
    let _ = app.emit("music:settings-changed", ());
    Ok(())
}

pub fn get_music_data_dir() -> std::path::PathBuf {
    crate::settings::get_music_data_dir()
}
