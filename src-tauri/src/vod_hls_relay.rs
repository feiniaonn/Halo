use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};

use axum::http::HeaderValue as AxumHeaderValue;
use chrono::Local;
use serde::{Deserialize, Serialize};
use url::Url;

const SESSION_IDLE_TTL_MS: u64 = 10 * 60 * 1000;
const SESSION_EXPIRE_TTL_MS: u64 = 30 * 60 * 1000;
#[cfg(test)]
const VOD_RELAY_RESOURCE_PREFIX: &str = "/vod-hls/resource/";
#[cfg(test)]
const VOD_RELAY_SEGMENT_PREFIX: &str = "/vod-hls/segment/";
const VOD_RELAY_MANIFEST_PREFIX: &str = "/vod-hls/manifest";

static VOD_RELAY_SESSIONS: LazyLock<Mutex<HashMap<String, VodRelaySessionEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static VOD_RELAY_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
struct VodRelaySessionEntry {
    upstream_url: String,
    headers: Option<HashMap<String, String>>,
    created_at_ms: u64,
    last_access_ms: u64,
    expires_at_ms: u64,
    upstream_host: Option<String>,
    manifest_hits: u64,
    segment_hits: u64,
    resource_hits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodRelaySession {
    pub session_id: String,
    pub local_manifest_url: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodRelayStats {
    pub session_id: String,
    pub exists: bool,
    pub created_at_ms: Option<u64>,
    pub last_access_ms: Option<u64>,
    pub idle_ms: Option<u64>,
    pub upstream_host: Option<String>,
    pub manifest_hits: u64,
    pub segment_hits: u64,
    pub resource_hits: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct VodRelayBinaryResponse {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
}

fn now_ms() -> u64 {
    Local::now().timestamp_millis().max(0) as u64
}

fn next_session_id() -> String {
    let seq = VOD_RELAY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("vod-relay-{}-{seq}", Local::now().timestamp_millis())
}

fn cleanup_expired_sessions(sessions: &mut HashMap<String, VodRelaySessionEntry>) {
    let now = now_ms();
    let stale_ids = sessions
        .iter()
        .filter_map(|(session_id, entry)| {
            let idle_expired = now.saturating_sub(entry.last_access_ms) > SESSION_IDLE_TTL_MS;
            let hard_expired = now > entry.expires_at_ms;
            if idle_expired || hard_expired {
                Some(session_id.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    for session_id in stale_ids {
        sessions.remove(&session_id);
        crate::vod_hls_runtime::release_session(&session_id);
    }
}

#[derive(Clone, Copy)]
enum RelayAccessKind {
    Manifest,
    Segment,
    Resource,
}

fn access_entry(session_id: &str, kind: RelayAccessKind) -> Result<VodRelaySessionEntry, String> {
    let mut guard = VOD_RELAY_SESSIONS
        .lock()
        .map_err(|_| "vod relay session lock poisoned".to_string())?;
    cleanup_expired_sessions(&mut guard);
    let now = now_ms();
    let entry = guard
        .get_mut(session_id)
        .ok_or_else(|| format!("vod relay session not found: {session_id}"))?;
    entry.last_access_ms = now;
    match kind {
        RelayAccessKind::Manifest => entry.manifest_hits = entry.manifest_hits.saturating_add(1),
        RelayAccessKind::Segment => entry.segment_hits = entry.segment_hits.saturating_add(1),
        RelayAccessKind::Resource => entry.resource_hits = entry.resource_hits.saturating_add(1),
    }
    Ok(entry.clone())
}

#[cfg(test)]
fn rewrite_tag_uri_to_local(session_id: &str, base_url: &str, line: &str) -> String {
    let Some(uri_pos) = line.find("URI=\"") else {
        return line.to_string();
    };
    let uri_value_start = uri_pos + 5;
    let tail = &line[uri_value_start..];
    let Some(relative_end) = tail.find('"') else {
        return line.to_string();
    };
    let uri_value = &tail[..relative_end];
    if !uri_value.contains("://") {
        return line.to_string();
    }
    let encoded = url::form_urlencoded::byte_serialize(uri_value.as_bytes()).collect::<String>();
    let local_uri = format!("{base_url}{VOD_RELAY_RESOURCE_PREFIX}{session_id}?url={encoded}");
    format!(
        "{}{}{}",
        &line[..uri_value_start],
        local_uri,
        &tail[relative_end..]
    )
}

#[cfg(test)]
fn rewrite_manifest_for_local(session_id: &str, base_url: &str, manifest: &str) -> String {
    let mut rewritten_lines = Vec::new();
    let base = format!("{base_url}{VOD_RELAY_SEGMENT_PREFIX}{session_id}/");

    for raw_line in manifest.lines() {
        let line = raw_line.trim();
        if let Some(token) = line.strip_prefix("halo-relay://segment/") {
            rewritten_lines.push(format!("{base}{token}"));
            continue;
        }
        if line.starts_with("#EXT-X-KEY:") || line.starts_with("#EXT-X-MAP:") {
            rewritten_lines.push(rewrite_tag_uri_to_local(session_id, base_url, line));
            continue;
        }
        rewritten_lines.push(line.to_string());
    }

    let mut manifest_text = rewritten_lines.join("\n");
    manifest_text.push('\n');
    manifest_text
}

fn to_axum_content_type(content_type: Option<String>, fallback: &'static str) -> AxumHeaderValue {
    content_type
        .as_deref()
        .and_then(|value| AxumHeaderValue::from_str(value).ok())
        .unwrap_or_else(|| AxumHeaderValue::from_static(fallback))
}

pub(crate) async fn serve_manifest(session_id: &str, base_url: &str) -> Result<String, String> {
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[VodRelay] serving manifest session={session_id}"
    ));
    let entry = access_entry(session_id, RelayAccessKind::Manifest)?;
    crate::vod_hls_runtime::serve_manifest(
        session_id,
        base_url,
        &entry.upstream_url,
        &entry.headers,
    )
    .await
}

pub(crate) async fn serve_segment(
    session_id: &str,
    token_with_suffix: &str,
) -> Result<VodRelayBinaryResponse, String> {
    let entry = access_entry(session_id, RelayAccessKind::Segment)?;
    let response =
        crate::vod_hls_runtime::serve_segment(session_id, token_with_suffix, &entry.headers)
            .await?;
    Ok(VodRelayBinaryResponse {
        bytes: response.bytes,
        content_type: response.content_type,
    })
}

pub(crate) async fn serve_resource(
    session_id: &str,
    resource_url: &str,
) -> Result<VodRelayBinaryResponse, String> {
    let entry = access_entry(session_id, RelayAccessKind::Resource)?;
    let response = crate::vod_hls_runtime::serve_resource(resource_url, &entry.headers).await?;
    Ok(VodRelayBinaryResponse {
        bytes: response.bytes,
        content_type: response.content_type,
    })
}

pub(crate) fn manifest_content_type() -> AxumHeaderValue {
    AxumHeaderValue::from_static("application/vnd.apple.mpegurl")
}

pub(crate) fn binary_content_type(
    content_type: Option<String>,
    fallback: &'static str,
) -> AxumHeaderValue {
    to_axum_content_type(content_type, fallback)
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_open_hls_relay_session(
    url: String,
    headers: Option<HashMap<String, String>>,
    _source_hint: Option<String>,
    _sourceHint: Option<String>,
) -> Result<VodRelaySession, String> {
    let trimmed_url = url.trim();
    if trimmed_url.is_empty() {
        return Err("vod relay upstream url is empty".to_string());
    }
    let base_url = crate::spider_local_service::ensure_spider_local_service_started().await?;
    let session_id = next_session_id();
    let created_at_ms = now_ms();
    let entry = VodRelaySessionEntry {
        upstream_url: trimmed_url.to_string(),
        headers,
        created_at_ms,
        last_access_ms: created_at_ms,
        expires_at_ms: created_at_ms.saturating_add(SESSION_EXPIRE_TTL_MS),
        upstream_host: Url::parse(trimmed_url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string)),
        manifest_hits: 0,
        segment_hits: 0,
        resource_hits: 0,
    };
    let mut guard = VOD_RELAY_SESSIONS
        .lock()
        .map_err(|_| "vod relay session lock poisoned".to_string())?;
    cleanup_expired_sessions(&mut guard);
    guard.insert(session_id.clone(), entry.clone());

    Ok(VodRelaySession {
        session_id: session_id.clone(),
        local_manifest_url: format!(
            "{base_url}{VOD_RELAY_MANIFEST_PREFIX}/{session_id}/index.m3u8"
        ),
        expires_at_ms: entry.expires_at_ms,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_close_hls_relay_session(
    sessionId: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let Some(session_id) = sessionId
        .or(session_id)
        .map(|value| value.trim().to_string())
    else {
        return Ok(());
    };
    if session_id.is_empty() {
        return Ok(());
    }
    let mut guard = VOD_RELAY_SESSIONS
        .lock()
        .map_err(|_| "vod relay session lock poisoned".to_string())?;
    guard.remove(&session_id);
    drop(guard);
    crate::vod_hls_runtime::release_session(&session_id);
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_get_hls_relay_stats(
    sessionId: Option<String>,
    session_id: Option<String>,
) -> Result<VodRelayStats, String> {
    let id = sessionId
        .or(session_id)
        .unwrap_or_else(|| "unknown".to_string());
    let mut guard = VOD_RELAY_SESSIONS
        .lock()
        .map_err(|_| "vod relay session lock poisoned".to_string())?;
    cleanup_expired_sessions(&mut guard);
    let now = now_ms();
    let entry = guard.get(&id).cloned();
    let upstream_host = entry.as_ref().and_then(|value| value.upstream_host.clone());
    let manifest_hits = entry.as_ref().map(|value| value.manifest_hits).unwrap_or(0);
    let segment_hits = entry.as_ref().map(|value| value.segment_hits).unwrap_or(0);
    let resource_hits = entry.as_ref().map(|value| value.resource_hits).unwrap_or(0);

    Ok(VodRelayStats {
        session_id: id,
        exists: entry.is_some(),
        created_at_ms: entry.as_ref().map(|value| value.created_at_ms),
        last_access_ms: entry.as_ref().map(|value| value.last_access_ms),
        idle_ms: entry
            .as_ref()
            .map(|value| now.saturating_sub(value.last_access_ms)),
        upstream_host,
        manifest_hits,
        segment_hits,
        resource_hits,
    })
}

#[cfg(test)]
mod tests {
    use super::{rewrite_manifest_for_local, rewrite_tag_uri_to_local};

    #[test]
    fn rewrites_key_uri_to_local_proxy() {
        let line = "#EXT-X-KEY:METHOD=AES-128,URI=\"https://example.com/key.bin\"";
        let rewritten = rewrite_tag_uri_to_local("session-1", "http://127.0.0.1:9978", line);
        assert!(rewritten
            .contains("/vod-hls/resource/session-1?url=https%3A%2F%2Fexample.com%2Fkey.bin"));
    }

    #[test]
    fn rewrites_relay_manifest_to_local_endpoints() {
        let manifest = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://example.com/key.bin\"\n#EXTINF:5,\nhalo-relay://segment/abc.ts\n";
        let rewritten = rewrite_manifest_for_local("session-2", "http://127.0.0.1:9978", manifest);
        assert!(rewritten.contains("http://127.0.0.1:9978/vod-hls/segment/session-2/abc.ts"));
        assert!(rewritten
            .contains("/vod-hls/resource/session-2?url=https%3A%2F%2Fexample.com%2Fkey.bin"));
    }
}
