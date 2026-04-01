use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use crate::db::PlayRecord;
use crate::music_play_stats::PlayEventRecorder;
use crate::CurrentPlayingInfo;

const EVENT_MUSIC_CURRENT_CHANGED: &str = "music:current-changed";
const EVENT_MUSIC_TRACK_UPDATE: &str = "track-update";
const EVENT_MUSIC_TIMELINE_UPDATE: &str = "timeline-update";
const EVENT_MUSIC_PLAY_RECORDED: &str = "music:play-recorded";

pub fn aggregated_play_history(limit: i64) -> Result<Vec<PlayRecord>, String> {
    crate::db::query_play_history(limit)
}

pub fn aggregated_top10() -> Result<Vec<PlayRecord>, String> {
    crate::db::query_today_top10(chrono::Local::now().timestamp_millis())
}

#[cfg(not(target_os = "windows"))]
pub async fn run_gsmtc_listener(
    _app: tauri::AppHandle,
    stop: Arc<AtomicBool>,
    _current: Arc<Mutex<Option<CurrentPlayingInfo>>>,
) {
    while !stop.load(Ordering::Relaxed) {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
}

#[cfg(target_os = "windows")]
use std::cell::Cell;
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::sync::OnceLock;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(target_os = "windows")]
use base64::Engine;
#[cfg(target_os = "windows")]
use encoding_rs::GBK;
#[cfg(target_os = "windows")]
use gsmtc::{ManagerEvent, PlaybackStatus, SessionModel, SessionUpdateEvent};
#[cfg(target_os = "windows")]
use sha2::{Digest, Sha256};
#[cfg(target_os = "windows")]
use tauri::Emitter;
#[cfg(target_os = "windows")]
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager as WinSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as WinPlaybackStatus,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED};

#[cfg(target_os = "windows")]
#[cfg(target_os = "windows")]
const CURRENT_INFO_HOLD_MS: i64 = 12_000;
#[cfg(target_os = "windows")]
const LISTENER_IDLE_TICK_MS: u64 = 1_200;
#[cfg(target_os = "windows")]
const LISTENER_ACTIVE_TICK_MS: u64 = 250;
#[cfg(target_os = "windows")]
const WINDOWS_API_RETRY_LIMIT: u8 = 3;
#[cfg(target_os = "windows")]
const WINDOWS_API_RETRY_INTERVAL_MS: i64 = 1_800;
#[cfg(target_os = "windows")]
const WINDOWS_API_COOLDOWN_MS: i64 = 45_000;
#[cfg(target_os = "windows")]
const PROCESS_PROBE_RETRY_LIMIT: u8 = 3;
#[cfg(target_os = "windows")]
const PROCESS_PROBE_RETRY_INTERVAL_MS: i64 = 1_500;
#[cfg(target_os = "windows")]
const PROCESS_PROBE_COOLDOWN_MS: i64 = 90_000;
#[cfg(target_os = "windows")]
const MUSIC_ON_DEMAND_QUERY_TIMEOUT_MS: u64 = 420;
#[cfg(target_os = "windows")]
const GSMTC_CREATE_TIMEOUT_MS: u64 = 2_500;
#[cfg(target_os = "windows")]
const CURRENT_QUERY_WORKER_COOLDOWN_MS: i64 = 1_500;
#[cfg(target_os = "windows")]
const CURRENT_QUERY_RESULT_FRESH_MS: i64 = 2_500;

#[cfg(target_os = "windows")]
thread_local! {
    static WINDOWS_MEDIA_RUNTIME_READY: Cell<bool> = const { Cell::new(false) };
}
#[cfg(target_os = "windows")]
const RPC_E_CHANGED_MODE_HRESULT: windows::core::HRESULT =
    windows::core::HRESULT(0x80010106u32 as i32);

#[cfg(target_os = "windows")]
fn music_debug_enabled() -> bool {
    static LAST_REFRESH_AT_MS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
    static CACHED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    let now = now_ms();
    let last = LAST_REFRESH_AT_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) >= 1_000 {
        let env_enabled = std::env::var("HALO_MUSIC_DEBUG")
            .ok()
            .map(|v| {
                matches!(
                    v.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on" | "debug"
                )
            })
            .unwrap_or(false);
        let next = env_enabled;
        let prev = CACHED.swap(next, Ordering::Relaxed);
        if prev != next {
            eprintln!("[music-debug] diagnostics enabled={next}");
        }
        LAST_REFRESH_AT_MS.store(now, Ordering::Relaxed);
    }

    CACHED.load(Ordering::Relaxed)
}

#[cfg(target_os = "windows")]
fn ensure_windows_media_runtime() {
    WINDOWS_MEDIA_RUNTIME_READY.with(|ready| {
        if ready.get() {
            return;
        }

        if music_debug_enabled() {
            eprintln!("[music-debug] initializing windows media runtime on current thread");
        }

        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_err() && hr != RPC_E_CHANGED_MODE_HRESULT && music_debug_enabled() {
            eprintln!("[music-debug] windows media runtime init failed: {:?}", hr);
        }

        ready.set(true);
    });
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default)]
struct SessionSnapshot {
    source: String,
    model: Option<SessionModel>,
    cover_path: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct ListenerState {
    current_session_id: Option<usize>,
    sessions: HashMap<usize, SessionSnapshot>,
    play_event_recorder: PlayEventRecorder,
    last_windows_api_probe_at_ms: i64,
    windows_api_fail_streak: u8,
    windows_api_block_until_ms: i64,
    last_process_probe_at_ms: i64,
    process_probe_fail_streak: u8,
    process_probe_block_until_ms: i64,
    last_nonempty_current: Option<CurrentPlayingInfo>,
    last_nonempty_current_at_ms: i64,
    netease_meta_cache: HashMap<String, Option<NeteaseTrackMeta>>,
    virtual_position_clock: Option<VirtualPositionClock>,
    virtual_track_first_seen_ms: HashMap<String, i64>,
    last_diag_line: String,
    last_diag_at_ms: i64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default, serde::Serialize)]
struct MusicTrackUpdatePayload {
    artist: String,
    title: String,
    cover_path: Option<String>,
    cover_data_url: Option<String>,
    source_app_id: Option<String>,
    source_platform: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default, serde::Serialize)]
struct MusicTimelineUpdatePayload {
    position_secs: Option<f64>,
    duration_secs: Option<f64>,
    last_updated_at_ms: Option<f64>,
    playback_status: Option<String>,
    source_app_id: Option<String>,
    source_platform: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default)]
struct NeteaseTrackMeta {
    cover_data_url: Option<String>,
    duration_secs: Option<u64>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default)]
struct VirtualPositionClock {
    track_key: String,
    anchor_at_ms: i64,
    anchor_pos_secs: u64,
}

#[cfg(target_os = "windows")]
fn now_ms() -> i64 {
    chrono::Local::now().timestamp_millis()
}

#[cfg(target_os = "windows")]
fn maybe_emit_diag(state: &mut ListenerState, line: String) {
    if !music_debug_enabled() {
        return;
    }
    let now = now_ms();
    if state.last_diag_line != line || now.saturating_sub(state.last_diag_at_ms) >= 12_000 {
        eprintln!("[music] {}", line);
        state.last_diag_line = line;
        state.last_diag_at_ms = now;
    }
}

#[cfg(target_os = "windows")]
fn reset_fallback_backoff(state: &mut ListenerState) {
    state.last_windows_api_probe_at_ms = 0;
    state.windows_api_fail_streak = 0;
    state.windows_api_block_until_ms = 0;
    state.last_process_probe_at_ms = 0;
    state.process_probe_fail_streak = 0;
    state.process_probe_block_until_ms = 0;
}

