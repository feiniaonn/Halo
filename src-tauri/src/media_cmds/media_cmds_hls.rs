use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use super::{apply_request_headers, build_client, build_rescue_client, resolve_media_request};

#[path = "media_cmds_hls_manifest.rs"]
mod media_cmds_hls_manifest;

#[derive(Clone, Default, serde::Serialize)]
pub struct LiveProxyMetrics {
    pub segment_count: u64,
    pub bytes_total: u64,
    pub last_segment_bytes: u64,
    pub last_segment_ms: u64,
    pub avg_segment_ms: u64,
    pub bytes_per_second: u64,
    pub updated_at_ms: u64,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cache_hit_ratio: f32,
    pub prefetch_warmed: u64,
    pub segment_error_count: u64,
    pub segment_retry_count: u64,
    pub transport_decode_error_count: u64,
    pub transient_error_count: u64,
    pub manifest_refresh_ms: u64,
    pub prefetch_active_workers: u64,
    pub prefetch_backoff_count: u64,
    pub relay_seq_cache_hits: u64,
    pub relay_source_fallback_hits: u64,
    pub buffer_anomaly_count: u64,
    pub manifest_4xx_count: u64,
    pub manifest_5xx_count: u64,
    pub build_profile_tag: String,
    pub last_error: Option<String>,
}

static LIVE_PROXY_METRICS: LazyLock<Mutex<LiveProxyMetrics>> =
    LazyLock::new(|| Mutex::new(LiveProxyMetrics::default()));

#[derive(Clone)]
struct SegmentCacheEntry {
    stored_at_ms: u64,
    bytes: Vec<u8>,
}

#[derive(Clone)]
struct LiveStreamState {
    manifest_url: String,
    headers: Option<HashMap<String, String>>,
    playback_rules: Option<Vec<TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    last_manifest: Option<String>,
    last_touch_ms: u64,
}

#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct TvBoxPlaybackRuleInput {
    pub name: String,
    #[serde(default)]
    pub hosts: Vec<String>,
    #[serde(default)]
    pub regex: Vec<String>,
    #[serde(default)]
    pub script: Vec<String>,
}

const SEGMENT_CACHE_TTL_MS: u64 = 120_000;
const SEGMENT_CACHE_MAX_ENTRIES: usize = 1200;
const SEGMENT_CACHE_FRESH_HIT_MS: u64 = 20_000;
const PREFETCH_SKIP_IF_FRESH_MS: u64 = 6_000;
const PREFETCH_SEGMENT_COUNT: usize = 24;
const RELAY_WINDOW_SEGMENTS: usize = 96;
const PREFETCH_WORKER_INTERVAL_MS: u64 = 1_000;
const PREFETCH_CONCURRENCY: usize = 6;
const PREFETCH_MAX_STREAM_WORKERS: usize = 6;
const STREAM_IDLE_TIMEOUT_MS: u64 = 180_000;
const INFLIGHT_WAIT_RETRY: usize = 6;
const INFLIGHT_WAIT_MS: u64 = 40;
const SEGMENT_FETCH_MAX_ATTEMPTS: usize = 3;
const MANIFEST_FETCH_MAX_ATTEMPTS: usize = 3;
const FETCH_RETRY_BASE_DELAY_MS: u64 = 140;
const LIVE_BUILD_PROFILE_TAG: &str = "live-policy-realtime";
const LIVE_WINDOW_TARGET_SECONDS: f32 = 12.0;

static HLS_SEGMENT_CACHE: LazyLock<Mutex<HashMap<String, SegmentCacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static HLS_SEGMENT_INFLIGHT: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));
static HLS_PREFETCH_RUNNING: LazyLock<Mutex<HashMap<String, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STREAM_CACHE_KEYS: LazyLock<Mutex<HashMap<String, HashSet<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static HLS_STREAM_STATES: LazyLock<Mutex<HashMap<String, LiveStreamState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone)]
struct ManifestSegmentRef {
    duration: f32,
    url: String,
    leading_tags: Vec<String>,
    effective_key: Option<String>,
    effective_map: Option<String>,
}

#[derive(Clone)]
struct ManifestPlaylistInfo {
    version: Option<u32>,
    target_duration: u32,
    media_sequence: u64,
    global_tags: Vec<String>,
    segments: Vec<ManifestSegmentRef>,
}

