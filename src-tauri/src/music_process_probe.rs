#[cfg(target_os = "windows")]
use base64::Engine;

#[cfg(target_os = "windows")]
use encoding_rs::GBK;

#[cfg(target_os = "windows")]
use crate::CurrentPlayingInfo;
#[cfg(target_os = "windows")]
use windows::core::Interface;
#[cfg(target_os = "windows")]
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionEnumerator,
    IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, AudioSessionStateActive,
    AudioSessionStateInactive,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

#[cfg(target_os = "windows")]
pub(crate) fn query_current_via_qqmusic_process_probe(
    debug_enabled: bool,
) -> Option<CurrentPlayingInfo> {
    unsafe extern "system" fn enum_window_callback(hwnd: windows::Win32::Foundation::HWND, lparam: windows::Win32::Foundation::LPARAM) -> windows::core::BOOL {
        let callback_state = &mut *(lparam.0 as *mut (String, u32, String));
        
        let mut text: [u16; 512] = [0; 512];
        let len = windows::Win32::UI::WindowsAndMessaging::GetWindowTextW(hwnd, &mut text);
        if len > 0 {
            let title = String::from_utf16_lossy(&text[..len as usize]);
            if title.contains("-") && title.len() < 100 {
                let mut pid = 0;
                windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, Some(&mut pid));
                
                if let Ok(handle) = windows::Win32::System::Threading::OpenProcess(windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                    let mut path_buf = [0u16; 1024];
                    let mut path_len = path_buf.len() as u32;
                    let _ = windows::Win32::System::Threading::QueryFullProcessImageNameW(handle, windows::Win32::System::Threading::PROCESS_NAME_WIN32, windows::core::PWSTR::from_raw(path_buf.as_mut_ptr()), &mut path_len);
                    let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    if path.to_lowercase().ends_with("qqmusic.exe") {
                        if title != "QQ音乐" && title != "TxGuiFoundation" {
                            callback_state.0 = title;
                            callback_state.1 = pid;
                            callback_state.2 = path;
                            let _ = windows::Win32::Foundation::CloseHandle(handle);
                            return windows::core::BOOL::from(false);
                        }
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(handle);
                }
            }
        }
        windows::core::BOOL::from(true)
    }

    let mut state = (String::new(), 0u32, String::new());
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::EnumWindows(Some(enum_window_callback), windows::Win32::Foundation::LPARAM(&mut state as *mut _ as isize));
    }

    let found_title = state.0;
    let found_pid = state.1;
    let found_path = state.2;

    if found_title.is_empty() {
        if debug_enabled {
            eprintln!("[music-debug] qqmusic process probe window title is empty or not found");
        }
        return None;
    }

    let title_raw = found_title.trim().to_string();
    let process_name = "QQMusic.exe".to_string();
    let process_id = Some(found_pid);
    let process_path = if found_path.is_empty() { None } else { Some(found_path.trim_end_matches('\0').to_string()) };
    let process_started_at_ms: Option<i64> = None;

    let Some((title, artist)) = parse_qqmusic_window_title(&title_raw) else {
        if debug_enabled {
            eprintln!("[music-debug] qqmusic process probe ignored non-track title='{}'", title_raw);
        }
        return None;
    };

    let duration_secs = crate::music_qqmusic_cache::find_duration_secs(&artist, &title, None);
    let track_anchor_ms = crate::music_qqmusic_cache::find_track_anchor_ms(&artist, &title, duration_secs)
        .or_else(crate::music_qqmusic_cache::find_recent_picture_anchor_ms)
        .or(process_started_at_ms);

    let playback_active = process_id.and_then(query_process_audio_session_active);
    let playback_status = playback_active.map(|active| {
        if active { "Playing".to_string() } else { "Paused".to_string() }
    });

    let position_secs = if playback_active.unwrap_or(false) {
        estimate_runtime_position_secs(track_anchor_ms, duration_secs)
    } else {
        None
    };

    let cover_data_url = crate::music_qqmusic_cache::find_cover_data_url(&artist, &title, duration_secs)
        .or_else(crate::music_qqmusic_cache::find_recent_cover_data_url)
        .or_else(|| process_path.as_deref().and_then(exe_icon_data_url_from_path));

    if duration_secs.is_none() && cover_data_url.is_none() {
        if debug_enabled {
            eprintln!("[music-debug] qqmusic process probe found no matching local cache title='{}' artist='{}'", title, artist);
        }
        return None;
    }

    if debug_enabled {
        eprintln!("[music-debug] qqmusic process probe parsed title='{}' artist='{}' pid={:?} playback_active={:?} duration_secs={:?} position_secs={:?} anchor_ms={:?} has_cover={}",
            title, artist, process_id, playback_active, duration_secs, position_secs, track_anchor_ms, cover_data_url.is_some()
        );
    }

    Some(CurrentPlayingInfo {
        artist,
        title,
        cover_path: None,
        cover_data_url,
        duration_secs,
        position_secs,
        position_sampled_at_ms: Some(chrono::Utc::now().timestamp_millis()),
        timeline_updated_at_ms: Some(chrono::Utc::now().timestamp_millis()),
        playback_status,
        source_app_id: Some(process_name),
        source_platform: Some("qqmusic".to_string()),
    })
}

