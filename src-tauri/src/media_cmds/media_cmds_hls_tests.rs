use super::*;
use std::sync::{LazyLock, Mutex};

static TEST_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn reset_test_globals() {
    if let Ok(mut metrics) = LIVE_PROXY_METRICS.lock() {
        *metrics = LiveProxyMetrics {
            build_profile_tag: LIVE_BUILD_PROFILE_TAG.to_string(),
            ..LiveProxyMetrics::default()
        };
    }
    if let Ok(mut states) = HLS_STREAM_STATES.lock() {
        states.clear();
    }
    if let Ok(mut running) = HLS_PREFETCH_RUNNING.lock() {
        running.clear();
    }
    if let Ok(mut stream_cache_keys) = STREAM_CACHE_KEYS.lock() {
        stream_cache_keys.clear();
    }
    if let Ok(mut cache) = HLS_SEGMENT_CACHE.lock() {
        cache.clear();
    }
}

#[test]
fn relay_manifest_sliding_window_and_url_rewrite() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    let mut upstream = String::from(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:100\n",
    );
    let total_segments = RELAY_WINDOW_SEGMENTS + 44;
    for i in 0..total_segments {
        upstream.push_str("#EXTINF:6.000,\n");
        upstream.push_str(&format!("https://example.com/live/{i}.ts\n"));
    }

    let info = parse_media_playlist_info(&upstream);
    let expected_start_idx = compute_window_start_idx(
        &info.segments,
        LIVE_WINDOW_TARGET_SECONDS,
        RELAY_WINDOW_SEGMENTS,
    );
    let relay = build_relay_manifest(&upstream);
    let segment_lines: Vec<&str> = relay
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();

    assert_eq!(
        segment_lines.len(),
        info.segments.len().saturating_sub(expected_start_idx)
    );
    assert!(segment_lines
        .iter()
        .all(|u| u.starts_with("halo-relay://segment/")));
    assert!(relay.contains(&format!(
        "#EXT-X-MEDIA-SEQUENCE:{}",
        info.media_sequence
            .saturating_add(expected_start_idx as u64)
    )));
}

#[test]
fn relay_manifest_keeps_effective_key_for_window_head() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    let mut upstream = String::from(
        "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:1\n",
    );
    upstream.push_str("#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.example.com/key.key\"\n");
    for i in 0..26 {
        upstream.push_str("#EXTINF:6.000,\n");
        upstream.push_str(&format!("https://example.com/live/{i}.ts\n"));
    }

    let relay = build_relay_manifest(&upstream);
    assert!(relay.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"https://cdn.example.com/key.key\""));
}

#[test]
fn relay_segment_url_roundtrip() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    let src = "https://example.com/path/seg-1.ts?token=abc123";
    let relay = encode_relay_segment_url(src, 321);
    let decoded = decode_relay_segment_url(&relay).expect("decode relay url");
    assert_eq!(decoded.source_url, src);
    assert_eq!(decoded.sequence, Some(321));
}

#[test]
fn metrics_include_profile_and_cache_hit_ratio() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    update_live_metrics_on_cache_hit(1024);
    update_live_metrics_on_cache_miss();
    let metrics = get_live_proxy_metrics();
    assert_eq!(metrics.build_profile_tag, LIVE_BUILD_PROFILE_TAG);
    assert_eq!(metrics.cache_hits, 1);
    assert_eq!(metrics.cache_misses, 1);
    assert!((metrics.cache_hit_ratio - 0.5).abs() < 0.0001);
}

#[test]
fn classifies_retryable_transport_errors() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    assert!(should_retry_fetch_error(
        "Segment: read failed for http://x: error decoding response body"
    ));
    assert!(should_retry_fetch_error(
        "Segment: request failed for http://x: operation timed out"
    ));
    assert!(!should_retry_fetch_error(
        "Segment: bad status 404 Not Found for http://x"
    ));
}

#[test]
fn release_stream_clears_state_and_worker_mark() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    upsert_stream_state(
        "test-stream",
        Some("https://example.com/live.m3u8".to_string()),
        None,
        None,
        None,
        None,
    );
    if let Ok(mut running) = HLS_PREFETCH_RUNNING.lock() {
        running.insert("test-stream".to_string(), now_ms());
    }
    release_live_stream("test-stream".to_string());
    assert!(get_stream_state("test-stream").is_none());
    let still_running = HLS_PREFETCH_RUNNING
        .lock()
        .ok()
        .map(|r| r.contains_key("test-stream"))
        .unwrap_or(false);
    assert!(!still_running);
}

#[test]
fn release_stream_keeps_tracked_segment_cache_keys_for_warm_restart() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    let stream_key = "stream-a";
    let cache_key = "https://example.com/seg.ts@@";
    put_segment_cache_bytes(cache_key.to_string(), vec![1, 2, 3]);
    track_stream_cache_key(stream_key, cache_key);
    assert!(get_segment_cache_bytes(cache_key, None).is_some());
    release_live_stream(stream_key.to_string());
    assert!(get_segment_cache_bytes(cache_key, None).is_some());
}

#[test]
fn metrics_include_new_live_observability_fields() {
    let _guard = TEST_MUTEX.lock().expect("lock test mutex");
    reset_test_globals();
    update_live_metrics_on_prefetch_backoff();
    update_live_metrics_on_relay_seq_cache_hit();
    update_live_metrics_on_relay_source_fallback_hit();
    note_live_buffer_anomaly();
    let metrics = get_live_proxy_metrics();
    assert!(metrics.prefetch_backoff_count >= 1);
    assert!(metrics.relay_seq_cache_hits >= 1);
    assert!(metrics.relay_source_fallback_hits >= 1);
    assert!(metrics.buffer_anomaly_count >= 1);
}
