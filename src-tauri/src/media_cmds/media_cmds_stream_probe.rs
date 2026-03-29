use std::collections::HashMap;

use super::{apply_request_headers, build_transport_client, resolve_media_request};

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
    } else if lower.contains(".mpd") {
        Some("dash")
    } else if lower.contains(".mp4") {
        Some("mp4")
    } else if lower.contains(".flv") {
        Some("flv")
    } else if lower.contains(".ts") || lower.contains(".m2ts") {
        Some("mpegts")
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
    } else if lower.contains("application/dash+xml") {
        Some("dash")
    } else if lower.contains("video/mp4") {
        Some("mp4")
    } else if lower.contains("video/x-flv") || lower.contains("video/flv") {
        Some("flv")
    } else if lower.contains("video/mp2t") {
        Some("mpegts")
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
    if bytes.len() >= 5
        && bytes.starts_with(b"<?xml")
        && bytes
            .windows(4)
            .any(|window| window.eq_ignore_ascii_case(b"mpd"))
    {
        return Some("dash");
    }
    if bytes.len() >= 376 && bytes[0] == 0x47 && bytes[188] == 0x47 {
        return Some("mpegts");
    }
    None
}

fn looks_like_hls_manifest_bytes(bytes: &[u8]) -> bool {
    bytes.len() >= 7 && bytes[..7].eq_ignore_ascii_case(b"#EXTM3U")
}

fn looks_like_image_manifest_uri(line: &str) -> bool {
    let lower = line.trim().to_ascii_lowercase();
    if lower.is_empty() || lower.starts_with('#') {
        return false;
    }

    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]
        .iter()
        .any(|token| lower.contains(token))
}

fn detect_hls_manifest_anomaly(bytes: &[u8]) -> Option<&'static str> {
    if !looks_like_hls_manifest_bytes(bytes) {
        return None;
    }

    let manifest = String::from_utf8_lossy(bytes);
    let mut media_lines = 0usize;
    let mut image_lines = 0usize;
    let mut html_lines = 0usize;

    for raw_line in manifest.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        media_lines += 1;
        if looks_like_image_manifest_uri(line) {
            image_lines += 1;
        }
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("<!doctype html") || lower.starts_with("<html") {
            html_lines += 1;
        }
    }

    if media_lines > 0 && image_lines == media_lines {
        return Some("stream_probe_hls_image_manifest");
    }
    if media_lines > 0 && html_lines == media_lines {
        return Some("stream_probe_hls_html_manifest");
    }
    None
}

fn looks_like_html_document(bytes: &[u8], content_type: Option<&str>) -> bool {
    if let Some(content_type) = content_type {
        let lower = content_type.to_ascii_lowercase();
        if lower.contains("text/html") || lower.contains("application/xhtml") {
            return true;
        }
    }

    let body = String::from_utf8_lossy(bytes);
    let lower = body.to_ascii_lowercase();
    lower.contains("<html")
        || lower.contains("<!doctype html")
        || lower.contains("<body")
        || lower.contains("</html>")
}

fn detect_hls_blocked_page_reason(
    bytes: &[u8],
    content_type: Option<&str>,
) -> Option<&'static str> {
    if !looks_like_html_document(bytes, content_type) {
        return None;
    }

    let body = String::from_utf8_lossy(bytes);
    let lower = body.to_ascii_lowercase();
    if lower.contains("请使用国内网络访问此页面")
        || lower.contains("国内网络访问")
        || lower.contains("country")
    {
        return Some("stream_probe_hls_geo_blocked");
    }
    Some("stream_probe_hls_html_blocked")
}

