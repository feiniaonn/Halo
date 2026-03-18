use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use url::Url;

const SEGMENT_CACHE_TTL_MS: u64 = 120_000;
const SEGMENT_CACHE_MAX_ENTRIES: usize = 768;
const SEGMENT_FETCH_MAX_ATTEMPTS: usize = 2;
const MANIFEST_FETCH_MAX_ATTEMPTS: usize = 2;
const FETCH_RETRY_BASE_DELAY_MS: u64 = 100;
const INFLIGHT_WAIT_RETRY: usize = 3;
const INFLIGHT_WAIT_MS: u64 = 20;

static VOD_SEGMENT_CACHE: LazyLock<Mutex<HashMap<String, SegmentCacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static VOD_SEGMENT_INFLIGHT: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
static VOD_SESSION_CACHE_KEYS: LazyLock<Mutex<HashMap<String, HashSet<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct SegmentCacheEntry {
    stored_at_ms: u64,
    bytes: Vec<u8>,
    content_type: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct VodHlsBinaryResponse {
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn canonical_headers_signature(headers: &Option<HashMap<String, String>>) -> String {
    let mut items: Vec<(String, String)> = match headers {
        Some(h) => h
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
            .collect(),
        None => Vec::new(),
    };
    items.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    items
        .into_iter()
        .map(|(k, v)| format!("{k}:{v}"))
        .collect::<Vec<String>>()
        .join("|")
}

fn make_segment_cache_key(url: &str, headers: &Option<HashMap<String, String>>) -> String {
    format!("{}@@{}", url.trim(), canonical_headers_signature(headers))
}

fn cleanup_segment_cache(cache: &mut HashMap<String, SegmentCacheEntry>) {
    let now = now_ms();
    cache.retain(|_, entry| now.saturating_sub(entry.stored_at_ms) <= SEGMENT_CACHE_TTL_MS);
    if cache.len() <= SEGMENT_CACHE_MAX_ENTRIES {
        return;
    }
    let mut by_age: Vec<(String, u64)> = cache
        .iter()
        .map(|(k, v)| (k.clone(), v.stored_at_ms))
        .collect();
    by_age.sort_by_key(|(_, ts)| *ts);
    let remove_count = cache.len().saturating_sub(SEGMENT_CACHE_MAX_ENTRIES);
    for (idx, (key, _)) in by_age.into_iter().enumerate() {
        if idx >= remove_count {
            break;
        }
        cache.remove(&key);
    }
}

fn get_segment_cache(key: &str) -> Option<SegmentCacheEntry> {
    let mut cache = VOD_SEGMENT_CACHE.lock().ok()?;
    cleanup_segment_cache(&mut cache);
    cache.get(key).cloned()
}

fn put_segment_cache(key: String, entry: SegmentCacheEntry) {
    if let Ok(mut cache) = VOD_SEGMENT_CACHE.lock() {
        cleanup_segment_cache(&mut cache);
        cache.insert(key, entry);
    }
}

fn track_session_cache_key(session_id: &str, cache_key: &str) {
    if session_id.trim().is_empty() {
        return;
    }
    if let Ok(mut map) = VOD_SESSION_CACHE_KEYS.lock() {
        map.entry(session_id.to_string())
            .or_insert_with(HashSet::new)
            .insert(cache_key.to_string());
    }
}

fn clear_session_cache_index(session_id: &str) {
    let keys = VOD_SESSION_CACHE_KEYS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(session_id));
    let Some(keys) = keys else {
        return;
    };
    if let Ok(mut inflight) = VOD_SEGMENT_INFLIGHT.lock() {
        for key in &keys {
            inflight.remove(key);
        }
    }
}

fn try_acquire_inflight(key: &str) -> bool {
    if let Ok(mut inflight) = VOD_SEGMENT_INFLIGHT.lock() {
        if inflight.contains(key) {
            return false;
        }
        inflight.insert(key.to_string());
        true
    } else {
        false
    }
}

fn release_inflight(key: &str) {
    if let Ok(mut inflight) = VOD_SEGMENT_INFLIGHT.lock() {
        inflight.remove(key);
    }
}

fn retry_backoff_ms(attempt_idx: usize) -> u64 {
    let factor = 1u64 << (attempt_idx.min(4) as u32);
    FETCH_RETRY_BASE_DELAY_MS.saturating_mul(factor)
}

fn should_retry_fetch_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    !(lower.contains(" bad status 401")
        || lower.contains(" bad status 403")
        || lower.contains(" bad status 404")
        || lower.contains(" bad status 410"))
        && (lower.contains("error decoding response body")
            || lower.contains("invalid gzip header")
            || lower.contains("decoder error")
            || lower.contains("timed out")
            || lower.contains("timeout")
            || lower.contains("connection reset")
            || lower.contains("connection closed")
            || lower.contains("broken pipe")
            || lower.contains("tls")
            || lower.contains("dns")
            || lower.contains("temporary")
            || lower.contains(" bad status 429")
            || lower.contains(" bad status 5"))
}

