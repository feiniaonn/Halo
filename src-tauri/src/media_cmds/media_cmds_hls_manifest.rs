use base64::Engine;
use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;
use url::Url;

use super::super::{execute_media_transport_request, MediaTransportOptions, MediaTransportRequest};
use super::{
    build_rescue_client, filter_media_manifest_content, matches_host_pattern, retry_backoff_ms,
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

fn looks_like_html_wrapper_line(line: &str) -> bool {
    let lower = line.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return false;
    }
    lower.starts_with("<!doctype html")
        || lower.starts_with("<html")
        || lower.starts_with("</html")
        || lower.starts_with("<body")
        || lower.starts_with("</body")
        || lower.starts_with("<head")
        || lower.starts_with("</head")
        || lower.starts_with("<pre")
        || lower.starts_with("</pre")
        || lower.starts_with("<script")
        || lower.starts_with("</script")
        || lower.starts_with("<div")
        || lower.starts_with("</div")
}

fn extract_manifest_payload(content: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if let Some(index) = normalized.find("#EXTM3U") {
        normalized[index..].to_string()
    } else {
        normalized
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
        if looks_like_html_wrapper_line(trimmed) {
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
    _client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
    _force_close: bool,
    _force_identity_encoding: bool,
    _add_range: bool,
) -> Result<(Url, String), String> {
    let response = execute_media_transport_request(MediaTransportRequest {
        url: url.to_string(),
        options: MediaTransportOptions {
            timeout: Some(Duration::from_secs(15).as_millis() as u64),
            headers: headers
                .as_ref()
                .and_then(|value| serde_json::to_value(value).ok()),
            ..Default::default()
        },
        request_id: Some("hls-manifest".to_string()),
        source: Some("hls-manifest".to_string()),
    })
    .await?;

    if !response.ok {
        let status = reqwest::StatusCode::from_u16(response.status)
            .unwrap_or(reqwest::StatusCode::BAD_GATEWAY);
        update_live_metrics_on_manifest_status(status);
        let body = base64::engine::general_purpose::STANDARD
            .decode(response.body_base64.as_bytes())
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default();
        let snippet: String = body.chars().take(240).collect();
        return Err(format!(
            "Manifest fetch failed: {} for {}, body: {}",
            response.status, response.url, snippet
        ));
    }

    let final_url =
        Url::parse(&response.url).map_err(|e| format!("Manifest final url parse failed: {e}"))?;
    let body = base64::engine::general_purpose::STANDARD
        .decode(response.body_base64.as_bytes())
        .map_err(|e| format!("Manifest decode failed for {}: {}", response.url, e))?;
    let content = String::from_utf8_lossy(&body).to_string();
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
        let normalized = extract_manifest_payload(&content);

        if !normalized.trim_start().starts_with("#EXTM3U") {
            let preview = normalized.lines().take(8).collect::<Vec<_>>().join("\n");
            return Err(format!(
                "Manifest response is not M3U8 for {}: {}",
                current_url, preview
            ));
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

    #[test]
    fn extract_manifest_payload_skips_wrapper_prefix() {
        let wrapped = "<pre>\n#EXTM3U\n#EXTINF:5,\nseg-1.ts\n</pre>";
        let normalized = extract_manifest_payload(wrapped);
        assert!(normalized.starts_with("#EXTM3U"));
    }

    #[test]
    fn rewrite_manifest_drops_html_wrapper_lines() {
        let base = Url::parse("https://media.example.com/live/index.m3u8").expect("base url");
        let manifest = "#EXTM3U\n#EXTINF:5,\nseg-1.ts\n</pre>\n</html>\n";
        let rewritten = rewrite_manifest_content(manifest, &base);
        assert!(rewritten.contains("https://media.example.com/live/seg-1.ts"));
        assert!(!rewritten.contains("</pre>"));
        assert!(!rewritten.contains("</html>"));
    }
}
