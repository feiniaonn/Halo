use crate::db::PlayRecord;
#[cfg(target_os = "windows")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use tauri::Manager;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicControlSource {
    pub source_id: String,
    pub source_name: String,
    pub source_kind: String,
    pub can_prev: bool,
    pub can_play_pause: bool,
    pub can_next: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicControlTarget {
    pub source_id: String,
    pub source_name: String,
    pub source_kind: String,
    pub playback_status: Option<String>,
    pub supports_previous: Option<bool>,
    pub supports_play_pause: Option<bool>,
    pub supports_next: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicControlState {
    pub target: Option<MusicControlTarget>,
    pub sources_count: usize,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicControlResult {
    pub ok: bool,
    pub message: String,
    pub command: String,
    pub target: Option<MusicControlTarget>,
    pub reason: Option<String>,
    pub retried: u8,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicDailySummary {
    pub total_play_events: u64,
    pub top_song: Option<PlayRecord>,
}

#[derive(Debug, Clone, serde::Deserialize, Default)]
struct MusicControlOptions {
    target_source_id: Option<String>,
    timeout_ms: Option<u64>,
    retry_count: Option<u8>,
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn music_get_control_state() -> MusicControlState {
    MusicControlState {
        reason: Some("music control is only supported on Windows".to_string()),
        ..Default::default()
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn music_get_control_sources() -> Vec<MusicControlSource> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn music_control(
    command: String,
    _options: Option<serde_json::Value>,
) -> Result<MusicControlResult, String> {
    Ok(MusicControlResult {
        ok: false,
        message: "music control is only supported on Windows".to_string(),
        command,
        target: None,
        reason: Some("platform_not_supported".to_string()),
        retried: 0,
    })
}

#[cfg(target_os = "windows")]
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct SessionSnapshot {
    session: GlobalSystemMediaTransportControlsSession,
    source_norm: String,
    target: MusicControlTarget,
    can_prev: bool,
    can_play_pause: bool,
    can_next: bool,
}

#[cfg(target_os = "windows")]
fn source_kind_from_id(source_id: &str) -> String {
    let lower = source_id.to_ascii_lowercase();
    if lower.contains("chrome")
        || lower.contains("msedge")
        || lower.contains("firefox")
        || lower.contains("opera")
        || lower.contains("brave")
    {
        "browser".to_string()
    } else {
        "native".to_string()
    }
}

#[cfg(target_os = "windows")]
fn is_browser_like_source_id(source_id: &str) -> bool {
    let lower = source_id.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    [
        "chrome",
        "msedge",
        "msedgewebview",
        "webview",
        "firefox",
        "opera",
        "brave",
        "iexplore",
        "browser",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

#[cfg(target_os = "windows")]
fn is_halo_source_id(source_id: &str) -> bool {
    let lower = source_id.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }

    lower == "com.tauri-app.halo"
        || lower.contains("tauri-app.halo")
        || lower.ends_with("\\halo.exe")
        || lower.ends_with("/halo.exe")
        || lower.ends_with("halo.exe")
}

#[cfg(target_os = "windows")]
fn should_ignore_music_control_source(source_id: &str) -> bool {
    is_browser_like_source_id(source_id) || is_halo_source_id(source_id)
}

#[cfg(target_os = "windows")]
fn source_name_from_id(source_id: &str) -> String {
    let trimmed = source_id.trim();
    if trimmed.is_empty() {
        return "Unknown".to_string();
    }

    let path_leaf = trimmed.rsplit(['\\', '/']).next().unwrap_or(trimmed).trim();
    if !path_leaf.is_empty() {
        let stem = path_leaf
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or(path_leaf)
            .trim();
        if !stem.is_empty() {
            return stem.to_string();
        }
    }

    if let Some((head, _)) = trimmed.split_once('!') {
        let tail = head.rsplit('.').next().unwrap_or(head).trim();
        if !tail.is_empty() {
            return tail.to_string();
        }
    }
    trimmed
        .rsplit('.')
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
fn fallback_target_from_current(
    current: &Arc<Mutex<Option<crate::CurrentPlayingInfo>>>,
) -> Option<MusicControlTarget> {
    let snapshot = current.lock().ok().and_then(|g| g.clone())?;
    let source_seed = snapshot
        .source_app_id
        .as_deref()
        .or(snapshot.source_platform.as_deref())
        .unwrap_or("unknown");
    if should_ignore_music_control_source(source_seed) {
        return None;
    }
    if snapshot.title.trim().is_empty() && snapshot.artist.trim().is_empty() {
        return None;
    }

    let mut source_name = snapshot
        .source_app_id
        .as_deref()
        .map(source_name_from_id)
        .unwrap_or_else(|| "Unknown".to_string());
    if snapshot.source_platform.as_deref() == Some("netease") {
        source_name = "NetEase Cloud Music".to_string();
    }

    let source_id = normalize_source_id(source_seed);
    let source_kind = source_kind_from_id(source_seed);

    Some(MusicControlTarget {
        source_id,
        source_name,
        source_kind,
        playback_status: snapshot.playback_status,
        supports_previous: Some(false),
        supports_play_pause: Some(false),
        supports_next: Some(false),
    })
}

#[cfg(target_os = "windows")]
fn normalize_source_id(source_id: &str) -> String {
    source_id.trim().to_ascii_lowercase()
}

#[cfg(target_os = "windows")]
fn map_status(value: GlobalSystemMediaTransportControlsSessionPlaybackStatus) -> String {
    match value {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed => "Closed",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened => "Opened",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing => "Changing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "Stopped",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "Playing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "Paused",
        _ => "Unknown",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn query_sessions_sync() -> Result<(Vec<SessionSnapshot>, Option<String>), String> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?
        .get()
        .map_err(|e| e.to_string())?;

    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for session in sessions {
        let source_id = match session.SourceAppUserModelId() {
            Ok(v) => v.to_string(),
            Err(_) => continue,
        };
        if should_ignore_music_control_source(&source_id) {
            continue;
        }
        let source_norm = normalize_source_id(&source_id);
        let source_name = source_name_from_id(&source_id);
        let source_kind = source_kind_from_id(&source_id);

        let mut playback_status: Option<String> = None;
        let mut can_prev = false;
        let mut can_play_pause = false;
        let mut can_next = false;

        if let Ok(playback_info) = session.GetPlaybackInfo() {
            if let Ok(status) = playback_info.PlaybackStatus() {
                playback_status = Some(map_status(status));
            }
            if let Ok(ctrl) = playback_info.Controls() {
                can_prev = ctrl.IsPreviousEnabled().unwrap_or(false);
                can_next = ctrl.IsNextEnabled().unwrap_or(false);
                let can_play = ctrl.IsPlayEnabled().unwrap_or(false);
                let can_pause = ctrl.IsPauseEnabled().unwrap_or(false);
                can_play_pause = can_play || can_pause;
            }
        }

        out.push(SessionSnapshot {
            session,
            source_norm: source_norm.clone(),
            target: MusicControlTarget {
                source_id: source_norm,
                source_name,
                source_kind,
                playback_status,
                supports_previous: Some(can_prev),
                supports_play_pause: Some(can_play_pause),
                supports_next: Some(can_next),
            },
            can_prev,
            can_play_pause,
            can_next,
        });
    }

    let current_source = manager
        .GetCurrentSession()
        .ok()
        .and_then(|s| s.SourceAppUserModelId().ok())
        .map(|v| normalize_source_id(&v.to_string()));
    Ok((out, current_source))
}

#[cfg(target_os = "windows")]
fn parse_options(options: Option<serde_json::Value>) -> MusicControlOptions {
    options
        .and_then(|v| serde_json::from_value::<MusicControlOptions>(v).ok())
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn select_target(
    sessions: &[SessionSnapshot],
    current_source: Option<&str>,
    options: &MusicControlOptions,
) -> (Option<SessionSnapshot>, Option<String>) {
    if sessions.is_empty() {
        return (None, Some("no_controllable_session".to_string()));
    }

    let settings = crate::music_settings::get_music_settings().unwrap_or_default();
    let whitelist = settings
        .music_control_whitelist
        .into_iter()
        .map(|v| normalize_source_id(&v))
        .collect::<Vec<_>>();

    let mut candidates = sessions
        .iter()
        .filter(|s| whitelist.is_empty() || whitelist.contains(&s.source_norm))
        .cloned()
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return (None, Some("whitelist_blocked".to_string()));
    }

    if let Some(id) = options
        .target_source_id
        .as_deref()
        .map(normalize_source_id)
        .filter(|v| !v.is_empty())
    {
        if let Some(target) = candidates.iter().find(|s| s.source_norm == id) {
            return (Some(target.clone()), None);
        }
    }

    let mode = settings.music_control_target_mode;
    if let Some(current) = current_source {
        if let Some(target) = candidates.iter().find(|s| s.source_norm == current) {
            match mode.as_str() {
                "browser" if target.target.source_kind == "browser" => {
                    return (Some(target.clone()), None)
                }
                "native" if target.target.source_kind == "native" => {
                    return (Some(target.clone()), None)
                }
                "auto" => return (Some(target.clone()), None),
                _ => {}
            }
        }
    }

    if mode == "browser" {
        if let Some(target) = candidates
            .iter()
            .find(|s| s.target.source_kind == "browser")
        {
            return (Some(target.clone()), None);
        }
    } else if mode == "native" {
        if let Some(target) = candidates
            .iter()
            .find(|s| s.target.source_kind != "browser")
        {
            return (Some(target.clone()), None);
        }
    }

    if let Some(playing) = candidates.iter().find(|s| {
        s.target
            .playback_status
            .as_deref()
            .map(|v| v.eq_ignore_ascii_case("playing"))
            .unwrap_or(false)
    }) {
        return (Some(playing.clone()), None);
    }

    (Some(candidates.remove(0)), None)
}

#[cfg(target_os = "windows")]
fn run_control_once(
    session: &GlobalSystemMediaTransportControlsSession,
    command: &str,
) -> Result<bool, String> {
    match command {
        "previous" => session
            .TrySkipPreviousAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string()),
        "next" => session
            .TrySkipNextAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string()),
        "play_pause" => session
            .TryTogglePlayPauseAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string()),
        _ => Err("unsupported_command".to_string()),
    }
}

#[cfg(target_os = "windows")]
fn build_state_sync(fallback_target: Option<MusicControlTarget>) -> MusicControlState {
    let result = query_sessions_sync();
    let Ok((sessions, current_source)) = result else {
        let fallback_count = usize::from(fallback_target.is_some());
        return MusicControlState {
            target: fallback_target,
            sources_count: fallback_count,
            reason: Some("query_failed".to_string()),
        };
    };

    let options = MusicControlOptions::default();
    let (target, reason) = select_target(&sessions, current_source.as_deref(), &options);
    if let Some(target) = target {
        return MusicControlState {
            target: Some(target.target),
            sources_count: sessions.len(),
            reason,
        };
    }

    let fallback_count = usize::from(fallback_target.is_some() && sessions.is_empty());
    MusicControlState {
        target: fallback_target,
        sources_count: sessions.len() + fallback_count,
        reason,
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn music_get_control_state(
    app: tauri::AppHandle,
) -> Result<MusicControlState, String> {
    let fallback_target = {
        let current = app.state::<Arc<Mutex<Option<crate::CurrentPlayingInfo>>>>();
        fallback_target_from_current(current.inner())
    };
    Ok(
        tauri::async_runtime::spawn_blocking(move || build_state_sync(fallback_target))
            .await
            .unwrap_or_else(|_| MusicControlState {
                target: None,
                sources_count: 0,
                reason: Some("music_control_state_join_failed".to_string()),
            }),
    )
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn music_get_control_sources(
    app: tauri::AppHandle,
) -> Result<Vec<MusicControlSource>, String> {
    let fallback_target = {
        let current = app.state::<Arc<Mutex<Option<crate::CurrentPlayingInfo>>>>();
        fallback_target_from_current(current.inner())
    };
    Ok(
        tauri::async_runtime::spawn_blocking(move || {
            let result = query_sessions_sync();
            let Ok((sessions, _)) = result else {
                return fallback_target
                    .map(|target| MusicControlSource {
                        source_id: target.source_id,
                        source_name: target.source_name,
                        source_kind: target.source_kind,
                        can_prev: false,
                        can_play_pause: false,
                        can_next: false,
                    })
                    .into_iter()
                    .collect::<Vec<_>>();
            };

            let mut out = sessions
                .into_iter()
                .map(|v| MusicControlSource {
                    source_id: v.target.source_id,
                    source_name: v.target.source_name,
                    source_kind: v.target.source_kind,
                    can_prev: v.can_prev,
                    can_play_pause: v.can_play_pause,
                    can_next: v.can_next,
                })
                .collect::<Vec<_>>();

            if out.is_empty() {
                if let Some(target) = fallback_target {
                    out.push(MusicControlSource {
                        source_id: target.source_id,
                        source_name: target.source_name,
                        source_kind: target.source_kind,
                        can_prev: false,
                        can_play_pause: false,
                        can_next: false,
                    });
                }
            }

            out
        })
        .await
        .unwrap_or_default(),
    )
}

#[tauri::command]
pub fn music_get_daily_summary() -> MusicDailySummary {
    let top = crate::music::aggregated_top10().unwrap_or_default();
    let total_play_events = top.iter().map(|v| v.play_count.max(0) as u64).sum();
    MusicDailySummary {
        total_play_events,
        top_song: top.into_iter().next(),
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn music_control(
    command: String,
    options: Option<serde_json::Value>,
    current: tauri::State<'_, Arc<Mutex<Option<crate::CurrentPlayingInfo>>>>,
) -> Result<MusicControlResult, String> {
    let command_norm = command.trim().to_ascii_lowercase();
    if command_norm == "refresh" {
        let state = build_state_sync(fallback_target_from_current(current.inner()));
        return Ok(MusicControlResult {
            ok: true,
            message: "refresh_ok".to_string(),
            command,
            target: state.target,
            reason: state.reason,
            retried: 0,
        });
    }
    if !matches!(command_norm.as_str(), "previous" | "play_pause" | "next") {
        return Ok(MusicControlResult {
            ok: false,
            message: "unsupported command".to_string(),
            command,
            target: None,
            reason: Some("unsupported_command".to_string()),
            retried: 0,
        });
    }

    let parsed_options = parse_options(options);
    let (sessions, current_source) = query_sessions_sync()?;
    let fallback_target = fallback_target_from_current(current.inner());
    let (target, reason) = select_target(&sessions, current_source.as_deref(), &parsed_options);
    let Some(target) = target else {
        return Ok(MusicControlResult {
            ok: false,
            message: "no target session".to_string(),
            command,
            target: fallback_target,
            reason,
            retried: 0,
        });
    };

    let supported = match command_norm.as_str() {
        "previous" => target.can_prev,
        "next" => target.can_next,
        "play_pause" => target.can_play_pause,
        _ => false,
    };
    if !supported {
        return Ok(MusicControlResult {
            ok: false,
            message: "command not supported by selected session".to_string(),
            command,
            target: Some(target.target),
            reason: Some("command_not_supported".to_string()),
            retried: 0,
        });
    }

    let settings = crate::music_settings::get_music_settings().unwrap_or_default();
    let retry_count = parsed_options
        .retry_count
        .unwrap_or(settings.music_control_retry_count)
        .min(5);
    let wait_ms = parsed_options
        .timeout_ms
        .unwrap_or(settings.music_control_timeout_ms);

    let mut retried = 0u8;
    let mut last_err: Option<String> = None;
    for attempt in 0..=retry_count {
        match run_control_once(&target.session, &command_norm) {
            Ok(true) => {
                return Ok(MusicControlResult {
                    ok: true,
                    message: "command sent".to_string(),
                    command,
                    target: Some(target.target),
                    reason: None,
                    retried,
                });
            }
            Ok(false) => {
                last_err = Some("target rejected command".to_string());
            }
            Err(e) => {
                last_err = Some(e);
            }
        }
        if attempt < retry_count {
            retried = retried.saturating_add(1);
            std::thread::sleep(std::time::Duration::from_millis(wait_ms.min(1500).max(80)));
        }
    }

    Ok(MusicControlResult {
        ok: false,
        message: "command failed".to_string(),
        command,
        target: Some(target.target),
        reason: last_err.or_else(|| Some("unknown_error".to_string())),
        retried,
    })
}
