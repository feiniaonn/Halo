use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;
use url::Url;

use super::super::{apply_request_headers, resolve_media_request};
use super::{
    apply_hls_like_headers, build_rescue_client, build_rescue_transport_client,
    build_transport_client, filter_media_manifest_content, matches_host_pattern, retry_backoff_ms,
    should_retry_fetch_error, update_live_metrics_on_manifest_status, update_live_metrics_on_retry,
    TvBoxPlaybackRuleInput, MANIFEST_FETCH_MAX_ATTEMPTS,
};

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
            rewritten.push_str(raw_line);
        } else if let Ok(abs) = base_url.join(trimmed) {
            rewritten.push_str(abs.as_str());
        } else {
            rewritten.push_str(raw_line);
        }
        rewritten.push('\n');
    }
    rewritten
}

fn should_apply_playback_rule(rule: &TvBoxPlaybackRuleInput, source_url: &str) -> bool {
    !rule.hosts.is_empty()
        && rule
            .hosts
            .iter()
            .any(|pattern| matches_host_pattern(pattern, source_url))
}

fn apply_manifest_regex_rules(
    manifest: &str,
    source_url: &str,
    playback_rules: &[TvBoxPlaybackRuleInput],
) -> String {
    let mut next = manifest.to_string();
    for rule in playback_rules {
        if !should_apply_playback_rule(rule, source_url) {
            continue;
        }
        for pattern in &rule.regex {
            let expression = pattern.trim();
            if expression.is_empty() {
                continue;
            }
            if let Ok(regex) = regex::Regex::new(expression) {
                next = regex.replace_all(&next, "").into_owned();
            }
        }
    }
    next
}

async fn fetch_manifest_text_once(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    force_close: bool,
    force_identity_encoding: bool,
    add_range: bool,
) -> Result<(Url, String), String> {
    let resolved = resolve_media_request(url, headers.clone());
    let request_client = if force_close
        || force_identity_encoding
        || add_range
        || resolved.matched_proxy_rule.is_some()
    {
        build_rescue_transport_client(&resolved, true, Duration::from_secs(15))?
    } else {
        build_transport_client(&resolved, true, Duration::from_secs(15))
            .unwrap_or_else(|_| client.clone())
    };
    let mut builder = apply_hls_like_headers(
        request_client.get(&resolved.url),
        &resolved.url,
        force_close,
        force_identity_encoding,
    );
    if add_range {
        builder = builder.header("Range", "bytes=0-");
    }
    builder = apply_request_headers(builder, &resolved.headers);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Manifest request failed for {}: {}", resolved.url, e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        update_live_metrics_on_manifest_status(status);
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(240).collect();
        return Err(format!(
            "Manifest fetch failed: {} for {}, body: {}",
            status, resolved.url, snippet
        ));
    }

    let final_url = resp.url().clone();
    let content = resp
        .text()
        .await
        .map_err(|e| format!("Manifest read failed for {}: {}", url, e))?;
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
        let force_close = use_rescue;
        let force_identity = use_rescue;
        let add_range = use_rescue;
        match fetch_manifest_text_once(client, url, headers, force_close, force_identity, add_range)
            .await
        {
            Ok(v) => {
                if attempt > 0 {
                    update_live_metrics_on_retry(&format!(
                        "manifest recovered after retry attempt {}",
                        attempt + 1
                    ));
                }
                return Ok(v);
            }
            Err(err) => {
                last_err = err.clone();
                if attempt + 1 >= MANIFEST_FETCH_MAX_ATTEMPTS || !should_retry_fetch_error(&err) {
                    break;
                }
                update_live_metrics_on_retry(&format!("manifest retry {}: {}", attempt + 1, err));
                tokio::time::sleep(Duration::from_millis(retry_backoff_ms(attempt))).await;
            }
        }
    }
    Err(last_err)
}

pub(super) async fn fetch_and_rewrite_manifest(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    playback_rules: Option<&[TvBoxPlaybackRuleInput]>,
    blocked_hosts: Option<&[String]>,
) -> Result<String, String> {
    let mut current_url = url.trim().to_string();
    let rescue_client = build_rescue_client()?;

    for _ in 0..4 {
        let (final_url, content) =
            fetch_manifest_text_with_retry(client, &rescue_client, &current_url, headers).await?;
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");

        if !normalized.trim_start().starts_with("#EXTM3U") {
            return Err(format!("Manifest response is not M3U8 for {}", current_url));
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
        let regex_applied = apply_manifest_regex_rules(
            &rewritten,
            final_url.as_str(),
            playback_rules.unwrap_or(&[]),
        );
        let filtered = filter_media_manifest_content(&regex_applied, blocked_hosts.unwrap_or(&[]));
        return Ok(filtered);
    }

    Err(format!(
        "Manifest redirect/variant recursion exceeded for {}",
        url
    ))
}

pub async fn fetch_hls_manifest_rewritten(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    playback_rules: Option<&[TvBoxPlaybackRuleInput]>,
    blocked_hosts: Option<&[String]>,
) -> Result<String, String> {
    fetch_and_rewrite_manifest(client, url, headers, playback_rules, blocked_hosts).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_applies_regex_rules_for_matching_hosts() {
        let manifest = "#EXTM3U\n#EXTINF:5,\nhttps://cdn.example.com/seg.ts?ad=1\n";
        let rules = vec![TvBoxPlaybackRuleInput {
            name: "strip-ad".to_string(),
            hosts: vec!["example.com".to_string()],
            regex: vec![r"\?ad=\d+".to_string()],
            script: Vec::new(),
        }];

        let next =
            apply_manifest_regex_rules(manifest, "https://cdn.example.com/live.m3u8", &rules);
        assert!(next.contains("https://cdn.example.com/seg.ts"));
        assert!(!next.contains("?ad=1"));
    }

    #[test]
    fn rewrite_filters_blocked_segment_hosts() {
        let base = Url::parse("https://media.example.com/live/index.m3u8").expect("base url");
        let manifest = "#EXTM3U\n#EXTINF:5,\nseg-1.ts\n#EXTINF:5,\nhttps://ads.example.net/ad.ts\n";
        let rewritten = rewrite_manifest_content(manifest, &base);
        let filtered = filter_media_manifest_content(&rewritten, &["ads.example.net".to_string()]);

        assert!(filtered.contains("https://media.example.com/live/seg-1.ts"));
        assert!(!filtered.contains("https://ads.example.net/ad.ts"));
    }
}