#[derive(Clone)]
struct DecodedRelaySegment {
    source_url: String,
    sequence: Option<u64>,
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

fn get_segment_cache_bytes(key: &str, max_age_ms: Option<u64>) -> Option<Vec<u8>> {
    let mut cache = HLS_SEGMENT_CACHE.lock().ok()?;
    cleanup_segment_cache(&mut cache);
    let now = now_ms();
    cache.get(key).and_then(|entry| {
        if let Some(max_age) = max_age_ms {
            if now.saturating_sub(entry.stored_at_ms) > max_age {
                return None;
            }
        }
        Some(entry.bytes.clone())
    })
}

fn put_segment_cache_bytes(key: String, bytes: Vec<u8>) {
    if let Ok(mut cache) = HLS_SEGMENT_CACHE.lock() {
        cleanup_segment_cache(&mut cache);
        cache.insert(
            key,
            SegmentCacheEntry {
                stored_at_ms: now_ms(),
                bytes,
            },
        );
    }
}

fn track_stream_cache_key(stream_key: &str, cache_key: &str) {
    if stream_key.trim().is_empty() {
        return;
    }
    if let Ok(mut map) = STREAM_CACHE_KEYS.lock() {
        map.entry(stream_key.to_string())
            .or_insert_with(HashSet::new)
            .insert(cache_key.to_string());
    }
}

fn clear_stream_cache_index(stream_key: &str) {
    let keys = STREAM_CACHE_KEYS
        .lock()
        .ok()
        .and_then(|mut map| map.remove(stream_key));
    let Some(keys) = keys else {
        return;
    };
    if let Ok(mut inflight) = HLS_SEGMENT_INFLIGHT.lock() {
        for key in &keys {
            inflight.remove(key);
        }
    }
}

fn try_acquire_inflight(key: &str) -> bool {
    if let Ok(mut inflight) = HLS_SEGMENT_INFLIGHT.lock() {
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
    if let Ok(mut inflight) = HLS_SEGMENT_INFLIGHT.lock() {
        inflight.remove(key);
    }
}

#[derive(Clone)]
struct PrefetchTarget {
    url: String,
    sequence: Option<u64>,
}

fn collect_manifest_prefetch_targets(manifest: &str) -> Vec<PrefetchTarget> {
    let info = parse_media_playlist_info(manifest);
    if !info.segments.is_empty() {
        let start_idx = info.segments.len().saturating_sub(PREFETCH_SEGMENT_COUNT);
        return info.segments[start_idx..]
            .iter()
            .enumerate()
            .map(|(offset, seg)| PrefetchTarget {
                url: seg.url.clone(),
                sequence: Some(
                    info.media_sequence
                        .saturating_add((start_idx + offset) as u64),
                ),
            })
            .collect();
    }

    let mut urls: Vec<String> = manifest
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#') && is_absolute_url(l))
        .map(|l| l.to_string())
        .collect();
    if urls.len() > PREFETCH_SEGMENT_COUNT {
        urls = urls.split_off(urls.len() - PREFETCH_SEGMENT_COUNT);
    }
    urls.into_iter()
        .map(|url| PrefetchTarget {
            url,
            sequence: None,
        })
        .collect()
}

fn parse_media_playlist_info(manifest: &str) -> ManifestPlaylistInfo {
    let mut version: Option<u32> = None;
    let mut target_duration: u32 = 0;
    let mut media_sequence: u64 = 0;
    let mut global_tags: Vec<String> = Vec::new();
    let mut pending_duration: Option<f32> = None;
    let mut pending_tags: Vec<String> = Vec::new();
    let mut current_key: Option<String> = None;
    let mut current_map: Option<String> = None;
    let mut seen_segment = false;
    let mut segments: Vec<ManifestSegmentRef> = Vec::new();

    for raw in manifest.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line == "#EXTM3U" || line == "#EXT-X-ENDLIST" {
            continue;
        }
        if let Some(v) = line.strip_prefix("#EXT-X-VERSION:") {
            if let Ok(parsed) = v.trim().parse::<u32>() {
                version = Some(parsed.max(1));
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            if let Ok(parsed) = v.trim().parse::<u32>() {
                target_duration = parsed;
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            if let Ok(parsed) = v.trim().parse::<u64>() {
                media_sequence = parsed;
            }
            continue;
        }
        if let Some(v) = line.strip_prefix("#EXTINF:") {
            let dur_text = v.split(',').next().unwrap_or("").trim();
            pending_duration = dur_text.parse::<f32>().ok();
            pending_tags.push(line.to_string());
            continue;
        }
        if line.starts_with("#EXT-X-KEY:") {
            current_key = Some(line.to_string());
            pending_tags.push(line.to_string());
            continue;
        }
        if line.starts_with("#EXT-X-MAP:") {
            current_map = Some(line.to_string());
            pending_tags.push(line.to_string());
            continue;
        }
        if line.starts_with('#') {
            if !seen_segment {
                global_tags.push(line.to_string());
            } else {
                pending_tags.push(line.to_string());
            }
            continue;
        }
        if !is_absolute_url(line) {
            continue;
        }
        seen_segment = true;
        segments.push(ManifestSegmentRef {
            duration: pending_duration.take().unwrap_or(1.0),
            url: line.to_string(),
            leading_tags: std::mem::take(&mut pending_tags),
            effective_key: current_key.clone(),
            effective_map: current_map.clone(),
        });
    }

    if target_duration == 0 {
        target_duration = segments
            .iter()
            .map(|s| s.duration.ceil() as u32)
            .max()
            .unwrap_or(2)
            .max(1);
    }

    ManifestPlaylistInfo {
        version,
        target_duration,
        media_sequence,
        global_tags,
        segments,
    }
}

fn encode_relay_segment_url(source_url: &str, sequence: u64) -> String {
    let payload = format!("{sequence}|{source_url}");
    let token = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        payload.as_bytes(),
    );
    format!("halo-relay://segment/{token}.ts")
}

fn decode_relay_segment_url(url: &str) -> Option<DecodedRelaySegment> {
    let token_with_suffix = url.strip_prefix("halo-relay://segment/")?;
    let token = token_with_suffix
        .strip_suffix(".ts")
        .unwrap_or(token_with_suffix);
    let bytes =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token).ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    if let Some((seq_text, source_url)) = decoded.split_once('|') {
        if let Ok(seq) = seq_text.parse::<u64>() {
            if source_url.contains("://") {
                return Some(DecodedRelaySegment {
                    source_url: source_url.to_string(),
                    sequence: Some(seq),
                });
            }
        }
    }
    Some(DecodedRelaySegment {
        source_url: decoded,
        sequence: None,
    })
}

#[derive(Clone)]
struct RelayWindowBuild {
    manifest: String,
}

fn normalize_seg_duration_sec(duration: f32) -> f32 {
    if duration.is_finite() && duration > 0.0 {
        duration.max(0.2)
    } else {
        1.0
    }
}

fn compute_window_start_idx(
    segments: &[ManifestSegmentRef],
    target_window_sec: f32,
    max_segments: usize,
) -> usize {
    if segments.is_empty() {
        return 0;
    }
    let mut start_idx = segments.len();
    let mut sum = 0.0_f32;
    while start_idx > 0 && sum < target_window_sec {
        start_idx -= 1;
        sum += normalize_seg_duration_sec(segments[start_idx].duration);
    }
    let min_allowed = segments.len().saturating_sub(max_segments);
    start_idx.max(min_allowed)
}

fn build_relay_manifest_from_info(
    info: &ManifestPlaylistInfo,
    target_window_sec: f32,
) -> RelayWindowBuild {
    if info.segments.is_empty() {
        return RelayWindowBuild {
            manifest: String::new(),
        };
    }
    let start_idx =
        compute_window_start_idx(&info.segments, target_window_sec, RELAY_WINDOW_SEGMENTS);
    let window = &info.segments[start_idx..];
    let media_sequence = info.media_sequence.saturating_add(start_idx as u64);

    let mut out = String::new();
    out.push_str("#EXTM3U\n");
    out.push_str(&format!("#EXT-X-VERSION:{}\n", info.version.unwrap_or(3)));
    out.push_str(&format!(
        "#EXT-X-TARGETDURATION:{}\n",
        info.target_duration.max(1)
    ));
    out.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{media_sequence}\n"));
    for tag in &info.global_tags {
        out.push_str(tag);
        out.push('\n');
    }
    let first_segment = &window[0];
    if !first_segment
        .leading_tags
        .iter()
        .any(|t| t.starts_with("#EXT-X-KEY:"))
    {
        if let Some(key) = &first_segment.effective_key {
            out.push_str(key);
            out.push('\n');
        }
    }
    if !first_segment
        .leading_tags
        .iter()
        .any(|t| t.starts_with("#EXT-X-MAP:"))
    {
        if let Some(map) = &first_segment.effective_map {
            out.push_str(map);
            out.push('\n');
        }
    }
    for (offset, seg) in window.iter().enumerate() {
        let sequence = media_sequence.saturating_add(offset as u64);
        let mut has_extinf = false;
        for tag in &seg.leading_tags {
            if tag.starts_with("#EXTINF:") {
                has_extinf = true;
            }
            out.push_str(tag);
            out.push('\n');
        }
        if !has_extinf {
            out.push_str(&format!("#EXTINF:{:.3},\n", seg.duration.max(0.2)));
        }
        out.push_str(&encode_relay_segment_url(&seg.url, sequence));
        out.push('\n');
    }
    RelayWindowBuild { manifest: out }
}

fn build_media_manifest_from_info(info: &ManifestPlaylistInfo) -> String {
    if info.segments.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    out.push_str("#EXTM3U\n");
    out.push_str(&format!("#EXT-X-VERSION:{}\n", info.version.unwrap_or(3)));
    out.push_str(&format!(
        "#EXT-X-TARGETDURATION:{}\n",
        info.target_duration.max(1)
    ));
    out.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{}\n", info.media_sequence));
    for tag in &info.global_tags {
        out.push_str(tag);
        out.push('\n');
    }
    for seg in &info.segments {
        let mut has_extinf = false;
        for tag in &seg.leading_tags {
            if tag.starts_with("#EXTINF:") {
                has_extinf = true;
            }
            out.push_str(tag);
            out.push('\n');
        }
        if !has_extinf {
            out.push_str(&format!("#EXTINF:{:.3},\n", seg.duration.max(0.2)));
        }
        out.push_str(&seg.url);
        out.push('\n');
    }
    out
}

pub(super) fn filter_media_manifest_content(manifest: &str, blocked_hosts: &[String]) -> String {
    if blocked_hosts.is_empty() {
        return manifest.to_string();
    }

    let mut info = parse_media_playlist_info(manifest);
    if info.segments.is_empty() {
        return manifest.to_string();
    }

    let original_len = info.segments.len();
    info.segments
        .retain(|segment| !should_block_url_by_host(blocked_hosts, &segment.url));
    if info.segments.is_empty() || info.segments.len() == original_len {
        return manifest.to_string();
    }

    build_media_manifest_from_info(&info)
}

#[cfg(test)]
fn build_relay_manifest(upstream_manifest: &str) -> String {
    let info = parse_media_playlist_info(upstream_manifest);
    if info.segments.is_empty() {
        return upstream_manifest.to_string();
    }
    build_relay_manifest_from_info(&info, LIVE_WINDOW_TARGET_SECONDS).manifest
}

fn normalize_stream_key(stream_key: Option<String>, fallback_url: &str) -> String {
    stream_key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback_url.trim().to_string())
}

