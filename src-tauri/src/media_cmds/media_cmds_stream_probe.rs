use std::collections::HashMap;

use super::{apply_request_headers, build_client, resolve_media_request};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StreamProbeResult {
    pub kind: String,
    pub reason: Option<String>,
    pub content_type: Option<String>,
    pub final_url: Option<String>,
}

impl Default for StreamProbeResult {
    fn default() -> Self {
        Self {
            kind: "unknown".to_string(),
            reason: None,
            content_type: None,
            final_url: None,
        }
    }
}

fn detect_kind_from_url(url: &str) -> Option<&'static str> {
    let lower = url.to_ascii_lowercase();
    if lower.contains(".m3u8") {
        Some("hls")
    } else if lower.contains(".mp4") {
        Some("mp4")
    } else if lower.contains(".flv") {
        Some("flv")
    } else {
        None
    }
}

fn detect_kind_from_content_type(content_type: &str) -> Option<&'static str> {
    let lower = content_type.to_ascii_lowercase();
    if lower.contains("application/vnd.apple.mpegurl")
        || lower.contains("application/x-mpegurl")
        || lower.contains("audio/mpegurl")
        || lower.contains("application/octet-stream+m3u8")
    {
        Some("hls")
    } else if lower.contains("video/mp4") {
        Some("mp4")
    } else if lower.contains("video/x-flv") || lower.contains("video/flv") {
        Some("flv")
    } else {
        None
    }
}

fn is_audio_only_content_type(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.starts_with("audio/") && !lower.contains("mpegurl")
}

fn detect_kind_from_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 7 && bytes[..7].eq_ignore_ascii_case(b"#EXTM3U") {
        return Some("hls");
    }
    if bytes.len() >= 4 && bytes[..4] == [0x46, 0x4c, 0x56, 0x01] {
        return Some("flv");
    }
    if bytes.len() >= 12 && bytes[4..8] == [0x66, 0x74, 0x79, 0x70] {
        return Some("mp4");
    }
    None
}

pub async fn probe_stream_kind(
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<StreamProbeResult, String> {
    let resolved = resolve_media_request(&url, headers.clone());
    let mut result = StreamProbeResult {
        final_url: Some(resolved.url.clone()),
        ..Default::default()
    };

    if let Some(kind) = detect_kind_from_url(&resolved.url) {
        result.kind = kind.to_string();
    }

    let client = build_client()?;

    let head_req = apply_request_headers(client.head(&resolved.url), &resolved.headers);

    if let Ok(resp) = head_req.send().await {
        let final_url = resp.url().to_string();
        result.final_url = Some(final_url.clone());
        if let Some(v) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
            if let Ok(ct) = v.to_str() {
                result.content_type = Some(ct.to_string());
                if is_audio_only_content_type(ct) {
                    result.kind = "unknown".to_string();
                    result.reason = Some("stream_probe_audio_only".to_string());
                    return Ok(result);
                }
                if let Some(kind) = detect_kind_from_content_type(ct) {
                    result.kind = kind.to_string();
                    return Ok(result);
                }
            }
        }
        if result.kind != "unknown" {
            return Ok(result);
        }
    }

    let mut get_req = client
        .get(result.final_url.as_deref().unwrap_or(&resolved.url))
        .header(reqwest::header::RANGE, "bytes=0-2047");
    get_req = apply_request_headers(get_req, &resolved.headers);
    let resp = get_req
        .send()
        .await
        .map_err(|e| format!("probe_get_failed:{e}"))?;

    let final_url = resp.url().to_string();
    result.final_url = Some(final_url.clone());
    if let Some(v) = resp.headers().get(reqwest::header::CONTENT_TYPE) {
        if let Ok(ct) = v.to_str() {
            result.content_type = Some(ct.to_string());
            if is_audio_only_content_type(ct) {
                result.kind = "unknown".to_string();
                result.reason = Some("stream_probe_audio_only".to_string());
                return Ok(result);
            }
            if let Some(kind) = detect_kind_from_content_type(ct) {
                result.kind = kind.to_string();
            }
        }
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("probe_read_failed:{e}"))?;
    if result.kind == "unknown" {
        if let Some(kind) = detect_kind_from_bytes(bytes.as_ref()) {
            result.kind = kind.to_string();
        }
    }
    if result.kind == "unknown" {
        result.reason = Some("stream_probe_unknown".to_string());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{detect_kind_from_content_type, is_audio_only_content_type};

    #[test]
    fn content_type_detects_video_kinds() {
        assert_eq!(
            detect_kind_from_content_type("application/vnd.apple.mpegurl"),
            Some("hls")
        );
        assert_eq!(detect_kind_from_content_type("video/mp4"), Some("mp4"));
        assert_eq!(detect_kind_from_content_type("video/x-flv"), Some("flv"));
    }

    #[test]
    fn audio_content_type_is_marked_audio_only() {
        assert!(is_audio_only_content_type("audio/mp4"));
        assert!(is_audio_only_content_type("audio/mpeg"));
        assert!(!is_audio_only_content_type("audio/mpegurl"));
        assert!(!is_audio_only_content_type("video/mp4"));
    }
}
