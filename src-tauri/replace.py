import sys

with open('src/music_process_probe.rs', 'r', encoding='utf-8') as f:
    text = f.read()

start_idx = text.find('pub(crate) fn query_current_via_qqmusic_process_probe(')
end_idx = text.find('#[cfg(target_os = "windows")]\nfn query_process_audio_session_active(', start_idx)

if start_idx != -1 and end_idx != -1:
    new_func = r'''pub(crate) fn query_current_via_qqmusic_process_probe(
    debug_enabled: bool,
) -> Option<CurrentPlayingInfo> {
    let mut found_title = String::new();
    let mut found_pid = 0u32;
    let mut found_path = String::new();

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

    found_title = state.0;
    found_pid = state.1;
    found_path = state.2;

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
        playback_status,
        source_app_id: Some(process_name),
        source_platform: Some("qqmusic".to_string()),
    })
}

'''

    with open('src/music_process_probe.rs', 'w', encoding='utf-8') as f:
        f.write(text[:start_idx] + new_func + text[end_idx:])
    print('Replaced successfully')
else:
    print('Failed to find start or end', start_idx, end_idx)