fn detect_segment_payload_anomaly(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some("segment payload is PNG signature");
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some("segment payload is GIF signature");
    }
    let head_len = bytes.len().min(96);
    if head_len > 0 {
        let head = String::from_utf8_lossy(&bytes[..head_len]).to_ascii_lowercase();
        if head.contains("<!doctype html") || head.contains("<html") || head.contains("<pre>") {
            return Some("segment payload looks like HTML body");
        }
    }
    None
}

fn apply_hls_like_headers(
    builder: reqwest::RequestBuilder,
    force_close: bool,
    force_identity_encoding: bool,
) -> reqwest::RequestBuilder {
    let builder = builder
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache");
    let builder = if force_identity_encoding {
        builder.header("Accept-Encoding", "identity")
    } else {
        builder
    };
    if force_close {
        builder.header("Connection", "close")
    } else {
        builder
    }
}

fn is_absolute_url(input: &str) -> bool {
    let trimmed = input.trim();
    trimmed.starts_with("data:") || trimmed.contains("://")
}

fn rewrite_uri_attributes(line: &str, base_url: &Url) -> String {
    let mut rewritten = String::with_capacity(line.len() + 32);
    let mut cursor = line;

    loop {
        let Some(start) = cursor.find("URI=\"") else {
            rewritten.push_str(cursor);
            break;
        };
        let prefix_end = start + 5;
        rewritten.push_str(&cursor[..prefix_end]);
        cursor = &cursor[prefix_end..];

        let Some(end_quote) = cursor.find('"') else {
            rewritten.push_str(cursor);
            break;
        };
        let raw_uri = &cursor[..end_quote];
        if is_absolute_url(raw_uri) {
            rewritten.push_str(raw_uri);
        } else if let Ok(abs) = base_url.join(raw_uri) {
            rewritten.push_str(abs.as_str());
        } else {
            rewritten.push_str(raw_uri);
        }
        rewritten.push('"');
        cursor = &cursor[end_quote + 1..];
    }

    rewritten
}

fn extract_single_variant(manifest: &str) -> Option<String> {
    if manifest.contains("#EXT-X-MEDIA:") {
        return None;
    }

    let mut waiting_variant = false;
    let mut variants: Vec<String> = Vec::new();

    for raw in manifest.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if waiting_variant {
            if line.starts_with('#') {
                continue;
            }
            variants.push(line.to_string());
            waiting_variant = false;
            continue;
        }
        if line.starts_with("#EXT-X-STREAM-INF") {
            waiting_variant = true;
        }
    }

    if variants.len() == 1 {
        variants.pop()
    } else {
        None
    }
}

fn rewrite_manifest_content(manifest: &str, base_url: &Url) -> String {
    let mut rewritten = String::new();
    for raw_line in manifest.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            rewritten.push('\n');
            continue;
        }

        if trimmed.starts_with('#') {
            if trimmed.contains("URI=\"") {
                rewritten.push_str(&rewrite_uri_attributes(trimmed, base_url));
            } else {
                rewritten.push_str(raw_line);
            }
            rewritten.push('\n');
            continue;
        }

        if is_absolute_url(trimmed) {
            rewritten.push_str(trimmed);
        } else if let Ok(abs) = base_url.join(trimmed) {
            rewritten.push_str(abs.as_str());
        } else {
            rewritten.push_str(trimmed);
        }
        rewritten.push('\n');
    }
    rewritten
}

async fn fetch_manifest_text_once(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    force_close: bool,
    force_identity_encoding: bool,
    add_range: bool,
) -> Result<(Url, String), String> {
    let resolved = crate::media_cmds::resolve_media_request(url, headers.clone());
    let request_client = if force_close
        || force_identity_encoding
        || add_range
        || resolved.matched_proxy_rule.is_some()
    {
        crate::media_cmds::build_rescue_transport_client(&resolved, true, Duration::from_secs(15))?
    } else {
        crate::media_cmds::build_transport_client(&resolved, true, Duration::from_secs(15))
            .unwrap_or_else(|_| client.clone())
    };

    let mut builder = apply_hls_like_headers(
        request_client.get(&resolved.url),
        force_close,
        force_identity_encoding,
    );
    if add_range {
        builder = builder.header("Range", "bytes=0-");
    }
    builder = crate::media_cmds::apply_request_headers(builder, &resolved.headers);

    let resp = builder
        .send()
        .await
        .map_err(|err| format!("manifest request failed for {}: {err}", resolved.url))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(240).collect();
        return Err(format!(
            "manifest fetch failed: {} for {}, body: {}",
            status, resolved.url, snippet
        ));
    }

    let final_url = resp.url().clone();
    let content = resp
        .text()
        .await
        .map_err(|err| format!("manifest read failed for {}: {err}", final_url))?;
    Ok((final_url, content))
}