fn upsert_stream_state(
    stream_key: &str,
    manifest_url: Option<String>,
    headers: Option<HashMap<String, String>>,
    playback_rules: Option<Vec<TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    manifest: Option<String>,
) {
    if let Ok(mut states) = HLS_STREAM_STATES.lock() {
        let now = now_ms();
        let state = states
            .entry(stream_key.to_string())
            .or_insert_with(|| LiveStreamState {
                manifest_url: manifest_url.clone().unwrap_or_default(),
                headers: headers.clone(),
                playback_rules: playback_rules.clone(),
                blocked_hosts: blocked_hosts.clone(),
                last_manifest: manifest.clone(),
                last_touch_ms: now,
            });
        if let Some(url) = manifest_url {
            state.manifest_url = url;
        }
        if headers.is_some() {
            state.headers = headers;
        }
        if playback_rules.is_some() {
            state.playback_rules = playback_rules;
        }
        if blocked_hosts.is_some() {
            state.blocked_hosts = blocked_hosts;
        }
        if manifest.is_some() {
            state.last_manifest = manifest;
        }
        state.last_touch_ms = now;
        states.retain(|_, v| now.saturating_sub(v.last_touch_ms) <= STREAM_IDLE_TIMEOUT_MS);
    }
}

fn get_stream_state(stream_key: &str) -> Option<LiveStreamState> {
    HLS_STREAM_STATES
        .lock()
        .ok()
        .and_then(|states| states.get(stream_key).cloned())
}

