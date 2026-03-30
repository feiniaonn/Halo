#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, KEYEVENTF_KEYUP, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};

pub(crate) fn supports_media_key_fallback(
    source_id: Option<&str>,
    source_platform: Option<&str>,
) -> bool {
    let source = source_id.unwrap_or("").trim();
    if source.is_empty() && source_platform.unwrap_or("").trim().is_empty() {
        return false;
    }

    let lowered_source = source.to_ascii_lowercase();
    if lowered_source.contains("tauri-app.halo") || lowered_source.ends_with("halo.exe") {
        return false;
    }

    true
}

#[cfg(target_os = "windows")]
pub(crate) fn send_media_key_command(command: &str) -> Result<bool, String> {
    let virtual_key = match command {
        "previous" => VK_MEDIA_PREV_TRACK,
        "play_pause" => VK_MEDIA_PLAY_PAUSE,
        "next" => VK_MEDIA_NEXT_TRACK,
        _ => return Ok(false),
    };

    unsafe {
        keybd_event(virtual_key.0 as u8, 0, Default::default(), 0);
        keybd_event(virtual_key.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }

    Ok(true)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn send_media_key_command(_command: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::supports_media_key_fallback;

    #[test]
    fn enables_media_key_fallback_for_real_music_sources() {
        assert!(supports_media_key_fallback(
            Some("QQMusic.exe"),
            Some("qqmusic")
        ));
        assert!(supports_media_key_fallback(
            Some("msedgewebview2.exe"),
            Some("qqmusic")
        ));
    }

    #[test]
    fn disables_media_key_fallback_for_halo_self() {
        assert!(!supports_media_key_fallback(
            Some("C:\\Program Files\\Halo\\halo.exe"),
            Some("halo")
        ));
    }
}
