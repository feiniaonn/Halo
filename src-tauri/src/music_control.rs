use crate::db::PlayRecord;
#[cfg(target_os = "windows")]
use crate::music_media_key::{send_media_key_command, supports_media_key_fallback};
#[cfg(target_os = "windows")]
use std::cell::Cell;
#[cfg(target_os = "windows")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

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

#[cfg(target_os = "windows")]
const CONTROL_QUERY_TIMEOUT_MS: u64 = 120;

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
thread_local! {
    static WINDOWS_MEDIA_RUNTIME_READY: Cell<bool> = const { Cell::new(false) };
}
#[cfg(target_os = "windows")]
const RPC_E_CHANGED_MODE_HRESULT: windows::core::HRESULT =
    windows::core::HRESULT(0x80010106u32 as i32);

#[cfg(target_os = "windows")]
fn ensure_windows_media_runtime() {
    WINDOWS_MEDIA_RUNTIME_READY.with(|ready| {
        if ready.get() {
            return;
        }

        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() && hr != RPC_E_CHANGED_MODE_HRESULT {
            eprintln!("[music] windows media runtime init failed: {:?}", hr);
        }

        ready.set(true);
    });
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
fn should_ignore_music_control_source(source_id: &str) -> bool {
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
fn target_supports_media_keys(target: &MusicControlTarget) -> bool {
    supports_media_key_fallback(
        Some(target.source_id.as_str()),
        Some(target.source_kind.as_str()),
    )
}

#[cfg(target_os = "windows")]
fn with_media_key_capabilities(mut target: MusicControlTarget) -> MusicControlTarget {
    if target_supports_media_keys(&target) {
        target.supports_previous = Some(true);
        target.supports_play_pause = Some(true);
        target.supports_next = Some(true);
    }
    target
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
    let supports_media_keys =
        supports_media_key_fallback(Some(source_seed), snapshot.source_platform.as_deref());

    Some(with_media_key_capabilities(MusicControlTarget {
        source_id,
        source_name,
        source_kind,
        playback_status: snapshot.playback_status,
        supports_previous: Some(supports_media_keys),
        supports_play_pause: Some(supports_media_keys),
        supports_next: Some(supports_media_keys),
    }))
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
    ensure_windows_media_runtime();
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
            target: with_media_key_capabilities(MusicControlTarget {
                source_id: source_norm,
                source_name,
                source_kind,
                playback_status,
                supports_previous: Some(can_prev),
                supports_play_pause: Some(can_play_pause),
                supports_next: Some(can_next),
            }),
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
fn fallback_sources_from_target(
    fallback_target: Option<MusicControlTarget>,
) -> Vec<MusicControlSource> {
    fallback_target
        .map(|target| MusicControlSource {
            source_id: target.source_id,
            source_name: target.source_name,
            source_kind: target.source_kind,
            can_prev: target.supports_previous.unwrap_or(false),
            can_play_pause: target.supports_play_pause.unwrap_or(false),
            can_next: target.supports_next.unwrap_or(false),
        })
        .into_iter()
        .collect()
}

#[cfg(target_os = "windows")]
fn fallback_reason_for_target(fallback_target: Option<&MusicControlTarget>) -> Option<String> {
    if fallback_target.map(target_supports_media_keys).unwrap_or(false) {
        None
    } else {
        Some("query_timeout".to_string())
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn music_get_control_state(app: tauri::AppHandle) -> Result<MusicControlState, String> {
    let fallback_target = {
        let current = app.state::<Arc<Mutex<Option<crate::CurrentPlayingInfo>>>>();
        fallback_target_from_current(current.inner())
    };
    let fallback_count = usize::from(fallback_target.is_some());
    let task = tauri::async_runtime::spawn_blocking({
        let fallback_target = fallback_target.clone();
        move || build_state_sync(fallback_target)
    });
    match tokio::time::timeout(
        std::time::Duration::from_millis(CONTROL_QUERY_TIMEOUT_MS),
        task,
    )
    .await
    {
        Ok(Ok(state)) => Ok(state),
        Ok(Err(_)) => Ok(MusicControlState {
            target: fallback_target.clone(),
            sources_count: fallback_count,
            reason: fallback_reason_for_target(fallback_target.as_ref())
                .or_else(|| Some("music_control_state_join_failed".to_string())),
        }),
        Err(_) => Ok(MusicControlState {
            target: fallback_target.clone(),
            sources_count: fallback_count,
            reason: fallback_reason_for_target(fallback_target.as_ref()),
        }),
    }
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
    let task = tauri::async_runtime::spawn_blocking({
        let fallback_target = fallback_target.clone();
        move || {
            let result = query_sessions_sync();
            let Ok((sessions, _)) = result else {
                return fallback_sources_from_target(fallback_target);
            };

            let mut out = sessions
                .into_iter()
                .map(|v| MusicControlSource {
                    source_id: v.target.source_id,
                    source_name: v.target.source_name,
                    source_kind: v.target.source_kind,
                    can_prev: v.target.supports_previous.unwrap_or(v.can_prev),
                    can_play_pause: v.target.supports_play_pause.unwrap_or(v.can_play_pause),
                    can_next: v.target.supports_next.unwrap_or(v.can_next),
                })
                .collect::<Vec<_>>();

            if out.is_empty() {
                out = fallback_sources_from_target(fallback_target);
            }

            out
        }
    });
    match tokio::time::timeout(
        std::time::Duration::from_millis(CONTROL_QUERY_TIMEOUT_MS),
        task,
    )
    .await
    {
        Ok(Ok(sources)) => Ok(sources),
        Ok(Err(_)) | Err(_) => Ok(fallback_sources_from_target(fallback_target)),
    }
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
fn music_control_sync(
    command: String,
    parsed_options: MusicControlOptions,
    fallback_target: Option<MusicControlTarget>,
) -> Result<MusicControlResult, String> {
    let command_norm = command.trim().to_ascii_lowercase();
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

    let (sessions, current_source) = query_sessions_sync()?;
    let (target, reason) = select_target(&sessions, current_source.as_deref(), &parsed_options);
    let fallback_media_keys = fallback_target
        .as_ref()
        .map(target_supports_media_keys)
        .unwrap_or(false);
        
    if let Some(t) = target.as_ref() {
        let sid = t.target.source_id.to_lowercase();
        if sid.contains("qqmusic.exe") || sid.contains("cloudmusic.exe") {
            if send_media_key_command(&command_norm).unwrap_or(false) {
                return Ok(MusicControlResult {
                    ok: true,
                    message: "command sent via media key forcibly for buggy platform".to_string(),
                    command,
                    target: Some(t.target.clone()),
                    reason: Some("forced_media_key".to_string()),
                    retried: 0,
                });
            }
        }
    }
        
    if let Some(t) = target.as_ref() {
        let sid = t.target.source_id.to_lowercase();
        if sid.contains("qqmusic.exe") || sid.contains("cloudmusic.exe") {
            if send_media_key_command(&command_norm).unwrap_or(false) {
                return Ok(MusicControlResult {
                    ok: true,
                    message: "command sent via media key forcibly for buggy platform".to_string(),
                    command,
                    target: Some(t.target.clone()),
                    reason: Some("forced_media_key".to_string()),
                    retried: 0,
                });
            }
        }
    }
    let Some(target) = target else {
        if fallback_media_keys && send_media_key_command(&command_norm)? {
            return Ok(MusicControlResult {
                ok: true,
                message: "command sent via media key".to_string(),
                command,
                target: fallback_target,
                reason: Some("media_key_fallback".to_string()),
                retried: 0,
            });
        }
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
        if fallback_media_keys && send_media_key_command(&command_norm)? {
            return Ok(MusicControlResult {
                ok: true,
                message: "command sent via media key".to_string(),
                command,
                target: fallback_target.or_else(|| Some(target.target.clone())),
                reason: Some("media_key_fallback".to_string()),
                retried: 0,
            });
        }
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

    let selected_target = target.target.clone();
    if fallback_media_keys && send_media_key_command(&command_norm)? {
        return Ok(MusicControlResult {
            ok: true,
            message: "command sent via media key".to_string(),
            command,
            target: fallback_target.or_else(|| Some(selected_target)),
            reason: Some("media_key_fallback".to_string()),
            retried,
        });
    }

    Ok(MusicControlResult {
        ok: false,
        message: "command failed".to_string(),
        command,
        target: Some(selected_target),
        reason: last_err.or_else(|| Some("unknown_error".to_string())),
        retried,
    })
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn music_control(
    command: String,
    options: Option<serde_json::Value>,
    current: tauri::State<'_, Arc<Mutex<Option<crate::CurrentPlayingInfo>>>>,
) -> Result<MusicControlResult, String> {
    let command_norm = command.trim().to_ascii_lowercase();
    let parsed_options = parse_options(options);
    let fallback_target = fallback_target_from_current(current.inner());
    let fallback_media_keys = fallback_target
        .as_ref()
        .map(target_supports_media_keys)
        .unwrap_or(false);

    if command_norm == "refresh" {
        let fallback_count = usize::from(fallback_target.is_some());
        let task = tauri::async_runtime::spawn_blocking({
            let fallback_target = fallback_target.clone();
            move || build_state_sync(fallback_target)
        });
        let state = match tokio::time::timeout(
            std::time::Duration::from_millis(CONTROL_QUERY_TIMEOUT_MS),
            task,
        )
        .await
        {
            Ok(Ok(state)) => state,
            Ok(Err(_)) => MusicControlState {
                target: fallback_target.clone(),
                sources_count: fallback_count,
                reason: Some("music_control_state_join_failed".to_string()),
            },
            Err(_) => MusicControlState {
                target: fallback_target.clone(),
                sources_count: fallback_count,
                reason: Some("query_timeout".to_string()),
            },
        };
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

    if fallback_media_keys && parsed_options.target_source_id.as_deref().is_none() {
        let sent = tauri::async_runtime::spawn_blocking({
            let command_norm = command_norm.clone();
            move || send_media_key_command(&command_norm)
        })
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false);

        if sent {
            return Ok(MusicControlResult {
                ok: true,
                message: "command sent via media key".to_string(),
                command,
                target: fallback_target,
                reason: None,
                retried: 0,
            });
        }
    }

    let task = tauri::async_runtime::spawn_blocking({
        let command = command.clone();
        let parsed_options = parsed_options.clone();
        let fallback_target = fallback_target.clone();
        move || music_control_sync(command, parsed_options, fallback_target)
    });

    match tokio::time::timeout(
        std::time::Duration::from_millis(CONTROL_QUERY_TIMEOUT_MS),
        task,
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(_)) | Err(_) => {
            if fallback_media_keys && send_media_key_command(&command_norm)? {
                Ok(MusicControlResult {
                    ok: true,
                    message: "command sent via media key".to_string(),
                    command,
                    target: fallback_target,
                    reason: Some("media_key_fallback".to_string()),
                    retried: 0,
                })
            } else {
                Ok(MusicControlResult {
                    ok: false,
                    message: "command timed out".to_string(),
                    command,
                    target: fallback_target,
                    reason: Some("query_timeout".to_string()),
                    retried: 0,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{fallback_reason_for_target, MusicControlTarget};

    #[test]
    fn hides_timeout_reason_for_media_key_fallback_targets() {
        let target = MusicControlTarget {
            source_id: "qqmusic.exe".to_string(),
            source_name: "QQMusic".to_string(),
            source_kind: "native".to_string(),
            playback_status: Some("Playing".to_string()),
            supports_previous: Some(true),
            supports_play_pause: Some(true),
            supports_next: Some(true),
        };
        assert_eq!(fallback_reason_for_target(Some(&target)), None);
    }

    #[test]
    fn keeps_timeout_reason_when_no_fallback_target_exists() {
        assert_eq!(
            fallback_reason_for_target(None),
            Some("query_timeout".to_string())
        );
    }
}