#[cfg(target_os = "windows")]
fn query_process_audio_session_active(process_id: u32) -> Option<bool> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .ok()?;
        let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).ok()?;
        let session_enum: IAudioSessionEnumerator = session_manager.GetSessionEnumerator().ok()?;
        let count = session_enum.GetCount().ok()?;
        let mut saw_inactive = false;

        for index in 0..count {
            let session_control = match session_enum.GetSession(index) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let session_control2: IAudioSessionControl2 = match session_control.cast() {
                Ok(value) => value,
                Err(_) => continue,
            };
            let session_pid = match session_control2.GetProcessId() {
                Ok(value) => value,
                Err(_) => continue,
            };
            if session_pid != process_id {
                continue;
            }

            let session_control_base: IAudioSessionControl = session_control2.cast().ok()?;
            let state = session_control_base.GetState().ok()?;
            if state == AudioSessionStateActive {
                return Some(true);
            }
            if state == AudioSessionStateInactive {
                saw_inactive = true;
            }
        }

        if saw_inactive { Some(false) } else { None }
    }
}

#[cfg(target_os = "windows")]
fn parse_qqmusic_window_title(title_raw: &str) -> Option<(String, String)> {
    let mut cleaned = normalize_qqmusic_text(title_raw)
        .replace('\u{3000}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    for suffix in [
        concat!(" - QQ", "\u{97f3}\u{4e50}"),
        concat!(" | QQ", "\u{97f3}\u{4e50}"),
        " - QQMusic",
        " | QQMusic",
    ] {
        if cleaned.ends_with(suffix) {
            cleaned = cleaned[..cleaned.len().saturating_sub(suffix.len())]
                .trim()
                .to_string();
        }
    }

    if cleaned.is_empty()
        || cleaned.eq_ignore_ascii_case("qqmusic")
        || cleaned == concat!("QQ", "\u{97f3}\u{4e50}")
    {
        return None;
    }

    for separator in [" - ", " \u{2013} ", " \u{2014} ", " | "] {
        if let Some((title, artist)) = cleaned.rsplit_once(separator) {
            let title = normalize_qqmusic_text(title);
            let artist = normalize_qqmusic_text(artist);
            if !title.is_empty() && !artist.is_empty() {
                return Some((title, artist));
            }
        }
    }

    None
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
    mojibake_marker_score(value) > 0 || {
        let cjk = count_cjk_chars(value);
        let common = common_hanzi_score(value);
        cjk >= 2 && common == 0
    }
}