#[cfg(target_os = "windows")]
fn map_playback_status(status: &PlaybackStatus) -> String {
    match status {
        PlaybackStatus::Closed => "Closed",
        PlaybackStatus::Opened => "Opened",
        PlaybackStatus::Changing => "Changing",
        PlaybackStatus::Stopped => "Stopped",
        PlaybackStatus::Playing => "Playing",
        PlaybackStatus::Paused => "Paused",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn map_playback_status_win(status: WinPlaybackStatus) -> String {
    match status {
        WinPlaybackStatus::Closed => "Closed",
        WinPlaybackStatus::Opened => "Opened",
        WinPlaybackStatus::Changing => "Changing",
        WinPlaybackStatus::Stopped => "Stopped",
        WinPlaybackStatus::Playing => "Playing",
        WinPlaybackStatus::Paused => "Paused",
        _ => "Unknown",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn ticks_100ns_to_secs(value: i64) -> Option<u64> {
    if value < 0 {
        return None;
    }
    u64::try_from(value).ok().map(|v| v / 10_000_000)
}

#[cfg(target_os = "windows")]
fn filetime_to_unix_ms(filetime: i64) -> i64 {
    (filetime / 10_000)
        .checked_sub(11_644_473_600_000)
        .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn timeline_to_duration_position_secs(
    start_ticks: i64,
    end_ticks: i64,
    raw_position_ticks: i64,
    is_playing: bool,
    last_updated_at_ms: Option<i64>,
) -> (Option<u64>, Option<u64>) {
    let duration_ticks = end_ticks.saturating_sub(start_ticks).max(0);
    let mut position_ticks = raw_position_ticks.saturating_sub(start_ticks).max(0);

    // When available, compute real-time position from timeline anchor instead of a local fake clock.
    if is_playing {
        if let Some(updated_ms) = last_updated_at_ms {
            if updated_ms > 0 {
                let elapsed_ms = now_ms().saturating_sub(updated_ms);
                if (0..=(12 * 60 * 60 * 1000)).contains(&elapsed_ms) {
                    position_ticks =
                        position_ticks.saturating_add(elapsed_ms.saturating_mul(10_000));
                }
            }
        } else {
            // Fallback: use a small increment for real-time feel when last_updated_at_ms is unavailable
            position_ticks = position_ticks.saturating_add(500 * 10_000);
        }
    }

    let clamped_position_ticks = position_ticks.clamp(0, duration_ticks);
    (
        ticks_100ns_to_secs(duration_ticks),
        ticks_100ns_to_secs(clamped_position_ticks),
    )
}

#[cfg(target_os = "windows")]
fn timeline_to_duration_position_secs_for_platform(
    platform: &str,
    start_ticks: i64,
    end_ticks: i64,
    raw_position_ticks: i64,
    is_playing: bool,
    last_updated_at_ms: Option<i64>,
) -> (Option<u64>, Option<u64>) {
    if platform != "qqmusic" {
        return timeline_to_duration_position_secs(
            start_ticks,
            end_ticks,
            raw_position_ticks,
            is_playing,
            last_updated_at_ms,
        );
    }

    let duration_ticks = end_ticks.saturating_sub(start_ticks).max(0);
    let relative_position_ticks = raw_position_ticks.saturating_sub(start_ticks).max(0);
    let mut position_ticks = if start_ticks > 0
        && raw_position_ticks > 0
        && raw_position_ticks <= duration_ticks
    {
        raw_position_ticks
    } else {
        relative_position_ticks
    };

    if is_playing {
        if let Some(updated_ms) = last_updated_at_ms {
            if updated_ms > 0 {
                let elapsed_ms = now_ms().saturating_sub(updated_ms);
                if (0..=(12 * 60 * 60 * 1000)).contains(&elapsed_ms) {
                    position_ticks =
                        position_ticks.saturating_add(elapsed_ms.saturating_mul(10_000));
                }
            }
        }
    }

    let clamped_position_ticks = position_ticks.clamp(0, duration_ticks);
    (
        ticks_100ns_to_secs(duration_ticks),
        ticks_100ns_to_secs(clamped_position_ticks),
    )
}

#[cfg(target_os = "windows")]
fn sanitize_file_ext(content_type: &str) -> &'static str {
    let lower = content_type.to_ascii_lowercase();
    if lower.contains("jpeg") || lower.contains("jpg") {
        "jpg"
    } else if lower.contains("png") {
        "png"
    } else if lower.contains("webp") {
        "webp"
    } else {
        "bin"
    }
}

#[cfg(target_os = "windows")]
fn extract_source_label(source_id: &str) -> String {
    let lower = source_id.to_ascii_lowercase();
    if lower.contains('!') {
        let head = source_id.split('!').next().unwrap_or(source_id).trim();
        let leaf = head.rsplit('.').next().unwrap_or(head).trim();
        if !leaf.is_empty() {
            return leaf.to_string();
        }
    }

    let path_leaf = source_id
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or(source_id)
        .trim();
    if !path_leaf.is_empty() {
        let file_stem = path_leaf
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or(path_leaf);
        if !file_stem.is_empty() {
            return file_stem.to_string();
        }
    }

    source_id
        .rsplit('.')
        .next()
        .unwrap_or(source_id)
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
fn detect_source_platform(source_id: &str) -> String {
    let label = extract_source_label(source_id);
    let source_lower = source_id.to_ascii_lowercase();
    let lower = label.to_ascii_lowercase();
    let merged = format!("{source_lower}|{lower}");

    if merged.contains("cloudmusic")
        || merged.contains("netease")
        || merged.contains("neteasecloudmusic")
        || merged.contains("music163")
        || merged.contains("com.netease.cloudmusic")
        || merged.contains("163music")
        || merged.contains("neteasemusic")
        || merged.contains("wyy")
        || merged.contains("wangyiyun")
    {
        return "netease".to_string();
    }
    if merged.contains("qqmusic") || merged.contains("tencent") {
        return "qqmusic".to_string();
    }
    if merged.contains("kugou") {
        return "kugou".to_string();
    }
    if merged.contains("kuwo") {
        return "kuwo".to_string();
    }
    if merged.contains("spotify") {
        return "spotify".to_string();
    }
    if merged.contains("itunes") || merged.contains("apple") {
        return "apple_music".to_string();
    }
    if merged.contains("youtube") {
        return "youtube_music".to_string();
    }
    if merged.contains("bilibili") {
        return "bilibili".to_string();
    }

    let token = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>();
    if token.is_empty() {
        "windows-gsmtc".to_string()
    } else {
        token
    }
}

#[cfg(target_os = "windows")]
fn is_halo_music_source(source_id: &str) -> bool {
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
fn is_browser_like_source_token(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
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
fn is_generic_source_platform(platform: Option<&str>) -> bool {
    match platform {
        None => true,
        Some(value) => {
            let trimmed = value.trim();
            trimmed.is_empty()
                || trimmed.eq_ignore_ascii_case("windows-gsmtc")
                || trimmed.eq_ignore_ascii_case("browser")
                || trimmed.eq_ignore_ascii_case("webview")
                || is_browser_like_source_token(trimmed)
        }
    }
}

#[cfg(target_os = "windows")]
fn should_ignore_music_source(source_id: &str, platform: Option<&str>) -> bool {
    is_halo_music_source(source_id) || matches!(platform, Some("halo"))
}

#[cfg(target_os = "windows")]
fn normalize_track_token(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace() && *ch != '-' && *ch != '_' && *ch != '|')
        .collect::<String>()
}

#[cfg(target_os = "windows")]
fn track_lookup_key(artist: &str, title: &str) -> Option<String> {
    let artist_key = normalize_track_token(artist);
    let title_key = normalize_track_token(title);
    if artist_key.is_empty() || title_key.is_empty() {
        return None;
    }
    Some(format!("{artist_key}::{title_key}"))
}

#[cfg(target_os = "windows")]
fn common_hanzi_score(value: &str) -> usize {
    const COMMON: &str = "的一是在不了有人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处理世车点";
    value.chars().filter(|ch| COMMON.contains(*ch)).count()
}

#[cfg(target_os = "windows")]
fn count_cjk_chars(value: &str) -> usize {
    value
        .chars()
        .filter(|ch| ('\u{4e00}'..='\u{9fff}').contains(ch))
        .count()
}

#[cfg(target_os = "windows")]
fn likely_gbk_mojibake(value: &str) -> bool {
    const MARKERS: &[&str] = &[
        "浣", "钖", "鏆", "瑕", "鎬", "锛", "銆", "鈥", "闊", "璇", "缁", "鍚", "娆", "鎵", "绗",
        "鏂", "缃", "鎶", "鍙", "鐨", "鎴", "涓", "浜", "涔",
    ];
    if MARKERS.iter().any(|marker| value.contains(marker)) {
        return true;
    }

    let cjk = count_cjk_chars(value);
    let common = common_hanzi_score(value);
    cjk >= 2 && common == 0
}

#[cfg(target_os = "windows")]
fn recover_utf8_from_gbk_mojibake(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !likely_gbk_mojibake(trimmed) {
        return None;
    }

    let (bytes, _, had_errors) = GBK.encode(trimmed);
    if had_errors {
        return None;
    }

    let decoded = std::str::from_utf8(bytes.as_ref()).ok()?.trim().to_string();
    if decoded.is_empty() || decoded == trimmed {
        return None;
    }

    let before_score = common_hanzi_score(trimmed);
    let after_score = common_hanzi_score(decoded.as_str());
    if after_score >= before_score.saturating_add(1) || (before_score == 0 && after_score > 0) {
        Some(decoded)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn normalize_netease_text(value: &str) -> String {
    recover_utf8_from_gbk_mojibake(value).unwrap_or_else(|| value.trim().to_string())
}

#[cfg(target_os = "windows")]
fn parse_netease_track_from_title(title_raw: &str) -> Option<(String, String)> {
    let mut cleaned = normalize_netease_text(title_raw);
    for suffix in [
        " - 网易云音乐",
        " | 网易云音乐",
        " - Netease Cloud Music",
        " | Netease Cloud Music",
    ] {
        if cleaned.ends_with(suffix) {
            cleaned = cleaned[..cleaned.len().saturating_sub(suffix.len())]
                .trim()
                .to_string();
        }
    }

    let title_lower = cleaned.to_ascii_lowercase();
    if cleaned.is_empty()
        || title_lower == "netease cloud music"
        || cleaned == "网易云音乐"
        || cleaned == "NeteaseMusic"
    {
        return None;
    }

    let separators = [" - ", " \u{2013} ", " \u{2014} ", " | "];
    for sep in separators {
        if let Some((left, right)) = cleaned.rsplit_once(sep) {
            let left_trim = normalize_netease_text(left);
            let right_trim = normalize_netease_text(right);
            if !left_trim.is_empty() && !right_trim.is_empty() {
                return Some((left_trim, right_trim));
            }
        }
    }

    Some((normalize_netease_text(&cleaned), String::new()))
}

#[cfg(target_os = "windows")]
fn to_secs_from_ms(value: Option<u64>) -> Option<u64> {
    value.map(|ms| ms / 1000).filter(|secs| *secs > 0)
}

#[cfg(target_os = "windows")]
fn song_duration_secs(song: &serde_json::Value) -> Option<u64> {
    to_secs_from_ms(
        song.get("duration")
            .or_else(|| song.get("dt"))
            .and_then(|v| v.as_u64()),
    )
}

#[cfg(target_os = "windows")]
fn song_cover_url(song: &serde_json::Value) -> Option<String> {
    song.pointer("/album/picUrl")
        .or_else(|| song.pointer("/al/picUrl"))
        .or_else(|| song.pointer("/album/blurPicUrl"))
        .or_else(|| song.pointer("/al/blurPicUrl"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "windows")]
async fn fetch_netease_song_detail_meta(
    client: &reqwest::Client,
    song_id: u64,
) -> Option<(Option<String>, Option<u64>)> {
    if song_id == 0 {
        return None;
    }

    let ids = format!("[{song_id}]");
    let resp = client
        .get("https://music.163.com/api/song/detail/")
        .header("Referer", "https://music.163.com/")
        .query(&[("ids", ids.as_str())])
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let payload = resp.json::<serde_json::Value>().await.ok()?;
    let song = payload.pointer("/songs/0")?;
    let cover = song_cover_url(song);
    let duration_secs = song_duration_secs(song);
    if music_debug_enabled() {
        eprintln!(
            "[music-debug] netease detail song_id={} has_cover={} duration_secs={}",
            song_id,
            cover.is_some(),
            duration_secs.unwrap_or(0)
        );
    }
    Some((cover, duration_secs))
}

#[cfg(target_os = "windows")]
fn exe_icon_data_url_from_path(exe_path: &str) -> Option<String> {
    let png = crate::icon_extractor::extract_exe_icon_png(exe_path).ok()?;
    if png.is_empty() {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Some(format!("data:image/png;base64,{b64}"))
}

#[cfg(target_os = "windows")]
async fn fetch_netease_track_meta(artist: &str, title: &str) -> Option<NeteaseTrackMeta> {
    if artist.trim().is_empty() || title.trim().is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) HaloMusic/1.0")
        .build()
        .ok()?;

    let keyword = format!("{artist} {title}");
    if music_debug_enabled() {
        eprintln!(
            "[music-debug] netease meta search keyword='{}' artist='{}' title='{}'",
            keyword, artist, title
        );
    }
    let search_resp = client
        .get("https://music.163.com/api/search/get/web")
        .header("Referer", "https://music.163.com/")
        .query(&[
            ("type", "1"),
            ("s", keyword.as_str()),
            ("limit", "8"),
            ("offset", "0"),
        ])
        .send()
        .await
        .ok()?;
    if !search_resp.status().is_success() {
        return None;
    }
    let payload = search_resp.json::<serde_json::Value>().await.ok()?;
    let songs = payload
        .pointer("/result/songs")
        .and_then(|v| v.as_array())?;
    if songs.is_empty() {
        if music_debug_enabled() {
            eprintln!("[music-debug] netease meta search returned empty songs");
        }
        return None;
    }

    let target_title = normalize_track_token(title);
    let target_artist = normalize_track_token(artist);
    let mut best: Option<(i32, u64, Option<String>, Option<u64>)> = None;
    for song in songs {
        let song_id = song.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
        if song_id == 0 {
            continue;
        }
        let song_title = song
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let song_artist = song
            .get("artists")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.get("name").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join("/")
            })
            .unwrap_or_default();
        let cover_url = song_cover_url(song);
        let duration_secs = song_duration_secs(song);

        let mut score = 0i32;
        let song_title_key = normalize_track_token(&song_title);
        let song_artist_key = normalize_track_token(&song_artist);
        if !song_title_key.is_empty() && song_title_key == target_title {
            score += 60;
        } else if !song_title_key.is_empty() && song_title_key.contains(&target_title) {
            score += 30;
        }
        if !song_artist_key.is_empty() && song_artist_key == target_artist {
            score += 40;
        } else if !song_artist_key.is_empty() && song_artist_key.contains(&target_artist) {
            score += 20;
        }

        match &best {
            Some((best_score, _, _, _)) if *best_score >= score => {}
            _ => best = Some((score, song_id, cover_url, duration_secs)),
        }
    }

    let (best_score, song_id, mut cover_url, mut duration_secs) = best?;

    // Search endpoint fields are unstable (cover may be absent); detail endpoint is more reliable.
    if cover_url.is_none() || duration_secs.is_none() {
        if let Some((detail_cover, detail_duration)) =
            fetch_netease_song_detail_meta(&client, song_id).await
        {
            if cover_url.is_none() {
                cover_url = detail_cover;
            }
            if duration_secs.is_none() {
                duration_secs = detail_duration;
            }
        }
    }

    if cover_url.is_none() && duration_secs.is_none() {
        if music_debug_enabled() {
            eprintln!(
                "[music-debug] netease meta unresolved song_id={} score={}",
                song_id, best_score
            );
        }
        return None;
    }

    if music_debug_enabled() {
        eprintln!(
            "[music-debug] netease meta resolved song_id={} score={} has_cover={} duration_secs={}",
            song_id,
            best_score,
            cover_url.is_some(),
            duration_secs.unwrap_or(0)
        );
    }

    Some(NeteaseTrackMeta {
        // Frontend accepts regular image URLs; keep metadata path lightweight.
        cover_data_url: cover_url,
        duration_secs,
    })
}

#[cfg(target_os = "windows")]
async fn resolve_netease_track_meta(
    state: &mut ListenerState,
    artist: &str,
    title: &str,
) -> Option<NeteaseTrackMeta> {
    let key = track_lookup_key(artist, title)?;
    if let Some(cached) = state.netease_meta_cache.get(&key) {
        if music_debug_enabled() {
            eprintln!(
                "[music-debug] netease meta cache hit key='{}' has_value={}",
                key,
                cached.is_some()
            );
        }
        return cached.clone();
    }

    if music_debug_enabled() {
        eprintln!("[music-debug] netease meta cache miss key='{}'", key);
    }
    let fetched = fetch_netease_track_meta(artist, title).await;
    if state.netease_meta_cache.len() > 256 {
        state.netease_meta_cache.clear();
    }
    state.netease_meta_cache.insert(key, fetched.clone());
    fetched
}

#[cfg(target_os = "windows")]
fn persist_cover_image(image: &gsmtc::Image) -> Option<String> {
    if image.data.is_empty() {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(&image.data);
    let digest = hasher.finalize();
    let file_stem = digest
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let ext = sanitize_file_ext(&image.content_type);

    let dir = crate::settings::get_music_data_dir().join("covers");
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    let path = dir.join(format!("{file_stem}.{ext}"));
    if !path.is_file() {
        if std::fs::write(&path, &image.data).is_err() {
            // If raw write fails, try decoding + png fallback.
            if let Ok(decoded) = image::load_from_memory(&image.data) {
                let mut png = Vec::new();
                if decoded
                    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
                    .is_ok()
                {
                    let fallback = dir.join(format!("{file_stem}.png"));
                    if std::fs::write(&fallback, png).is_ok() {
                        return Some(fallback.to_string_lossy().to_string());
                    }
                }
            }
            return None;
        }
    }
    Some(path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
fn model_to_current(
    source: &str,
    model: &SessionModel,
    cover_path: Option<String>,
) -> CurrentPlayingInfo {
    let platform = detect_source_platform(source);
    let media = model.media.as_ref();
    let playback = model.playback.as_ref();
    let timeline = model.timeline.as_ref();

    let artist = media
        .map(|m| m.artist.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_default();
    let title = media
        .map(|m| m.title.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_default();

    let is_playing = playback
        .map(|p| p.status == PlaybackStatus::Playing)
        .unwrap_or(false);
    let (duration_secs, position_secs) = timeline
        .map(|t| {
            timeline_to_duration_position_secs_for_platform(
                platform.as_str(),
                t.start,
                t.end,
                t.position,
                is_playing,
                Some(t.last_updated_at_ms),
            )
        })
        .unwrap_or((None, None));

    CurrentPlayingInfo {
        artist,
        title,
        cover_path,
        cover_data_url: None,
        duration_secs,
        position_secs,
        position_sampled_at_ms: Some(now_ms()),
        timeline_updated_at_ms: timeline.map(|value| value.last_updated_at_ms),
        playback_status: playback.map(|p| map_playback_status(&p.status)),
        source_app_id: Some(source.to_string()),
        source_platform: Some(platform),
    }
}

#[cfg(target_os = "windows")]
fn query_current_via_windows_api() -> Option<CurrentPlayingInfo> {
    ensure_windows_media_runtime();
    let manager = match WinSessionManager::RequestAsync() {
        Ok(v) => match v.get() {
            Ok(m) => m,
            Err(e) => {
                if music_debug_enabled() {
                    eprintln!("[music-debug] windows api get manager failed: {e}");
                }
                return None;
            }
        },
        Err(e) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] windows api request manager failed: {e}");
            }
            return None;
        }
    };

    let current_source_norm = match manager.GetCurrentSession() {
        Ok(s) => s
            .SourceAppUserModelId()
            .ok()
            .map(|v| v.to_string().to_ascii_lowercase()),
        Err(_) => None,
    };
    if music_debug_enabled() {
        eprintln!(
            "[music-debug] windows api current_source='{}'",
            current_source_norm.as_deref().unwrap_or("")
        );
    }

    let sessions = match manager.GetSessions() {
        Ok(v) => v,
        Err(e) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] windows api GetSessions failed: {e}");
            }
            return None;
        }
    };
    let mut best: Option<(i32, CurrentPlayingInfo)> = None;
    let mut session_count = 0usize;

    for session in sessions {
        session_count += 1;
        let source = match session.SourceAppUserModelId() {
            Ok(v) => v.to_string(),
            Err(_) => continue,
        };
        let source_norm = source.to_ascii_lowercase();
        let platform = detect_source_platform(&source);
        if should_ignore_music_source(&source, Some(platform.as_str())) {
            if music_debug_enabled() {
                eprintln!(
                    "[music-debug] windows api candidate ignored by browser/self policy source='{}' platform='{}'",
                    source, platform
                );
            }
            continue;
        }
        if platform == "netease" {
            if music_debug_enabled() {
                eprintln!(
                    "[music-debug] windows api candidate ignored by policy source='{}' platform='{}'",
                    source, platform
                );
            }
            continue;
        }

        let media = session
            .TryGetMediaPropertiesAsync()
            .ok()
            .and_then(|v| v.get().ok());
        let artist = media
            .as_ref()
            .and_then(|m| m.Artist().ok())
            .map(|v| v.to_string())
            .unwrap_or_default()
            .trim()
            .to_string();
        let title = media
            .as_ref()
            .and_then(|m| m.Title().ok())
            .map(|v| v.to_string())
            .unwrap_or_default()
            .trim()
            .to_string();
        let artist = normalize_netease_text(&artist);
        let title = normalize_netease_text(&title);

        let playback_status_raw = session
            .GetPlaybackInfo()
            .ok()
            .and_then(|v| v.PlaybackStatus().ok());
        let playback_status = playback_status_raw.map(map_playback_status_win);
        let is_playing = matches!(playback_status_raw, Some(WinPlaybackStatus::Playing));

        let (duration_secs, position_secs, timeline_updated_at_ms) =
            if let Ok(timeline) = session.GetTimelineProperties() {
            let start = timeline.StartTime().ok().map(|v| v.Duration).unwrap_or(0);
            let end = timeline.EndTime().ok().map(|v| v.Duration).unwrap_or(0);
            let pos = timeline.Position().ok().map(|v| v.Duration).unwrap_or(0);
            let last_updated_at_ms = timeline
                .LastUpdatedTime()
                .ok()
                .map(|v| filetime_to_unix_ms(v.UniversalTime));
            let (duration_secs, position_secs) =
                timeline_to_duration_position_secs_for_platform(
                    platform.as_str(),
                    start,
                    end,
                    pos,
                    is_playing,
                    last_updated_at_ms,
                );
            (duration_secs, position_secs, last_updated_at_ms)
        } else {
            (None, None, None)
        };

        let has_text = !artist.is_empty() || !title.is_empty();
        let is_playing = playback_status
            .as_deref()
            .map(|v| v.eq_ignore_ascii_case("playing"))
            .unwrap_or(false);
        let is_current = current_source_norm
            .as_deref()
            .map(|v| v == source_norm)
            .unwrap_or(false);

        let mut score = 0i32;
        if has_text {
            score += 40;
        }
        if is_playing {
            score += 30;
        }
        if is_current {
            score += 20;
        }
        if duration_secs.is_some() {
            score += 5;
        }
        if position_secs.is_some() {
            score += 3;
        }
        if platform == "netease" {
            score += 14;
            if !has_text {
                score += 4;
            }
        }

        if music_debug_enabled() {
            eprintln!(
                "[music-debug] candidate source='{}' platform='{}' status='{}' title='{}' artist='{}' score={} current={} has_text={}",
                source,
                platform,
                playback_status.as_deref().unwrap_or(""),
                title,
                artist,
                score,
                is_current,
                has_text
            );
            if !has_text {
                eprintln!(
                    "[music-debug] candidate weak-metadata source='{}' platform='{}'",
                    source, platform
                );
            }
        }

        let item = CurrentPlayingInfo {
            artist,
            title,
            cover_path: None,
            cover_data_url: None,
            duration_secs,
            position_secs,
            position_sampled_at_ms: Some(now_ms()),
            timeline_updated_at_ms,
            playback_status,
            source_app_id: Some(source),
            source_platform: Some(platform),
        };

        match &best {
            Some((best_score, _)) if *best_score >= score => {}
            _ => best = Some((score, item)),
        }
    }

    if music_debug_enabled() {
        eprintln!("[music-debug] windows api session_count={session_count}");
    }

    let selected = best.map(|(_, current)| current);
    if music_debug_enabled() {
        if let Some(v) = selected.as_ref() {
            eprintln!(
                "[music-debug] selected source='{}' platform='{}' title='{}' artist='{}' status='{}'",
                v.source_app_id.as_deref().unwrap_or(""),
                v.source_platform.as_deref().unwrap_or(""),
                v.title,
                v.artist,
                v.playback_status.as_deref().unwrap_or("")
            );
        } else {
            eprintln!("[music-debug] selected none from windows api fallback");
        }
    }
    selected
}

#[cfg(target_os = "windows")]
fn query_current_via_process_probe() -> Option<CurrentPlayingInfo> {
    if let Some(current) =
        crate::music_process_probe::query_current_via_qqmusic_process_probe(music_debug_enabled())
    {
        return Some(current);
    }

    let netease_enabled = std::env::var("HALO_ENABLE_NETEASE_DETECTION")
        .ok()
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on" | "enable"
            )
        })
        .unwrap_or(false);
    if !netease_enabled {
        if music_debug_enabled() {
            eprintln!("[music-debug] process probe disabled by policy for netease");
        }
        return None;
    }

    let script = r#"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HaloWin32 {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@ -ErrorAction SilentlyContinue | Out-Null

$direct = $null
try {
  $hwnd = [HaloWin32]::FindWindow('OrpheusBrowserHost', $null)
  if ($hwnd -ne [IntPtr]::Zero) {
    $pid = 0
    [HaloWin32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
    if ($pid -gt 0) {
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      if ($proc) {
        $title = ''
        try { $title = [string]$proc.MainWindowTitle } catch { $title = '' }
        $title = $title.Trim()
        if (-not [string]::IsNullOrWhiteSpace($title)) {
          $path = ''
          try { $path = $proc.Path } catch { $path = '' }
          $direct = [PSCustomObject]@{
            ProcessName = $proc.ProcessName
            ProcessPath = $path
            MainWindowTitle = $title
            Score = 120
          }
        }
      }
    }
  }
} catch {}

$candidates = Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 } |
  ForEach-Object {
    $name = $_.ProcessName
    $title = $_.MainWindowTitle.Trim()
    if (-not [string]::IsNullOrWhiteSpace($name) -and -not [string]::IsNullOrWhiteSpace($title)) {
      $path = ''
      try { $path = $_.Path } catch { $path = '' }

      $nameLower = $name.ToLowerInvariant()
      $titleLower = $title.ToLowerInvariant()
      $pathLower = if ($path) { $path.ToLowerInvariant() } else { '' }

      $nameHit = $nameLower -eq 'cloudmusic' -or $nameLower -eq 'cloudmusic2' -or $nameLower -eq 'neteasecloudmusic' -or $nameLower -like 'cloudmusic*' -or $nameLower -eq 'neteasemusic' -or $nameLower -eq 'wyy'
      $keywordHit = $nameLower.Contains('netease') -or $nameLower.Contains('music163') -or $nameLower.Contains('cloudmusic') -or $nameLower.Contains('163music') -or $nameLower.Contains('wangyiyun')
      $pathHit = $pathLower.Contains('\cloudmusic\') -or $pathLower.Contains('\netease\cloudmusic\') -or $pathLower.Contains('\neteasemusic\')
      $titleHit = $titleLower.Contains('netease cloud music') -or $title.Contains('网易云音乐')

      if ($nameHit -or $keywordHit -or $pathHit -or $titleHit) {
        $isHome = ($titleLower -eq 'netease cloud music' -or $title -eq '网易云音乐')
        $score = 0
        if ($nameHit) { $score += 20 }
        if ($keywordHit) { $score += 10 }
        if ($pathHit) { $score += 10 }
        if ($title.Contains(' - ') -or $title.Contains(' – ') -or $title.Contains(' — ') -or $title.Contains(' | ')) { $score += 18 }
        if ($isHome) { $score -= 40 }

        [PSCustomObject]@{
          ProcessName = $name
          ProcessPath = $path
          MainWindowTitle = $title
          Score = $score
        }
      }
    }
  } |
  Where-Object { $_ -ne $null } |
  Sort-Object -Property Score -Descending

$all = @()
if ($direct -ne $null) { $all += $direct }
$all += $candidates

$pick = $all | Sort-Object -Property Score -Descending | Select-Object -First 1 ProcessName,ProcessPath,MainWindowTitle
if ($null -eq $pick) { '' } else {
  $json = $pick | ConvertTo-Json -Compress -Depth 3
  $bytes = $utf8NoBom.GetBytes($json)
  [Convert]::ToBase64String($bytes)
}
"#;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut probe_cmd = std::process::Command::new("powershell");
    probe_cmd
        .args(["-NoLogo", "-NoProfile", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW);

    let output = match probe_cmd.output() {
        Ok(v) => v,
        Err(_) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] process probe command launch failed");
            }
            return None;
        }
    };
    if !output.status.success() {
        if music_debug_enabled() {
            eprintln!(
                "[music-debug] process probe command failed status={}",
                output.status
            );
        }
        return None;
    }
    let raw_b64 = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw_b64.is_empty() {
        if music_debug_enabled() {
            eprintln!("[music-debug] process probe empty result");
        }
        return None;
    }

    let decoded = match base64::engine::general_purpose::STANDARD.decode(raw_b64.as_bytes()) {
        Ok(v) => v,
        Err(e) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] process probe base64 decode failed: {e}");
            }
            return None;
        }
    };

    let raw = match String::from_utf8(decoded) {
        Ok(v) => v,
        Err(e) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] process probe utf8 decode failed: {e}");
            }
            return None;
        }
    };

    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            if music_debug_enabled() {
                eprintln!("[music-debug] process probe parse failed: {e}");
            }
            return None;
        }
    };
    let title_raw = value
        .get("MainWindowTitle")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if title_raw.is_empty() {
        if music_debug_enabled() {
            eprintln!("[music-debug] process probe window title is empty");
        }
        return None;
    }

    let process_name = value
        .get("ProcessName")
        .and_then(|v| v.as_str())
        .unwrap_or("cloudmusic")
        .to_string();
    let process_path = value
        .get("ProcessPath")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);

    if music_debug_enabled() {
        eprintln!(
            "[music-debug] process probe picked name='{}' title_raw='{}' path='{}'",
            process_name,
            title_raw,
            process_path.as_deref().unwrap_or("")
        );
    }

    let normalized_title_raw = normalize_netease_text(&title_raw);
    if music_debug_enabled() && normalized_title_raw != title_raw {
        eprintln!(
            "[music-debug] process probe normalized title_raw='{}' -> '{}'",
            title_raw, normalized_title_raw
        );
    }

    let Some((title, artist)) = parse_netease_track_from_title(&normalized_title_raw) else {
        if music_debug_enabled() {
            eprintln!(
                "[music-debug] process probe ignored non-track title='{}'",
                normalized_title_raw
            );
        }
        return None;
    };

    let icon_cover_data_url = process_path
        .as_deref()
        .and_then(exe_icon_data_url_from_path);

    if music_debug_enabled() {
        eprintln!(
            "[music-debug] process probe parsed title='{}' artist='{}' has_icon_cover={}",
            title,
            artist,
            icon_cover_data_url.is_some()
        );
    }

    Some(CurrentPlayingInfo {
        artist,
        title,
        cover_path: None,
        cover_data_url: icon_cover_data_url,
        duration_secs: None,
        position_secs: None,
        position_sampled_at_ms: Some(now_ms()),
        timeline_updated_at_ms: Some(now_ms()),
        playback_status: Some("Playing".to_string()),
        source_app_id: Some(process_name),
        source_platform: Some("netease".to_string()),
    })
}