fn remove_stream_state(stream_key: &str) {
    if let Ok(mut states) = HLS_STREAM_STATES.lock() {
        states.remove(stream_key);
    }
}

pub fn get_live_proxy_metrics() -> LiveProxyMetrics {
    LIVE_PROXY_METRICS
        .lock()
        .map(|mut m| {
            ensure_live_metrics_defaults(&mut m);
            sync_prefetch_active_workers(&mut m);
            m.clone()
        })
        .unwrap_or_else(|_| LiveProxyMetrics {
            build_profile_tag: LIVE_BUILD_PROFILE_TAG.to_string(),
            ..LiveProxyMetrics::default()
        })
}

pub fn reset_live_proxy_metrics(stream_key: Option<String>) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        *m = LiveProxyMetrics {
            build_profile_tag: LIVE_BUILD_PROFILE_TAG.to_string(),
            ..LiveProxyMetrics::default()
        };
        m.updated_at_ms = now_ms();
    }
    if let Some(key) = stream_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            upsert_stream_state(trimmed, None, None, None, None, None);
        }
    }
}

pub fn release_live_stream(stream_key: String) {
    let trimmed = stream_key.trim();
    if trimmed.is_empty() {
        return;
    }
    remove_stream_state(trimmed);
    clear_stream_cache_index(trimmed);
    if let Ok(mut running) = HLS_PREFETCH_RUNNING.lock() {
        running.remove(trimmed);
    }
}

pub fn note_live_buffer_anomaly() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.buffer_anomaly_count = m.buffer_anomaly_count.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

fn ensure_live_metrics_defaults(metrics: &mut LiveProxyMetrics) {
    if metrics.build_profile_tag.is_empty() {
        metrics.build_profile_tag = LIVE_BUILD_PROFILE_TAG.to_string();
    }
    let total = metrics.cache_hits.saturating_add(metrics.cache_misses);
    metrics.cache_hit_ratio = if total == 0 {
        0.0
    } else {
        metrics.cache_hits as f32 / total as f32
    };
}

fn sync_prefetch_active_workers(metrics: &mut LiveProxyMetrics) {
    if let Ok(running) = HLS_PREFETCH_RUNNING.lock() {
        metrics.prefetch_active_workers = running.len() as u64;
    }
}

fn update_live_metrics_on_manifest_status(status: reqwest::StatusCode) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        if status.is_client_error() {
            m.manifest_4xx_count = m.manifest_4xx_count.saturating_add(1);
        } else if status.is_server_error() {
            m.manifest_5xx_count = m.manifest_5xx_count.saturating_add(1);
        }
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_retry(message: &str) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.segment_retry_count = m.segment_retry_count.saturating_add(1);
        m.last_error = Some(message.to_string());
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_prefetch_warm() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.prefetch_warmed = m.prefetch_warmed.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_prefetch_backoff() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.prefetch_backoff_count = m.prefetch_backoff_count.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_manifest_refresh(ms: u64) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.manifest_refresh_ms = ms;
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_cache_hit(bytes: usize) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.cache_hits = m.cache_hits.saturating_add(1);
        m.bytes_total = m.bytes_total.saturating_add(bytes as u64);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_cache_miss() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.cache_misses = m.cache_misses.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_error(message: String) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.segment_error_count = m.segment_error_count.saturating_add(1);
        m.last_error = Some(message);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_relay_seq_cache_hit() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.relay_seq_cache_hits = m.relay_seq_cache_hits.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn update_live_metrics_on_relay_source_fallback_hit() {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.relay_source_fallback_hits = m.relay_source_fallback_hits.saturating_add(1);
        m.updated_at_ms = now_ms();
    }
}

