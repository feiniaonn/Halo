import sys

with open("src/music_control.rs", "r", encoding="utf-8") as f:
    code = f.read()

target = """    let fallback_media_keys = fallback_target
        .as_ref()
        .map(target_supports_media_keys)
        .unwrap_or(false);
"""
replacement = """    let fallback_media_keys = fallback_target
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
"""

if target in code:
    code = code.replace(target, replacement, 1) # Only first time in music_control_sync
    with open("src/music_control.rs", "w", encoding="utf-8") as f:
        f.write(code)
    print("Patched")
else:
    print("Not found")