#[cfg(target_os = "windows")]
fn enrich_current_from_local_cache(current: &mut CurrentPlayingInfo) {
    if current.source_platform.as_deref() == Some("qqmusic") {
        if current.duration_secs.is_none() {
            current.duration_secs = crate::music_qqmusic_cache::find_duration_secs(
                current.artist.as_str(),
                current.title.as_str(),
                None,
            );
        }

        if current.cover_data_url.is_none() && current.cover_path.is_none() {
            current.cover_data_url = crate::music_qqmusic_cache::find_cover_data_url(
                current.artist.as_str(),
                current.title.as_str(),
                current.duration_secs,
            )
            .or_else(crate::music_qqmusic_cache::find_recent_cover_data_url);
        }
    }
}

#[cfg(target_os = "windows")]
fn query_current_once_sync() -> Option<CurrentPlayingInfo> {
    let mut current = query_current_via_windows_api().or_else(query_current_via_process_probe);
    if let Some(snapshot) = current.as_mut() {
        enrich_current_from_local_cache(snapshot);
    }
    current
}

#[cfg(target_os = "windows")]
pub async fn query_current_on_demand() -> Option<CurrentPlayingInfo> {
    type CurrentQueryReply = std::sync::mpsc::Sender<Option<CurrentPlayingInfo>>;
    static QUERY_WORKER: OnceLock<std::sync::mpsc::Sender<CurrentQueryReply>> = OnceLock::new();
    static WORKER_BLOCK_UNTIL_MS: AtomicI64 = AtomicI64::new(0);
    static LAST_WORKER_RESULT: OnceLock<
        Arc<Mutex<Option<(i64, Option<CurrentPlayingInfo>)>>>,
    > = OnceLock::new();

    let last_worker_result = LAST_WORKER_RESULT
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone();

    let now = now_ms();
    let worker_blocked_until_ms = WORKER_BLOCK_UNTIL_MS.load(Ordering::Relaxed);
    if now < worker_blocked_until_ms {
        if let Some(current) = last_worker_result
            .lock()
            .ok()
            .and_then(|guard| guard.clone())
            .and_then(|(updated_at_ms, current)| {
                if now.saturating_sub(updated_at_ms) <= CURRENT_QUERY_RESULT_FRESH_MS {
                    current
                } else {
                    None
                }
            })
        {
            return Some(current);
        }
        return query_current_via_process_probe();
    }

    let worker_tx = QUERY_WORKER.get_or_init(|| {
        let (request_tx, request_rx) = std::sync::mpsc::channel::<CurrentQueryReply>();
        let last_worker_result = last_worker_result.clone();
        std::thread::spawn(move || {
            let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
            if hr.is_err() && hr != RPC_E_CHANGED_MODE_HRESULT && music_debug_enabled() {
                eprintln!(
                    "[music-debug] current query worker COM init failed: {:?}",
                    hr
                );
            }

            for reply_tx in request_rx {
                let current = query_current_once_sync();
                if let Ok(mut guard) = last_worker_result.lock() {
                    *guard = Some((now_ms(), current.clone()));
                }
                let _ = reply_tx.send(current);
            }
        });
        request_tx
    });

    let (reply_tx, reply_rx) = std::sync::mpsc::channel();
    if worker_tx.send(reply_tx).is_err() {
        if music_debug_enabled() {
            eprintln!("[music-debug] current query worker send failed");
        }
        WORKER_BLOCK_UNTIL_MS.store(
            now_ms().saturating_add(CURRENT_QUERY_WORKER_COOLDOWN_MS),
            Ordering::Relaxed,
        );
        return query_current_via_process_probe();
    }

    let wait_task = tauri::async_runtime::spawn_blocking(move || {
        reply_rx
            .recv_timeout(Duration::from_millis(MUSIC_ON_DEMAND_QUERY_TIMEOUT_MS))
            .ok()
    });

    match wait_task.await {
        Ok(Some(current)) => {
            WORKER_BLOCK_UNTIL_MS.store(0, Ordering::Relaxed);
            current
        }
        Ok(None) => {
            WORKER_BLOCK_UNTIL_MS.store(
                now_ms().saturating_add(CURRENT_QUERY_WORKER_COOLDOWN_MS),
                Ordering::Relaxed,
            );
            if music_debug_enabled() {
                eprintln!(
                    "[music-debug] on-demand query timed out after {}ms; cooling down worker for {}ms",
                    MUSIC_ON_DEMAND_QUERY_TIMEOUT_MS,
                    CURRENT_QUERY_WORKER_COOLDOWN_MS
                );
            }
            if let Some(current) = last_worker_result
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .and_then(|(updated_at_ms, current)| {
                    if now_ms().saturating_sub(updated_at_ms) <= CURRENT_QUERY_RESULT_FRESH_MS {
                        current
                    } else {
                        None
                    }
                })
            {
                return Some(current);
            }
            query_current_via_process_probe()
        }
        Err(error) => {
            WORKER_BLOCK_UNTIL_MS.store(
                now_ms().saturating_add(CURRENT_QUERY_WORKER_COOLDOWN_MS),
                Ordering::Relaxed,
            );
            if music_debug_enabled() {
                eprintln!("[music-debug] on-demand query join failed: {error}");
            }
            if let Some(current) = last_worker_result
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .and_then(|(updated_at_ms, current)| {
                    if now_ms().saturating_sub(updated_at_ms) <= CURRENT_QUERY_RESULT_FRESH_MS {
                        current
                    } else {
                        None
                    }
                })
            {
                return Some(current);
            }
            query_current_via_process_probe()
        }
    }
}