fn update_live_metrics_on_success(bytes: usize, ms: u64) {
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.segment_count = m.segment_count.saturating_add(1);
        m.bytes_total = m.bytes_total.saturating_add(bytes as u64);
        m.last_segment_bytes = bytes as u64;
        m.last_segment_ms = ms;
        m.updated_at_ms = now_ms();
    }
}

fn is_hard_status_error(message: &str) -> bool {
    message.contains(" bad status 401")
        || message.contains(" bad status 403")
        || message.contains(" bad status 404")
        || message.contains(" bad status 410")
}

fn is_transient_transport_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("error decoding response body")
        || lower.contains("invalid gzip header")
        || lower.contains("decoder error")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection reset")
        || lower.contains("connection closed")
        || lower.contains("broken pipe")
        || lower.contains("tls")
        || lower.contains("dns")
}

fn apply_hls_like_headers(
    builder: reqwest::RequestBuilder,
    target_url: &str,
    force_close: bool,
    force_identity_encoding: bool,
) -> reqwest::RequestBuilder {
    let b = builder
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .header("Cache-Control", "no-cache")
        .header("Pragma", "no-cache");
    let _ = target_url;
    let b = if force_identity_encoding {
        b.header("Accept-Encoding", "identity")
    } else {
        b
    };
    if force_close {
        b.header("Connection", "close")
    } else {
        b
    }
}

fn is_absolute_url(input: &str) -> bool {
    let trimmed = input.trim();
    trimmed.starts_with("data:") || trimmed.contains("://")
}

pub(super) fn matches_host_pattern(pattern: &str, url_or_host: &str) -> bool {
    let token = pattern.trim().to_ascii_lowercase();
    if token.is_empty() {
        return false;
    }

    let parsed = url::Url::parse(url_or_host).ok();
    let host = parsed
        .as_ref()
        .and_then(|value| value.host_str())
        .unwrap_or(url_or_host)
        .to_ascii_lowercase();
    let haystack = format!("{} {}", url_or_host.to_ascii_lowercase(), host);

    if token.contains('*') || token.contains(".*") {
        let escaped = regex::escape(&token)
            .replace("\\.\\*", ".*")
            .replace("\\*", ".*");
        if let Ok(expression) = regex::Regex::new(&escaped) {
            return expression.is_match(url_or_host) || expression.is_match(&host);
        }
        let simplified = token.replace('*', "").replace(".*", "");
        return !simplified.is_empty() && haystack.contains(&simplified);
    }

    haystack.contains(&token)
}

pub(super) fn should_block_url_by_host(blocked_hosts: &[String], url: &str) -> bool {
    blocked_hosts
        .iter()
        .any(|pattern| matches_host_pattern(pattern, url))
}

fn retry_backoff_ms(attempt_idx: usize) -> u64 {
    let factor = 1u64 << (attempt_idx.min(4) as u32);
    FETCH_RETRY_BASE_DELAY_MS.saturating_mul(factor)
}