async fn fetch_manifest_text_with_retry(
    primary_client: &Client,
    rescue_client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<(Url, String), String> {
    let mut last_err = String::new();
    for attempt in 0..MANIFEST_FETCH_MAX_ATTEMPTS {
        let use_rescue = attempt > 0;
        let client = if use_rescue {
            rescue_client
        } else {
            primary_client
        };
        match fetch_manifest_text_once(client, url, headers, use_rescue, use_rescue, use_rescue)
            .await
        {
            Ok(value) => return Ok(value),
            Err(err) => {
                last_err = err.clone();
                if attempt + 1 >= MANIFEST_FETCH_MAX_ATTEMPTS || !should_retry_fetch_error(&err) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
            }
        }
    }
    Err(last_err)
}

async fn fetch_media_manifest(
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<String, String> {
    let client = crate::media_cmds::build_client()?;
    let rescue_client = crate::media_cmds::build_rescue_client()?;
    let mut current_url = url.trim().to_string();

    for _ in 0..4 {
        let (final_url, content) =
            fetch_manifest_text_with_retry(&client, &rescue_client, &current_url, headers).await?;
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        if !normalized.trim_start().starts_with("#EXTM3U") {
            return Err(format!("manifest response is not m3u8 for {current_url}"));
        }

        if let Some(variant) = extract_single_variant(&normalized) {
            let resolved = if is_absolute_url(&variant) {
                variant
            } else if let Ok(abs) = final_url.join(&variant) {
                abs.to_string()
            } else {
                variant
            };
            current_url = resolved;
            continue;
        }

        let rewritten = rewrite_manifest_content(&normalized, &final_url);
        let preview_lines: Vec<&str> = rewritten.lines().take(8).collect();
        eprintln!(
            "[VodHlsRuntime] manifest fetched for {} (base={}), preview:\n{}",
            url,
            final_url,
            preview_lines.join("\n")
        );
        return Ok(rewritten);
    }

    Err(format!(
        "manifest redirect/variant recursion exceeded for {}",
        url
    ))
}

fn encode_local_segment_token(source_url: &str) -> String {
    base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        source_url.as_bytes(),
    )
}

fn decode_local_segment_token(token: &str) -> Option<String> {
    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        token.trim_end_matches(".bin").as_bytes(),
    )
    .ok()?;
    String::from_utf8(bytes).ok()
}

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
    let local_uri = format!("{base_url}/vod-hls/resource/{session_id}?url={encoded}");
    format!(
        "{}{}{}",
        &line[..uri_value_start],
        local_uri,
        &tail[relative_end..]
    )
}

fn rewrite_manifest_for_local(session_id: &str, base_url: &str, manifest: &str) -> String {
    let mut rewritten_lines = Vec::new();
    let base = format!("{base_url}/vod-hls/segment/{session_id}/");

    for raw_line in manifest.lines() {
        let line = raw_line.trim();
        if line.starts_with("#EXT-X-KEY:") || line.starts_with("#EXT-X-MAP:") {
            rewritten_lines.push(rewrite_tag_uri_to_local(session_id, base_url, line));
            continue;
        }
        if !line.starts_with('#') && !line.is_empty() && line.contains("://") {
            let token = encode_local_segment_token(line);
            rewritten_lines.push(format!("{base}{token}.bin"));
            continue;
        }
        rewritten_lines.push(line.to_string());
    }

    let mut manifest_text = rewritten_lines.join("\n");
    manifest_text.push('\n');
    manifest_text
}