#[cfg(target_os = "windows")]
fn has_track_text(current: &CurrentPlayingInfo) -> bool {
    !current.title.trim().is_empty() || !current.artist.trim().is_empty()
}

#[cfg(target_os = "windows")]
fn same_track_identity(lhs: &CurrentPlayingInfo, rhs: &CurrentPlayingInfo) -> bool {
    lhs.source_platform.as_deref() == rhs.source_platform.as_deref()
        && lhs.source_app_id.as_deref() == rhs.source_app_id.as_deref()
        && lhs.artist.trim().eq_ignore_ascii_case(rhs.artist.trim())
        && lhs.title.trim().eq_ignore_ascii_case(rhs.title.trim())
}

#[cfg(target_os = "windows")]
fn should_hold_last_snapshot(current: Option<&CurrentPlayingInfo>) -> bool {
    current
        .and_then(|snapshot| snapshot.source_platform.as_deref())
        .map(|platform| platform != "qqmusic")
        .unwrap_or(true)
}

#[cfg(target_os = "windows")]
fn stabilize_qqmusic_from_previous(
    state: &ListenerState,
    current: &mut CurrentPlayingInfo,
) {
    if current.source_platform.as_deref() != Some("qqmusic") {
        return;
    }

    let Some(previous) = state.last_nonempty_current.as_ref() else {
        return;
    };
    if previous.source_platform.as_deref() != Some("qqmusic") || !same_track_identity(previous, current) {
        return;
    }

    let previous_is_paused = previous
        .playback_status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("paused"))
        .unwrap_or(false);

    if current.playback_status.is_none() && previous_is_paused {
        current.playback_status = previous.playback_status.clone();
    }

    let is_playing = current
        .playback_status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("playing"))
        .unwrap_or(false);
    if !is_playing {
        current.position_secs = previous.position_secs;
        current.position_sampled_at_ms = Some(now_ms());
        current.timeline_updated_at_ms = current.position_sampled_at_ms;
    }
}