fn should_retry_fetch_error(message: &str) -> bool {
    if is_hard_status_error(message) {
        return false;
    }
    is_transient_transport_error(message)
        || message.contains(" bad status 429")
        || message.contains(" bad status 5")
        || message.contains("temporary")
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

pub async fn fetch_hls_manifest_rewritten(
    url: String,
    headers: Option<HashMap<String, String>>,
    playback_rules: Option<Vec<TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
) -> Result<String, String> {
    let client = build_client()?;
    media_cmds_hls_manifest::fetch_hls_manifest_rewritten(
        &client,
        &url,
        &headers,
        playback_rules.as_deref(),
        blocked_hosts.as_deref(),
    )
    .await
}

async fn fetch_segment_bytes_once(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    context: &str,
    force_close: bool,
    force_identity_encoding: bool,
) -> Result<Vec<u8>, String> {
    let resolved = resolve_media_request(url, headers.clone());
    let mut builder = apply_hls_like_headers(
        client.get(&resolved.url),
        &resolved.url,
        force_close,
        force_identity_encoding,
    );
    builder = apply_request_headers(builder, &resolved.headers);
    let resp = builder
        .send()
        .await
        .map_err(|e| format!("{context}: request failed for {}: {e}", resolved.url))?;
    if !resp.status().is_success() {
        return Err(format!(
            "{context}: bad status {} for {}",
            resp.status(),
            resolved.url
        ));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("{context}: read failed for {}: {e}", resolved.url))
}

async fn fetch_segment_bytes_resilient(
    primary_client: &Client,
    rescue_client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    context: &str,
) -> Result<Vec<u8>, String> {
    let mut last_err = String::new();
    for attempt in 0..SEGMENT_FETCH_MAX_ATTEMPTS {
        let use_rescue = attempt > 0;
        let client = if use_rescue {
            rescue_client
        } else {
            primary_client
        };
        let force_close = use_rescue;
        let force_identity = use_rescue;
        match fetch_segment_bytes_once(client, url, headers, context, force_close, force_identity)
            .await
        {
            Ok(bytes) => {
                if attempt > 0 {
                    update_live_metrics_on_retry(&format!(
                        "segment recovered after retry attempt {} for {}",
                        attempt + 1,
                        url
                    ));
                }
                return Ok(bytes);
            }
            Err(err) => {
                last_err = err.clone();
                if attempt + 1 >= SEGMENT_FETCH_MAX_ATTEMPTS || !should_retry_fetch_error(&err) {
                    break;
                }
                update_live_metrics_on_retry(&format!(
                    "segment retry {} for {}: {}",
                    attempt + 1,
                    url,
                    err
                ));
                tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
            }
        }
    }
    Err(last_err)
}

async fn prefetch_segment_to_cache(
    client: &Client,
    url: &str,
    sequence: Option<u64>,
    headers: &Option<HashMap<String, String>>,
    stream_key: Option<&str>,
) -> Result<bool, String> {
    let cache_key = make_segment_cache_key(url, headers);
    let sequence_cache_key =
        sequence.map(|seq| make_segment_cache_key(&format!("{url}#seq={seq}"), headers));
    let source_fresh =
        get_segment_cache_bytes(&cache_key, Some(PREFETCH_SKIP_IF_FRESH_MS)).is_some();
    let seq_fresh = sequence_cache_key
        .as_ref()
        .and_then(|k| get_segment_cache_bytes(k, Some(PREFETCH_SKIP_IF_FRESH_MS)))
        .is_some();
    if source_fresh && (sequence_cache_key.is_none() || seq_fresh) {
        return Ok(false);
    }
    let inflight_key = sequence_cache_key
        .as_ref()
        .map(|s| s.as_str())
        .unwrap_or(cache_key.as_str());
    if !try_acquire_inflight(inflight_key) {
        return Ok(false);
    }
    let rescue_client = build_rescue_client()?;
    let fetched =
        fetch_segment_bytes_resilient(client, &rescue_client, url, headers, "Prefetch").await;
    release_inflight(inflight_key);
    let bytes = fetched?;
    put_segment_cache_bytes(cache_key.clone(), bytes.clone());
    if let Some(key) = stream_key {
        track_stream_cache_key(key, &cache_key);
    }
    if let Some(seq_key) = sequence_cache_key {
        put_segment_cache_bytes(seq_key.clone(), bytes);
        if let Some(key) = stream_key {
            track_stream_cache_key(key, &seq_key);
        }
    }
    Ok(true)
}

fn try_start_prefetch_worker(stream_key: &str) -> bool {
    let now = now_ms();
    if let Ok(mut running) = HLS_PREFETCH_RUNNING.lock() {
        if running.contains_key(stream_key) {
            return false;
        }
        if running.len() >= PREFETCH_MAX_STREAM_WORKERS {
            let victim = running
                .keys()
                .filter_map(|key| {
                    get_stream_state(key).map(|state| (key.clone(), state.last_touch_ms))
                })
                .min_by_key(|(_, last_touch_ms)| *last_touch_ms)
                .map(|(key, _)| key)
                .or_else(|| running.keys().next().cloned());
            if let Some(victim_key) = victim {
                remove_stream_state(&victim_key);
                running.remove(&victim_key);
            }
        }
        running.insert(stream_key.to_string(), now);
        if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
            ensure_live_metrics_defaults(&mut m);
            m.prefetch_active_workers = running.len() as u64;
            m.updated_at_ms = now_ms();
        }
        true
    } else {
        false
    }
}

fn finish_prefetch_worker(stream_key: &str) {
    if let Ok(mut running) = HLS_PREFETCH_RUNNING.lock() {
        running.remove(stream_key);
        if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
            ensure_live_metrics_defaults(&mut m);
            m.prefetch_active_workers = running.len() as u64;
            m.updated_at_ms = now_ms();
        }
    }
}

async fn prefetch_from_manifest(
    client: &Client,
    manifest: &str,
    headers: &Option<HashMap<String, String>>,
    stream_key: &str,
) {
    let targets = collect_manifest_prefetch_targets(manifest);
    if targets.is_empty() {
        return;
    }
    let mut join_set = tokio::task::JoinSet::new();
    for target in targets {
        let client_cloned = client.clone();
        let headers_cloned = headers.clone();
        let stream_key_cloned = stream_key.to_string();
        join_set.spawn(async move {
            prefetch_segment_to_cache(
                &client_cloned,
                &target.url,
                target.sequence,
                &headers_cloned,
                Some(stream_key_cloned.as_str()),
            )
            .await
            .unwrap_or(false)
        });
        if join_set.len() >= PREFETCH_CONCURRENCY {
            if let Some(result) = join_set.join_next().await {
                if result.unwrap_or(false) {
                    update_live_metrics_on_prefetch_warm();
                }
            }
        }
    }
    while let Some(result) = join_set.join_next().await {
        if result.unwrap_or(false) {
            update_live_metrics_on_prefetch_warm();
        }
    }
}