#[cfg(target_os = "windows")]
fn mojibake_marker_score(value: &str) -> usize {
    const MARKERS: &[&str] = &[
        "浣", "钖", "鏆", "瑕", "鎬", "锛", "銆", "鈥", "闊", "璇", "缁", "鍚", "娆", "鎵", "绗",
        "鏂", "缃", "鎶", "鍙", "鐨", "鎴", "涓", "浜", "涔", "鏄", "偓", "唲", "楦", "彴", "粧",
        "姣", "曚", "笟", "鐢",
    ];
    MARKERS
        .iter()
        .map(|marker| value.matches(marker).count())
        .sum()
}

#[cfg(target_os = "windows")]
fn recover_utf8_from_gbk_mojibake(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
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
    let before_cjk = count_cjk_chars(trimmed);
    let after_cjk = count_cjk_chars(decoded.as_str());
    let before_marker_score = mojibake_marker_score(trimmed);
    let after_marker_score = mojibake_marker_score(decoded.as_str());
    let after_has_replacement = decoded.contains('\u{fffd}') || decoded.contains('?');
    if !after_has_replacement
        && (after_score >= before_score.saturating_add(1)
            || (before_score == 0 && after_score > 0)
            || (after_score == before_score && after_cjk > before_cjk)
            || after_marker_score < before_marker_score
            || (likely_gbk_mojibake(trimmed) && after_score >= before_score))
    {
        Some(decoded)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn normalize_qqmusic_text(value: &str) -> String {
    recover_utf8_from_gbk_mojibake(value).unwrap_or_else(|| value.trim().to_string())
}

#[cfg(target_os = "windows")]
fn estimate_runtime_position_secs(
    anchor_ms: Option<i64>,
    duration_secs: Option<u64>,
) -> Option<u64> {
    let duration_secs = duration_secs?;
    if duration_secs == 0 {
        return Some(0);
    }

    let anchor_ms = anchor_ms?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let elapsed_ms = now_ms.saturating_sub(anchor_ms);
    if !(0..=(7 * 24 * 60 * 60 * 1000)).contains(&elapsed_ms) {
        return None;
    }

    let elapsed_secs = u64::try_from(elapsed_ms / 1000).ok()?;
    Some(elapsed_secs % duration_secs)
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{
        normalize_qqmusic_text, parse_qqmusic_window_title, recover_utf8_from_gbk_mojibake,
    };
    use encoding_rs::GBK;

    #[test]
    fn parses_standard_qqmusic_track_window_title() {
        let parsed = parse_qqmusic_window_title("Под луной (Silver Ace remix) - SUNAMI");
        assert_eq!(
            parsed,
            Some((
                "Под луной (Silver Ace remix)".to_string(),
                "SUNAMI".to_string()
            ))
        );
    }

    #[test]
    fn rejects_shell_window_titles() {
        assert_eq!(
            parse_qqmusic_window_title(concat!("QQ", "\u{97f3}\u{4e50}")),
            None
        );
        assert_eq!(parse_qqmusic_window_title(""), None);
    }

    #[test]
    fn normalizes_gbk_mojibake_shell_title() {
        let expected = concat!("QQ", "\u{97f3}\u{4e50}");
        let mojibake = GBK.decode(expected.as_bytes()).0.into_owned();
        assert_eq!(normalize_qqmusic_text(&mojibake), expected);
    }

    #[test]
    fn recovers_actual_qqmusic_title_mojibake() {
        let expected = "\u{661f}\u{70ac}\u{4e0d}\u{7184}";
        let mojibake = GBK.decode(expected.as_bytes()).0.into_owned();
        assert_eq!(
            recover_utf8_from_gbk_mojibake(&mojibake),
            Some(expected.to_string())
        );
    }

    #[test]
    fn parses_chinese_qqmusic_track_window_title() {
        let title = "\u{6211}\u{4e0d}\u{6015}";
        let artist = "\u{4e00}\u{53ea}\u{767d}\u{7f8a}";
        let shell = concat!("QQ", "\u{97f3}\u{4e50}");
        let parsed = parse_qqmusic_window_title(&format!("{title} - {artist} - {shell}"));
        assert_eq!(parsed, Some((title.to_string(), artist.to_string())));
    }
}