#[cfg(target_os = "windows")]
fn snap_qqmusic_new_track_to_zero(state: &ListenerState, current: &mut CurrentPlayingInfo) {
    if current.source_platform.as_deref() != Some("qqmusic") {
        return;
    }

    let is_playing = current
        .playback_status
        .as_deref()
        .map(|value| value.eq_ignore_ascii_case("playing"))
        .unwrap_or(false);
    if !is_playing {
        return;
    }

    let estimated_position = current.position_secs.unwrap_or(0);
    let Some(previous) = state.last_nonempty_current.as_ref() else {
        if estimated_position <= 4 {
            current.position_secs = Some(0);
            current.position_sampled_at_ms = Some(now_ms());
            current.timeline_updated_at_ms = current.position_sampled_at_ms;
        }
        return;
    };

    if previous.source_platform.as_deref() != Some("qqmusic") {
        return;
    }

    if !same_track_identity(previous, current) && estimated_position <= 6 {
        current.position_secs = Some(0);
        current.position_sampled_at_ms = Some(now_ms());
        current.timeline_updated_at_ms = current.position_sampled_at_ms;
    }
}

#[cfg(target_os = "windows")]
fn merge_process_probe_into_current(base: &mut CurrentPlayingInfo, probe: &CurrentPlayingInfo) {
    let old_title = base.title.clone();
    let old_artist = base.artist.clone();
    let old_cover = base.cover_data_url.is_some() || base.cover_path.is_some();

    if base.title.trim().is_empty() && !probe.title.trim().is_empty() {
        base.title = probe.title.clone();
    }
    if base.artist.trim().is_empty() && !probe.artist.trim().is_empty() {
        base.artist = probe.artist.clone();
    }
    if base.cover_path.is_none() && base.cover_data_url.is_none() {
        base.cover_data_url = probe.cover_data_url.clone();
    }
    if base.duration_secs.is_none() {
        base.duration_secs = probe.duration_secs;
    }
    if base.position_secs.is_none() {
        base.position_secs = probe.position_secs;
    }
    if base.position_sampled_at_ms.is_none() {
        base.position_sampled_at_ms = probe.position_sampled_at_ms;
    }
    if base.timeline_updated_at_ms.is_none() {
        base.timeline_updated_at_ms = probe.timeline_updated_at_ms;
    }
    if base.playback_status.is_none() {
        base.playback_status = probe.playback_status.clone();
    }
    if probe
        .source_platform
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        && (base.source_platform.as_deref() != probe.source_platform.as_deref()
            && is_generic_source_platform(base.source_platform.as_deref()))
    {
        base.source_platform = probe.source_platform.clone();
    }
    if base
        .source_app_id
        .as_deref()
        .map(|value| value.trim().is_empty() || is_browser_like_source_token(value))
        .unwrap_or(true)
    {
        base.source_app_id = probe.source_app_id.clone();
    }

    if music_debug_enabled() {
        let new_cover = base.cover_data_url.is_some() || base.cover_path.is_some();
        let changed =
            base.title != old_title || base.artist != old_artist || old_cover != new_cover;
        if changed {
            eprintln!(
                "[music-debug] merged process data title='{}' artist='{}' has_cover={}",
                base.title, base.artist, new_cover
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn fallback_track_runtime_key(current: &CurrentPlayingInfo) -> Option<String> {
    if current.source_platform.as_deref() != Some("netease") && current.source_platform.as_deref() != Some("qqmusic") {
        return None;
    }
    let artist = normalize_track_token(&current.artist);
    let title = normalize_track_token(&current.title);
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    let source = current
        .source_app_id
        .as_deref()
        .map(normalize_track_token)
        .unwrap_or_else(|| "netease".to_string());
    Some(format!("{source}::{artist}::{title}"))
}

#[cfg(target_os = "windows")]
fn apply_virtual_position_clock(state: &mut ListenerState, current: &mut CurrentPlayingInfo) {
    let Some(track_key) = fallback_track_runtime_key(current) else {
        return;
    };
    let now = now_ms();
    let first_seen_ms = {
        let entry = state
            .virtual_track_first_seen_ms
            .entry(track_key.clone())
            .or_insert(now);
        *entry
    };
    let elapsed_from_first_seen_secs = now.saturating_sub(first_seen_ms).max(0) as u64 / 1000;
    let duration_secs = current.duration_secs;

    if let Some(real_pos) = current.position_secs {
        let anchored_pos = duration_secs
            .map(|dur| real_pos.min(dur))
            .unwrap_or(real_pos);
        if music_debug_enabled() {
            let was_different_track = state
                .virtual_position_clock
                .as_ref()
                .map(|v| v.track_key != track_key)
                .unwrap_or(true);
            if was_different_track {
                eprintln!(
                    "[music-debug] netease real timeline anchor track='{}' pos={}s dur={}s",
                    track_key,
                    anchored_pos,
                    duration_secs.unwrap_or(0)
                );
            }
        }
        state.virtual_position_clock = Some(VirtualPositionClock {
            track_key,
            anchor_at_ms: now,
            anchor_pos_secs: anchored_pos,
        });
        current.position_secs = Some(anchored_pos);
        current.position_sampled_at_ms = Some(now);
        current.timeline_updated_at_ms = Some(now);
        return;
    }

    let is_playing = current
        .playback_status
        .as_deref()
        .map(|v| v.eq_ignore_ascii_case("playing"))
        .unwrap_or(true);

    if let Some(clock) = state.virtual_position_clock.as_mut() {
        if clock.track_key == track_key {
            let elapsed_secs = if is_playing {
                now.saturating_sub(clock.anchor_at_ms).max(0) / 1000
            } else {
                0
            };
            let mut next_pos = clock.anchor_pos_secs.saturating_add(elapsed_secs as u64);
            if let Some(dur) = duration_secs {
                next_pos = next_pos.min(dur);
            }
            current.position_secs = Some(next_pos);
            current.position_sampled_at_ms = Some(now);
            current.timeline_updated_at_ms = Some(now);
            clock.anchor_at_ms = now;
            clock.anchor_pos_secs = next_pos;
            return;
        }
    }

    let mut start_pos = if is_playing {
        elapsed_from_first_seen_secs
    } else {
        0
    };
    if let Some(dur) = duration_secs {
        start_pos = start_pos.min(dur);
    }
    state.virtual_position_clock = Some(VirtualPositionClock {
        track_key,
        anchor_at_ms: now,
        anchor_pos_secs: start_pos,
    });
    current.position_secs = Some(start_pos);
    current.position_sampled_at_ms = Some(now);
    current.timeline_updated_at_ms = Some(now);
    if music_debug_enabled() {
        eprintln!(
            "[music-debug] netease virtual timeline started at {}s (seen_for={}s)",
            start_pos, elapsed_from_first_seen_secs
        );
    }
}

#[cfg(target_os = "windows")]
fn same_current(a: &Option<CurrentPlayingInfo>, b: &Option<CurrentPlayingInfo>) -> bool {
    same_track_snapshot(a, b) && same_timeline_snapshot(a, b)
}

#[cfg(target_os = "windows")]
fn same_track_snapshot(a: &Option<CurrentPlayingInfo>, b: &Option<CurrentPlayingInfo>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(lhs), Some(rhs)) => {
            lhs.artist == rhs.artist
                && lhs.title == rhs.title
                && lhs.cover_path == rhs.cover_path
                && lhs.cover_data_url == rhs.cover_data_url
                && lhs.source_app_id == rhs.source_app_id
                && lhs.source_platform == rhs.source_platform
        }
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn same_timeline_snapshot(a: &Option<CurrentPlayingInfo>, b: &Option<CurrentPlayingInfo>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(lhs), Some(rhs)) => {
            lhs.duration_secs == rhs.duration_secs
                && lhs.position_secs == rhs.position_secs
                && lhs.playback_status == rhs.playback_status
                && lhs.source_app_id == rhs.source_app_id
                && lhs.source_platform == rhs.source_platform
        }
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn track_payload_from_current(current: &CurrentPlayingInfo) -> MusicTrackUpdatePayload {
    MusicTrackUpdatePayload {
        artist: current.artist.clone(),
        title: current.title.clone(),
        cover_path: current.cover_path.clone(),
        cover_data_url: current.cover_data_url.clone(),
        source_app_id: current.source_app_id.clone(),
        source_platform: current.source_platform.clone(),
    }
}

#[cfg(target_os = "windows")]
fn timeline_payload_from_current(current: &CurrentPlayingInfo) -> MusicTimelineUpdatePayload {
    MusicTimelineUpdatePayload {
        position_secs: current.position_secs.map(|value| value as f64),
        duration_secs: current.duration_secs.map(|value| value as f64),
        last_updated_at_ms: current
            .timeline_updated_at_ms
            .or(current.position_sampled_at_ms)
            .map(|value| value as f64),
        playback_status: current.playback_status.clone(),
        source_app_id: current.source_app_id.clone(),
        source_platform: current.source_platform.clone(),
    }
}

#[cfg(target_os = "windows")]
fn choose_current_snapshot<'a>(state: &'a ListenerState) -> Option<(usize, &'a SessionSnapshot)> {
    if let Some(id) = state.current_session_id {
        if let Some(snapshot) = state.sessions.get(&id) {
            if snapshot.model.is_some() && !should_ignore_music_source(&snapshot.source, None) {
                return Some((id, snapshot));
            }
        }
    }

    state
        .sessions
        .iter()
        .find(|(_, v)| {
            !should_ignore_music_source(&v.source, None)
                && v.model
                    .as_ref()
                    .and_then(|m| m.playback.as_ref())
                    .map(|p| p.status == PlaybackStatus::Playing)
                    .unwrap_or(false)
        })
        .map(|(k, v)| (*k, v))
        .or_else(|| {
            state
                .sessions
                .iter()
                .find(|(_, v)| v.model.is_some() && !should_ignore_music_source(&v.source, None))
                .map(|(k, v)| (*k, v))
        })
        .or_else(|| {
            state
                .sessions
                .iter()
                .find(|(_, v)| !should_ignore_music_source(&v.source, None))
                .map(|(k, v)| (*k, v))
        })
}

#[cfg(target_os = "windows")]
fn maybe_record_play_event(
    state: &mut ListenerState,
    current: &CurrentPlayingInfo,
) -> Result<bool, String> {
    state.play_event_recorder.observe(current, now_ms())
}

#[cfg(target_os = "windows")]
fn update_current_and_emit(
    app: &tauri::AppHandle,
    current_state: &Arc<Mutex<Option<CurrentPlayingInfo>>>,
    next: Option<CurrentPlayingInfo>,
) {
    let previous = current_state.lock().ok().and_then(|guard| guard.clone());
    let track_changed = !same_track_snapshot(&previous, &next);
    let timeline_changed = !same_timeline_snapshot(&previous, &next);
    let changed = !same_current(&previous, &next);
    if let Ok(mut guard) = current_state.lock() {
        if changed {
            *guard = next.clone();
        }
    }
    if track_changed {
        let _ = app.emit(
            EVENT_MUSIC_TRACK_UPDATE,
            next.as_ref().map(track_payload_from_current),
        );
    }
    if timeline_changed {
        let _ = app.emit(
            EVENT_MUSIC_TIMELINE_UPDATE,
            next.as_ref().map(timeline_payload_from_current),
        );
    }
    if changed {
        let _ = app.emit(EVENT_MUSIC_CURRENT_CHANGED, ());
    }
}

#[cfg(target_os = "windows")]
async fn run_polling_music_listener(
    app: tauri::AppHandle,
    stop: Arc<AtomicBool>,
    current_state: Arc<Mutex<Option<CurrentPlayingInfo>>>,
) {
    while !stop.load(Ordering::Relaxed) {
        let next_current = query_current_on_demand().await;
        let loop_tick_ms = next_current
            .as_ref()
            .map(|current| {
                if has_track_text(current)
                    && current
                        .playback_status
                        .as_deref()
                        .map(|value| value.eq_ignore_ascii_case("playing"))
                        .unwrap_or(false)
                {
                    LISTENER_ACTIVE_TICK_MS
                } else {
                    LISTENER_IDLE_TICK_MS
                }
            })
            .unwrap_or(LISTENER_IDLE_TICK_MS);
        update_current_and_emit(&app, &current_state, next_current);
        tokio::time::sleep(Duration::from_millis(loop_tick_ms)).await;
    }

    update_current_and_emit(&app, &current_state, None);
}

#[cfg(target_os = "windows")]
pub async fn run_gsmtc_listener(
    app: tauri::AppHandle,
    stop: Arc<AtomicBool>,
    current_state: Arc<Mutex<Option<CurrentPlayingInfo>>>,
) {
    ensure_windows_media_runtime();
    if music_debug_enabled() {
        eprintln!("[music-debug] creating GSMTC session manager");
    }
    let mut manager_rx = match tokio::time::timeout(
        Duration::from_millis(GSMTC_CREATE_TIMEOUT_MS),
        gsmtc::SessionManager::create(),
    )
    .await
    {
        Ok(Ok(rx)) => rx,
        Ok(Err(e)) => {
            eprintln!("[music] failed to create GSMTC session manager: {e}");
            run_polling_music_listener(app, stop, current_state).await;
            return;
        }
        Err(_) => {
            eprintln!(
                "[music] creating GSMTC session manager timed out after {}ms; falling back to polling mode",
                GSMTC_CREATE_TIMEOUT_MS
            );
            run_polling_music_listener(app, stop, current_state).await;
            return;
        }
    };

    let (session_evt_tx, mut session_evt_rx) =
        tokio::sync::mpsc::unbounded_channel::<(usize, SessionUpdateEvent)>();
    let mut state = ListenerState::default();
    let _ = crate::db::prune_expired_lyrics_cache(now_ms());
    let initial_current = query_current_once_sync();
    if let Some(current) = initial_current.as_ref() {
        if has_track_text(current) {
            state.last_nonempty_current = Some(current.clone());
            state.last_nonempty_current_at_ms = now_ms();
        }
    }
    update_current_and_emit(&app, &current_state, initial_current);

    while !stop.load(Ordering::Relaxed) {
        let loop_tick_ms = if state.sessions.is_empty() {
            LISTENER_IDLE_TICK_MS
        } else {
            LISTENER_ACTIVE_TICK_MS
        };

        tokio::select! {
            maybe_mgr = manager_rx.recv() => {
                let Some(evt) = maybe_mgr else {
                    break;
                };
                match evt {
                    ManagerEvent::SessionCreated { session_id, mut rx, source } => {
                        state.sessions.insert(session_id, SessionSnapshot {
                            source,
                            model: None,
                            cover_path: None,
                        });
                        let tx = session_evt_tx.clone();
                        tokio::spawn(async move {
                            while let Some(evt) = rx.recv().await {
                                if tx.send((session_id, evt)).is_err() {
                                    break;
                                }
                            }
                        });
                    }
                    ManagerEvent::SessionRemoved { session_id } => {
                        state.sessions.remove(&session_id);
                        if state.current_session_id == Some(session_id) {
                            state.current_session_id = None;
                        }
                    }
                    ManagerEvent::CurrentSessionChanged { session_id } => {
                        state.current_session_id = session_id;
                    }
                }
                reset_fallback_backoff(&mut state);
            }
            maybe_session_evt = session_evt_rx.recv() => {
                let Some((session_id, evt)) = maybe_session_evt else {
                    continue;
                };
                if let Some(snapshot) = state.sessions.get_mut(&session_id) {
                    match evt {
                        SessionUpdateEvent::Model(model) => {
                            snapshot.model = Some(model);
                        }
                        SessionUpdateEvent::Media(model, image) => {
                            snapshot.model = Some(model);
                            if let Some(img) = image {
                                if let Some(path) = persist_cover_image(&img) {
                                    snapshot.cover_path = Some(path);
                                }
                            }
                        }
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(loop_tick_ms)) => {}
        }

        let mut next_current = choose_current_snapshot(&state).and_then(|(_, snapshot)| {
            snapshot
                .model
                .as_ref()
                .map(|model| model_to_current(&snapshot.source, model, snapshot.cover_path.clone()))
        });

        if next_current
            .as_ref()
            .and_then(|v| v.source_platform.as_deref())
            == Some("netease")
        {
            if music_debug_enabled() {
                eprintln!("[music-debug] gsmtc snapshot ignored by policy platform='netease'");
            }
            next_current = None;
            state.last_nonempty_current = None;
            state.last_nonempty_current_at_ms = 0;
            state.virtual_position_clock = None;
            state.virtual_track_first_seen_ms.clear();
        }

        let should_fallback = next_current
            .as_ref()
            .map(|v| !has_track_text(v))
            .unwrap_or(true);

        if should_fallback {
            let now = now_ms();
            let windows_api_blocked = now < state.windows_api_block_until_ms;
            let windows_api_ready = now.saturating_sub(state.last_windows_api_probe_at_ms)
                >= WINDOWS_API_RETRY_INTERVAL_MS;
            if !windows_api_blocked && windows_api_ready {
                state.last_windows_api_probe_at_ms = now;
                if let Some(mut fallback) = query_current_via_windows_api() {
                    if let Some(old) = next_current.as_ref() {
                        if old.title == fallback.title && old.artist == fallback.artist {
                            fallback.cover_path = old.cover_path.clone();
                            fallback.cover_data_url = old.cover_data_url.clone();
                        }
                    }
                    if music_debug_enabled() {
                        eprintln!(
                            "[music-debug] fallback applied source='{}' platform='{}' title='{}' artist='{}'",
                            fallback.source_app_id.as_deref().unwrap_or(""),
                            fallback.source_platform.as_deref().unwrap_or(""),
                            fallback.title,
                            fallback.artist
                        );
                    }
                    reset_fallback_backoff(&mut state);
                    next_current = Some(fallback);
                } else {
                    state.windows_api_fail_streak = state.windows_api_fail_streak.saturating_add(1);
                    if state.windows_api_fail_streak >= WINDOWS_API_RETRY_LIMIT {
                        state.windows_api_fail_streak = 0;
                        state.windows_api_block_until_ms =
                            now.saturating_add(WINDOWS_API_COOLDOWN_MS);
                        maybe_emit_diag(
                            &mut state,
                            format!(
                                "windows_api fallback cooldown {}ms after {} failed attempts",
                                WINDOWS_API_COOLDOWN_MS, WINDOWS_API_RETRY_LIMIT
                            ),
                        );
                    } else if music_debug_enabled() {
                        eprintln!(
                            "[music-debug] fallback produced none (windows api returned no playable session)"
                        );
                    }
                }
            }

            let is_qqmusic = next_current
                .as_ref()
                .and_then(|v| v.source_platform.as_deref())
                == Some("qqmusic");

            let need_process_probe = next_current
                .as_ref()
                .map(|v| !has_track_text(v))
                .unwrap_or(true) || is_qqmusic;
            if need_process_probe {
                let now = now_ms();
                let process_probe_blocked = now < state.process_probe_block_until_ms;
                let process_probe_ready = now.saturating_sub(state.last_process_probe_at_ms)
                    >= PROCESS_PROBE_RETRY_INTERVAL_MS;
                if !process_probe_blocked && process_probe_ready {
                    state.last_process_probe_at_ms = now;
                    if let Some(proc_fallback) = query_current_via_process_probe() {
                        if music_debug_enabled() {
                            eprintln!(
                                "[music-debug] process fallback applied source='{}' title='{}' artist='{}'",
                                proc_fallback.source_app_id.as_deref().unwrap_or(""),
                                proc_fallback.title,
                                proc_fallback.artist
                            );
                        }
                        state.process_probe_fail_streak = 0;
                        state.process_probe_block_until_ms = 0;
                        if let Some(current) = next_current.as_mut() {
                            merge_process_probe_into_current(current, &proc_fallback);
                        } else {
                            next_current = Some(proc_fallback);
                        }
                    } else {
                        state.process_probe_fail_streak =
                            state.process_probe_fail_streak.saturating_add(1);
                        if state.process_probe_fail_streak >= PROCESS_PROBE_RETRY_LIMIT {
                            state.process_probe_fail_streak = 0;
                            state.process_probe_block_until_ms =
                                now.saturating_add(PROCESS_PROBE_COOLDOWN_MS);
                            maybe_emit_diag(
                                &mut state,
                                format!(
                                    "process_probe cooldown {}ms after {} failed attempts",
                                    PROCESS_PROBE_COOLDOWN_MS, PROCESS_PROBE_RETRY_LIMIT
                                ),
                            );
                        } else if music_debug_enabled() {
                            eprintln!(
                                "[music-debug] process fallback produced none (netease process probe missed)"
                            );
                        }
                    }
                }
            } else {
                state.process_probe_fail_streak = 0;
                state.process_probe_block_until_ms = 0;
            }
        } else {
            reset_fallback_backoff(&mut state);
        }

        if next_current
            .as_ref()
            .and_then(|v| v.source_platform.as_deref())
            == Some("netease")
        {
            if music_debug_enabled() {
                eprintln!("[music-debug] netease current dropped by final policy filter");
            }
            next_current = None;
            state.last_nonempty_current = None;
            state.last_nonempty_current_at_ms = 0;
            state.virtual_position_clock = None;
            state.virtual_track_first_seen_ms.clear();
        }

        if let Some(current) = next_current.as_mut() {
            if current.source_platform.as_deref() == Some("netease")
                && (current.cover_data_url.is_none()
                    || (current.duration_secs.is_none() && current.cover_path.is_none()))
            {
                if let Some(meta) = resolve_netease_track_meta(
                    &mut state,
                    current.artist.as_str(),
                    current.title.as_str(),
                )
                .await
                {
                    if current.cover_data_url.is_none() {
                        current.cover_data_url = meta.cover_data_url;
                    }
                    if current.duration_secs.is_none() {
                        current.duration_secs = meta.duration_secs;
                    }
                }
            }

            if current.source_platform.as_deref() == Some("qqmusic")
                && current.cover_data_url.is_none()
                && current.cover_path.is_none()
            {
                current.cover_data_url = crate::music_qqmusic_cache::find_cover_data_url(
                    current.artist.as_str(),
                    current.title.as_str(),
                    current.duration_secs,
                )
                .or_else(crate::music_qqmusic_cache::find_recent_cover_data_url);
            }

            stabilize_qqmusic_from_previous(&state, current);
            snap_qqmusic_new_track_to_zero(&state, current);

            if current.source_platform.as_deref() == Some("netease") || current.source_platform.as_deref() == Some("qqmusic") {
                apply_virtual_position_clock(&mut state, current);
            } else {
                state.virtual_position_clock = None;
                state.virtual_track_first_seen_ms.clear();
            }

            match maybe_record_play_event(&mut state, current) {
                Ok(true) => {
                    let _ = app.emit(EVENT_MUSIC_PLAY_RECORDED, ());
                }
                Ok(false) => {}
                Err(e) => {
                    eprintln!("[music] record play event failed: {e}");
                }
            }
        }

        let now = now_ms();
        if let Some(current) = next_current.as_ref() {
            if has_track_text(current) {
                state.last_nonempty_current = Some(current.clone());
                state.last_nonempty_current_at_ms = now;
            }
        } else if should_hold_last_snapshot(state.last_nonempty_current.as_ref())
            && state.last_nonempty_current_at_ms > 0
            && now.saturating_sub(state.last_nonempty_current_at_ms) <= CURRENT_INFO_HOLD_MS
        {
            next_current = state.last_nonempty_current.clone();
        } else {
            state.last_nonempty_current = None;
            state.last_nonempty_current_at_ms = 0;
        }

        if let Some(current) = next_current.as_ref() {
            maybe_emit_diag(
                &mut state,
                format!(
                    "snapshot source='{}' platform='{}' status='{}' has_pos={} has_dur={} pos={} dur={} has_cover={} title='{}' artist='{}'",
                    current.source_app_id.as_deref().unwrap_or(""),
                    current.source_platform.as_deref().unwrap_or(""),
                    current.playback_status.as_deref().unwrap_or(""),
                    current.position_secs.is_some(),
                    current.duration_secs.is_some(),
                    current.position_secs.unwrap_or(0),
                    current.duration_secs.unwrap_or(0),
                    current.cover_data_url.is_some() || current.cover_path.is_some(),
                    current.title.trim(),
                    current.artist.trim()
                ),
            );
        } else {
            maybe_emit_diag(&mut state, "snapshot none".to_string());
        }

        update_current_and_emit(&app, &current_state, next_current);
    }

    update_current_and_emit(&app, &current_state, None);
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{
        stabilize_qqmusic_from_previous, timeline_to_duration_position_secs,
        timeline_to_duration_position_secs_for_platform, ListenerState,
    };
    use crate::CurrentPlayingInfo;

    fn build_current(
        title: &str,
        status: Option<&str>,
        position_secs: Option<u64>,
    ) -> CurrentPlayingInfo {
        CurrentPlayingInfo {
            artist: "Max Oazo".to_string(),
            title: title.to_string(),
            cover_path: None,
            cover_data_url: None,
            duration_secs: Some(211),
            position_secs,
            position_sampled_at_ms: Some(1),
            timeline_updated_at_ms: Some(1),
            playback_status: status.map(str::to_string),
            source_app_id: Some("QQMusic".to_string()),
            source_platform: Some("qqmusic".to_string()),
        }
    }

    #[test]
    fn stabilize_qqmusic_keeps_previous_paused_position() {
        let mut state = ListenerState::default();
        state.last_nonempty_current = Some(build_current("Close to Me", Some("Paused"), Some(123)));

        let mut current = build_current("Close to Me", Some("Paused"), None);
        stabilize_qqmusic_from_previous(&state, &mut current);

        assert_eq!(current.playback_status.as_deref(), Some("Paused"));
        assert_eq!(current.position_secs, Some(123));
    }

    #[test]
    fn stabilize_qqmusic_inherits_missing_status_from_previous() {
        let mut state = ListenerState::default();
        state.last_nonempty_current = Some(build_current("Close to Me", Some("Paused"), Some(88)));

        let mut current = build_current("Close to Me", None, None);
        stabilize_qqmusic_from_previous(&state, &mut current);

        assert_eq!(current.playback_status.as_deref(), Some("Paused"));
        assert_eq!(current.position_secs, Some(88));
    }

    #[test]
    fn qqmusic_new_track_snaps_small_estimate_to_zero() {
        let mut state = ListenerState::default();
        state.last_nonempty_current = Some(build_current("Older Song", Some("Playing"), Some(188)));

        let mut current = build_current("New Song", Some("Playing"), Some(3));
        super::snap_qqmusic_new_track_to_zero(&state, &mut current);

        assert_eq!(current.position_secs, Some(0));
    }

    #[test]
    fn qqmusic_snapshot_is_not_held_when_probe_goes_empty() {
        let previous = build_current("Close to Me", Some("Playing"), Some(12));
        assert!(!super::should_hold_last_snapshot(Some(&previous)));
    }

    #[test]
    fn qqmusic_timeline_prefers_raw_position_when_relative_value_underreports() {
        let secs = |value: u64| (value as i64) * 10_000_000;
        let (duration_secs, position_secs) = timeline_to_duration_position_secs_for_platform(
            "qqmusic",
            secs(43),
            secs(254),
            secs(53),
            false,
            None,
        );

        assert_eq!(duration_secs, Some(211));
        assert_eq!(position_secs, Some(53));
    }

    #[test]
    fn generic_timeline_keeps_relative_position_math() {
        let secs = |value: u64| (value as i64) * 10_000_000;
        let (duration_secs, position_secs) = timeline_to_duration_position_secs(
            secs(43),
            secs(254),
            secs(53),
            false,
            None,
        );

        assert_eq!(duration_secs, Some(211));
        assert_eq!(position_secs, Some(10));
    }
}