fn schedule_manifest_prefetch(stream_key: String) {
    if !try_start_prefetch_worker(&stream_key) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let client = match build_client() {
            Ok(c) => c,
            Err(_) => {
                finish_prefetch_worker(&stream_key);
                return;
            }
        };
        let mut manifest_fail_streak: u8 = 0;
        let mut manifest_backoff_until_ms: u64 = 0;
        loop {
            let state = match get_stream_state(&stream_key) {
                Some(s) => s,
                None => break,
            };
            if now_ms().saturating_sub(state.last_touch_ms) > STREAM_IDLE_TIMEOUT_MS {
                remove_stream_state(&stream_key);
                break;
            }
            if state.manifest_url.trim().is_empty() {
                tokio::time::sleep(Duration::from_millis(PREFETCH_WORKER_INTERVAL_MS)).await;
                continue;
            }
            let now_tick = now_ms();
            if now_tick < manifest_backoff_until_ms {
                tokio::time::sleep(Duration::from_millis(
                    manifest_backoff_until_ms
                        .saturating_sub(now_tick)
                        .min(1_000),
                ))
                .await;
                continue;
            }

            let mut manifest_to_prefetch = state.last_manifest.clone();
            let manifest_started = Instant::now();
            match media_cmds_hls_manifest::fetch_and_rewrite_manifest(
                &client,
                &state.manifest_url,
                &state.headers,
                state.playback_rules.as_deref(),
                state.blocked_hosts.as_deref(),
            )
            .await
            {
                Ok(latest) => {
                    manifest_fail_streak = 0;
                    manifest_to_prefetch = Some(latest.clone());
                    upsert_stream_state(&stream_key, None, None, None, None, Some(latest));
                    update_live_metrics_on_manifest_refresh(
                        manifest_started.elapsed().as_millis() as u64
                    );
                }
                Err(err) => {
                    manifest_fail_streak = manifest_fail_streak.saturating_add(1);
                    if manifest_fail_streak >= 3 {
                        manifest_fail_streak = 0;
                        manifest_backoff_until_ms = now_ms().saturating_add(10_000);
                        update_live_metrics_on_prefetch_backoff();
                        println!(
                            "[Frontend Warn] [LivePlayer] prefetch_backoff_enter: stream={} reason={}",
                            stream_key, err
                        );
                    }
                }
            }

            if let Some(m) = manifest_to_prefetch {
                prefetch_from_manifest(&client, &m, &state.headers, &stream_key).await;
            }

            tokio::time::sleep(Duration::from_millis(PREFETCH_WORKER_INTERVAL_MS)).await;
        }
        finish_prefetch_worker(&stream_key);
    });
}

pub async fn proxy_hls_manifest(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    playback_rules: Option<Vec<TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    stream_key: Option<String>,
) -> Result<String, String> {
    let manifest_started = Instant::now();
    let rewritten = fetch_hls_manifest_rewritten(
        url.clone(),
        headers.clone(),
        playback_rules.clone(),
        blocked_hosts.clone(),
    )
    .await?;
    update_live_metrics_on_manifest_refresh(manifest_started.elapsed().as_millis() as u64);
    let stream_key = normalize_stream_key(stream_key, &url);
    let parsed = parse_media_playlist_info(&rewritten);
    let relay_build = build_relay_manifest_from_info(&parsed, LIVE_WINDOW_TARGET_SECONDS);
    let relay_manifest = if relay_build.manifest.is_empty() {
        rewritten.clone()
    } else {
        relay_build.manifest.clone()
    };
    upsert_stream_state(
        &stream_key,
        Some(url.clone()),
        headers.clone(),
        playback_rules,
        blocked_hosts,
        Some(rewritten.clone()),
    );
    if let Ok(mut m) = LIVE_PROXY_METRICS.lock() {
        ensure_live_metrics_defaults(&mut m);
        m.updated_at_ms = now_ms();
    }
    schedule_manifest_prefetch(stream_key);
    Ok(relay_manifest)
}