pub async fn probe_stream_kind(
    url: String,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<StreamProbeResult, String> {
    let resolved = resolve_media_request(&url, headers.clone());
    let mut result = StreamProbeResult {
        final_url: Some(resolved.url.clone()),
        ..Default::default()
    };
    let probe_timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(3_500).max(800));

    if let Some(kind) = detect_kind_from_url(&resolved.url) {
        result.kind = kind.to_string();
    }

    let client = build_transport_client(&resolved, true, probe_timeout)?;

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
                    if kind != "hls" {
                        return Ok(result);
                    }
                }
            }
        }
        if result.kind != "unknown" && result.kind != "hls" {
            return Ok(result);
        }
    }

    let probe_url = result
        .final_url
        .as_deref()
        .unwrap_or(&resolved.url)
        .to_string();
    let should_fetch_full_hls_manifest = result.kind == "hls";
    let mut get_req = client.get(&probe_url);
    if !should_fetch_full_hls_manifest {
        get_req = get_req.header(reqwest::header::RANGE, "bytes=0-2047");
    }
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
    let detected_kind = detect_kind_from_bytes(bytes.as_ref());
    if should_fetch_full_hls_manifest && detected_kind != Some("hls") {
        if let Some(reason) =
            detect_hls_blocked_page_reason(bytes.as_ref(), result.content_type.as_deref())
        {
            result.kind = "unknown".to_string();
            result.reason = Some(reason.to_string());
            return Ok(result);
        }
    }
    if let Some(kind) = detected_kind {
        if kind == "hls" {
            if let Some(reason) = detect_hls_manifest_anomaly(bytes.as_ref()) {
                result.kind = "unknown".to_string();
                result.reason = Some(reason.to_string());
                return Ok(result);
            }
        }
        if result.kind == "unknown" || kind == "hls" {
            result.kind = kind.to_string();
        }
    }
    if should_fetch_full_hls_manifest && detected_kind != Some("hls") {
        result.reason = Some("stream_probe_hls_manifest_unreadable".to_string());
    }
    if result.kind == "unknown" {
        result.reason = Some("stream_probe_unknown".to_string());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{
        detect_hls_blocked_page_reason, detect_hls_manifest_anomaly,
        detect_kind_from_content_type, is_audio_only_content_type,
    };

    #[test]
    fn content_type_detects_video_kinds() {
        assert_eq!(
            detect_kind_from_content_type("application/vnd.apple.mpegurl"),
            Some("hls")
        );
        assert_eq!(detect_kind_from_content_type("video/mp4"), Some("mp4"));
        assert_eq!(detect_kind_from_content_type("video/x-flv"), Some("flv"));
        assert_eq!(
            detect_kind_from_content_type("application/dash+xml"),
            Some("dash")
        );
        assert_eq!(detect_kind_from_content_type("video/mp2t"), Some("mpegts"));
    }

    #[test]
    fn audio_content_type_is_marked_audio_only() {
        assert!(is_audio_only_content_type("audio/mp4"));
        assert!(is_audio_only_content_type("audio/mpeg"));
        assert!(!is_audio_only_content_type("audio/mpegurl"));
        assert!(!is_audio_only_content_type("video/mp4"));
    }

    #[test]
    fn detects_fake_hls_image_manifest() {
        let manifest = b"#EXTM3U\n#EXTINF:10,\nhttps://cdn.example.com/frame-1.png\n#EXTINF:10,\nhttps://cdn.example.com/frame-2.jpg\n";
        assert_eq!(
            detect_hls_manifest_anomaly(manifest),
            Some("stream_probe_hls_image_manifest")
        );
    }

    #[test]
    fn ignores_normal_hls_manifest() {
        let manifest = b"#EXTM3U\n#EXTINF:10,\nsegment-1.ts\n#EXTINF:10,\nsegment-2.ts\n";
        assert_eq!(detect_hls_manifest_anomaly(manifest), None);
    }

    #[test]
    fn detects_geo_blocked_hls_html_page() {
        let html = "<!DOCTYPE html><html><body><h1>404 Page Not Found</h1><p>请使用国内网络访问此页面。</p><p>DEBUG: IP 15.168.39.218 country 5</p></body></html>";
        assert_eq!(
            detect_hls_blocked_page_reason(html.as_bytes(), Some("text/html; charset=utf-8")),
            Some("stream_probe_hls_geo_blocked")
        );
    }

    #[test]
    fn detects_generic_hls_html_block_page() {
        let html = "<!DOCTYPE html><html><body><h1>Forbidden</h1></body></html>";
        assert_eq!(
            detect_hls_blocked_page_reason(html.as_bytes(), Some("text/html; charset=utf-8")),
            Some("stream_probe_hls_html_blocked")
        );
    }
}