fn response_content_type(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn fetch_binary_once(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    context: &str,
    force_close: bool,
    force_identity_encoding: bool,
) -> Result<VodHlsBinaryResponse, String> {
    let resolved = crate::media_cmds::resolve_media_request(url, headers.clone());
    let request_client = if force_close
        || force_identity_encoding
        || resolved.matched_proxy_rule.is_some()
    {
        crate::media_cmds::build_rescue_transport_client(&resolved, true, Duration::from_secs(15))?
    } else {
        crate::media_cmds::build_transport_client(&resolved, true, Duration::from_secs(15))
            .unwrap_or_else(|_| client.clone())
    };
    let mut builder = apply_hls_like_headers(
        request_client.get(&resolved.url),
        force_close,
        force_identity_encoding,
    );
    builder = crate::media_cmds::apply_request_headers(builder, &resolved.headers);
    let resp = builder
        .send()
        .await
        .map_err(|err| format!("{context}: request failed for {}: {err}", resolved.url))?;
    if !resp.status().is_success() {
        return Err(format!(
            "{context}: bad status {} for {}",
            resp.status(),
            resolved.url
        ));
    }

    let content_type = response_content_type(resp.headers());
    let bytes = resp
        .bytes()
        .await
        .map_err(|err| format!("{context}: read failed for {}: {err}", resolved.url))?;

    Ok(VodHlsBinaryResponse {
        bytes: bytes.to_vec(),
        content_type,
    })
}

async fn fetch_binary_with_retry(
    url: &str,
    headers: &Option<HashMap<String, String>>,
    context: &str,
) -> Result<VodHlsBinaryResponse, String> {
    let primary_client = crate::media_cmds::build_client()?;
    let rescue_client = crate::media_cmds::build_rescue_client()?;
    let mut last_err = String::new();

    for attempt in 0..SEGMENT_FETCH_MAX_ATTEMPTS {
        let use_rescue = attempt > 0;
        let client = if use_rescue {
            &rescue_client
        } else {
            &primary_client
        };
        match fetch_binary_once(client, url, headers, context, use_rescue, use_rescue).await {
            Ok(value) => return Ok(value),
            Err(err) => {
                last_err = err.clone();
                if attempt + 1 >= SEGMENT_FETCH_MAX_ATTEMPTS || !should_retry_fetch_error(&err) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
            }
        }
    }

    Err(last_err)
}

pub(crate) async fn serve_manifest(
    session_id: &str,
    base_url: &str,
    upstream_url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<String, String> {
    let manifest = fetch_media_manifest(upstream_url, headers).await?;
    Ok(rewrite_manifest_for_local(session_id, base_url, &manifest))
}

pub(crate) async fn serve_segment(
    session_id: &str,
    token_with_suffix: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<VodHlsBinaryResponse, String> {
    let source_url = decode_local_segment_token(token_with_suffix)
        .ok_or_else(|| format!("invalid vod relay segment token: {token_with_suffix}"))?;
    let cache_key = make_segment_cache_key(&source_url, headers);

    if let Some(entry) = get_segment_cache(&cache_key) {
        return Ok(VodHlsBinaryResponse {
            bytes: entry.bytes,
            content_type: entry.content_type,
        });
    }

    for _ in 0..INFLIGHT_WAIT_RETRY {
        if !try_acquire_inflight(&cache_key) {
            if let Some(entry) = get_segment_cache(&cache_key) {
                return Ok(VodHlsBinaryResponse {
                    bytes: entry.bytes,
                    content_type: entry.content_type,
                });
            }
            tokio::time::sleep(Duration::from_millis(INFLIGHT_WAIT_MS)).await;
            continue;
        }

        let fetched = fetch_binary_with_retry(&source_url, headers, "vod relay segment").await;
        release_inflight(&cache_key);
        let response = fetched?;
        if let Some(anomaly) = detect_segment_payload_anomaly(response.bytes.as_slice()) {
            return Err(format!(
                "vod relay segment payload anomaly: {} for {}",
                anomaly, source_url
            ));
        }
        put_segment_cache(
            cache_key.clone(),
            SegmentCacheEntry {
                stored_at_ms: now_ms(),
                bytes: response.bytes.clone(),
                content_type: response.content_type.clone(),
            },
        );
        track_session_cache_key(session_id, &cache_key);
        return Ok(response);
    }

    Err(format!(
        "vod relay segment inflight wait exceeded for {}",
        source_url
    ))
}

pub(crate) async fn serve_resource(
    resource_url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<VodHlsBinaryResponse, String> {
    fetch_binary_with_retry(resource_url, headers, "vod relay resource").await
}

pub(crate) fn release_session(session_id: &str) {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return;
    }
    clear_session_cache_index(trimmed);
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
    fn rewrites_manifest_segments_to_local_proxy() {
        let manifest =
            "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://example.com/key.bin\"\n#EXTINF:5,\nhttps://cdn.example.com/seg-1.ts\n";
        let rewritten = rewrite_manifest_for_local("session-2", "http://127.0.0.1:9978", manifest);
        assert!(rewritten
            .contains("/vod-hls/resource/session-2?url=https%3A%2F%2Fexample.com%2Fkey.bin"));
        assert!(rewritten.contains("http://127.0.0.1:9978/vod-hls/segment/session-2/"));
        assert!(rewritten.contains(".bin"));
    }
}