pub async fn proxy_hls_segment(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    _playback_rules: Option<Vec<TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    stream_key: Option<String>,
) -> Result<String, String> {
    let client = build_client()?;
    let rescue_client = build_rescue_client()?;
    let started = Instant::now();
    let decoded_relay = decode_relay_segment_url(&url);
    let resolved_url = decoded_relay
        .as_ref()
        .map(|v| v.source_url.clone())
        .unwrap_or(url.clone());
    if should_block_url_by_host(blocked_hosts.as_deref().unwrap_or(&[]), &resolved_url) {
        return Err(format!(
            "Segment blocked by ad host policy for {}",
            resolved_url
        ));
    }
    let source_cache_key = make_segment_cache_key(&resolved_url, &headers);
    let sequence_cache_key = decoded_relay.as_ref().and_then(|v| {
        v.sequence
            .map(|seq| make_segment_cache_key(&format!("{}#seq={seq}", v.source_url), &headers))
    });
    let inflight_key = sequence_cache_key
        .clone()
        .unwrap_or_else(|| source_cache_key.clone());
    let relay_sequence_mode = sequence_cache_key.is_some();
    let source_hit_max_age = Some(SEGMENT_CACHE_FRESH_HIT_MS);
    let normalized_stream_key = stream_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if let Some(ref key) = stream_key {
        if get_stream_state(key).is_some() {
            upsert_stream_state(key, None, None, None, None, None);
            schedule_manifest_prefetch(key.clone());
        }
    }

    let cached = if relay_sequence_mode {
        sequence_cache_key
            .as_ref()
            .and_then(|k| get_segment_cache_bytes(k, Some(SEGMENT_CACHE_FRESH_HIT_MS)))
    } else {
        get_segment_cache_bytes(&source_cache_key, source_hit_max_age)
    };
    if let Some(bytes) = cached {
        if let Some(anomaly) = detect_segment_payload_anomaly(bytes.as_slice()) {
            let msg = format!(
                "Segment payload anomaly (cache): {} for {}",
                anomaly, resolved_url
            );
            update_live_metrics_on_error(msg.clone());
            return Err(msg);
        }
        if relay_sequence_mode {
            update_live_metrics_on_relay_seq_cache_hit();
        }
        update_live_metrics_on_cache_hit(bytes.len());
        return Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            bytes.as_slice(),
        ));
    }

    for _ in 0..INFLIGHT_WAIT_RETRY {
        if !try_acquire_inflight(&inflight_key) {
            let waiting_cached = if relay_sequence_mode {
                sequence_cache_key
                    .as_ref()
                    .and_then(|k| get_segment_cache_bytes(k, Some(SEGMENT_CACHE_FRESH_HIT_MS)))
            } else {
                get_segment_cache_bytes(&source_cache_key, source_hit_max_age)
            };
            if let Some(bytes) = waiting_cached {
                if relay_sequence_mode {
                    update_live_metrics_on_relay_seq_cache_hit();
                }
                update_live_metrics_on_cache_hit(bytes.len());
                return Ok(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    bytes.as_slice(),
                ));
            }
            tokio::time::sleep(Duration::from_millis(INFLIGHT_WAIT_MS)).await;
            continue;
        }
        let fetched = fetch_segment_bytes_resilient(
            &client,
            &rescue_client,
            &resolved_url,
            &headers,
            "Segment",
        )
        .await;
        release_inflight(&inflight_key);
        let bytes = match fetched {
            Ok(bytes) => bytes,
            Err(msg) => {
                if should_retry_fetch_error(&msg) {
                    if let Some(ref key) = stream_key {
                        schedule_manifest_prefetch(key.clone());
                    }
                    let rescued = if relay_sequence_mode {
                        sequence_cache_key.as_ref().and_then(|k| {
                            get_segment_cache_bytes(k, Some(SEGMENT_CACHE_FRESH_HIT_MS))
                        })
                    } else {
                        get_segment_cache_bytes(&source_cache_key, Some(SEGMENT_CACHE_FRESH_HIT_MS))
                    };
                    if let Some(bytes) = rescued {
                        if relay_sequence_mode {
                            update_live_metrics_on_relay_seq_cache_hit();
                        }
                        update_live_metrics_on_cache_hit(bytes.len());
                        return Ok(base64::Engine::encode(
                            &base64::engine::general_purpose::STANDARD,
                            bytes.as_slice(),
                        ));
                    }
                }
                update_live_metrics_on_error(msg.clone());
                return Err(msg);
            }
        };
        if let Some(anomaly) = detect_segment_payload_anomaly(bytes.as_slice()) {
            let msg = format!("Segment payload anomaly: {} for {}", anomaly, resolved_url);
            update_live_metrics_on_error(msg.clone());
            return Err(msg);
        }
        put_segment_cache_bytes(source_cache_key.clone(), bytes.clone());
        if let Some(ref key) = normalized_stream_key {
            track_stream_cache_key(key, &source_cache_key);
        }
        if let Some(ref key) = sequence_cache_key {
            put_segment_cache_bytes(key.clone(), bytes.clone());
            if let Some(ref stream_key) = normalized_stream_key {
                track_stream_cache_key(stream_key, key);
            }
        }
        update_live_metrics_on_cache_miss();
        update_live_metrics_on_success(bytes.len(), started.elapsed().as_millis() as u64);
        return Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            bytes.as_slice(),
        ));
    }

    let bytes =
        fetch_segment_bytes_resilient(&client, &rescue_client, &resolved_url, &headers, "Segment")
            .await
            .map_err(|msg| {
                if should_retry_fetch_error(&msg) {
                    if let Some(ref key) = stream_key {
                        schedule_manifest_prefetch(key.clone());
                    }
                }
                update_live_metrics_on_error(msg.clone());
                msg
            })?;
    if let Some(anomaly) = detect_segment_payload_anomaly(bytes.as_slice()) {
        let msg = format!("Segment payload anomaly: {} for {}", anomaly, resolved_url);
        update_live_metrics_on_error(msg.clone());
        return Err(msg);
    }
    put_segment_cache_bytes(source_cache_key.clone(), bytes.clone());
    if let Some(ref key) = normalized_stream_key {
        track_stream_cache_key(key, &source_cache_key);
    }
    if let Some(key) = sequence_cache_key {
        put_segment_cache_bytes(key.clone(), bytes.clone());
        if let Some(ref stream_key) = normalized_stream_key {
            track_stream_cache_key(stream_key, &key);
        }
    }
    update_live_metrics_on_cache_miss();
    update_live_metrics_on_success(bytes.len(), started.elapsed().as_millis() as u64);
    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes.as_slice(),
    ))
}
#[cfg(test)]
#[path = "media_cmds_hls_tests.rs"]
mod tests;
