use regex::Regex;
use reqwest::Client;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::LazyLock;
use url::Url;

use super::{apply_request_headers, build_client, build_rescue_client, resolve_media_request};

const TVBOX_RESOLVE_MAX_DEPTH: usize = 2;
const TVBOX_RESOLVE_MAX_FETCHES: usize = 24;
const TVBOX_RESOLVE_MAX_CANDIDATES_PER_PAGE: usize = 16;

fn decode_text_bytes(bytes: &[u8]) -> String {
    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }
    let (gbk, _encoding, has_errors) = encoding_rs::GBK.decode(bytes);
    if !has_errors {
        return gbk.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn is_tvbox_value(value: &serde_json::Value, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    match value {
        serde_json::Value::Object(map) => {
            if map.get("sites").is_some_and(serde_json::Value::is_array) {
                return true;
            }
            if map.get("urls").is_some_and(serde_json::Value::is_array) {
                return true;
            }
            if let Some(result) = map.get("result") {
                if is_tvbox_value(result, depth + 1) {
                    return true;
                }
            }
            if let Some(data) = map.get("data") {
                if is_tvbox_value(data, depth + 1) {
                    return true;
                }
            }
            false
        }
        serde_json::Value::Array(items) => items
            .iter()
            .take(4)
            .any(|item| is_tvbox_value(item, depth + 1)),
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
                return false;
            }
            match serde_json::from_str::<serde_json::Value>(trimmed) {
                Ok(inner) => is_tvbox_value(&inner, depth + 1),
                Err(_) => false,
            }
        }
        _ => false,
    }
}

fn strip_leading_json_noise(text: &str) -> &str {
    let mut current = text.trim_start_matches('\u{feff}');
    loop {
        let trimmed = current.trim_start();
        if trimmed.is_empty() {
            return trimmed;
        }

        let mut chars = trimmed.chars();
        let first = chars.next().unwrap_or_default();
        let second = chars.next().unwrap_or_default();
        let is_comment_line = (first == '/' && second == '/') || first == '#' || first == ';';
        if !is_comment_line {
            return trimmed;
        }

        if let Some(pos) = trimmed.find('\n') {
            current = &trimmed[(pos + 1)..];
        } else {
            return "";
        }
    }
}

fn parse_tvbox_json_loose(text: &str) -> Option<serde_json::Value> {
    let trimmed = strip_leading_json_noise(text).trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Some(value);
    }

    let first_obj = trimmed.find('{');
    let first_arr = trimmed.find('[');
    let start = match (first_obj, first_arr) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return None,
    };

    let last_obj = trimmed.rfind('}');
    let last_arr = trimmed.rfind(']');
    let end = match (last_obj, last_arr) {
        (Some(a), Some(b)) => a.max(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return None,
    };
    if end <= start {
        return None;
    }

    let sliced = &trimmed[start..=end];
    serde_json::from_str::<serde_json::Value>(sliced).ok()
}

fn extract_tvbox_config_json(text: &str) -> Option<String> {
    let value = parse_tvbox_json_loose(text)?;
    if !is_tvbox_value(&value, 0) {
        return None;
    }
    serde_json::to_string(&value).ok()
}

#[cfg_attr(not(test), allow(dead_code))]
fn is_tvbox_config_text(text: &str) -> bool {
    extract_tvbox_config_json(text).is_some()
}

fn looks_like_html_document(text: &str) -> bool {
    let head: String = text.chars().take(2048).collect();
    let lower = head.to_ascii_lowercase();
    lower.contains("<!doctype html")
        || lower.contains("<html")
        || lower.contains("<head")
        || lower.contains("<body")
}

fn html_attr_url_regex() -> &'static Regex {
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\b(?:href|src)\s*=\s*["']([^"']+)["']"#)
            .expect("valid html attr url regex")
    });
    &RE
}

fn html_plain_url_regex() -> &'static Regex {
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"https?://[^\s"'<>`\\]+"#).expect("valid html plain url regex")
    });
    &RE
}

fn decode_html_entities_basic(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#39;", "'")
        .replace("\\u0026", "&")
        .replace("\\/", "/")
}

fn is_static_asset_candidate(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    [
        ".css", ".js", ".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".woff",
        ".woff2", ".ttf", ".otf", ".mp4", ".mp3", ".m4a", ".webm",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext) || lower.contains(&format!("{ext}?")))
}

fn normalize_html_candidate_url(raw: &str, base_url: &Url) -> Option<String> {
    let mut cleaned = decode_html_entities_basic(raw.trim());
    if cleaned.is_empty() {
        return None;
    }
    while cleaned
        .chars()
        .last()
        .is_some_and(|c| matches!(c, '"' | '\'' | '`' | ')' | ']' | '}' | ',' | ';'))
    {
        cleaned.pop();
    }
    let lower = cleaned.to_ascii_lowercase();
    if lower.starts_with("javascript:")
        || lower.starts_with("mailto:")
        || lower.starts_with('#')
        || lower.starts_with("data:")
    {
        return None;
    }

    let candidate = if cleaned.starts_with("http://") || cleaned.starts_with("https://") {
        cleaned
    } else if cleaned.starts_with("//") {
        format!("{}:{}", base_url.scheme(), cleaned)
    } else {
        match base_url.join(cleaned.as_str()) {
            Ok(abs) => abs.to_string(),
            Err(_) => return None,
        }
    };

    let mut parsed = Url::parse(&candidate).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    parsed.set_fragment(None);
    let normalized = parsed.to_string();
    if is_static_asset_candidate(&normalized) {
        return None;
    }
    Some(normalized)
}

fn is_tvbox_candidate_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if lower.contains("raw/?url=") {
        if let Ok(parsed) = Url::parse(url) {
            let value = parsed
                .query_pairs()
                .find(|(k, _)| k.eq_ignore_ascii_case("url"))
                .map(|(_, v)| v.to_string())
                .unwrap_or_default();
            if value.trim().is_empty()
                || (!value.contains("://") && !value.to_ascii_lowercase().contains("%3a%2f%2f"))
            {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

fn candidate_is_reasonable_for_probe(url: &str, root_host: Option<&str>) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }

    let same_host = root_host
        .map(|root| host == root || host.ends_with(&format!(".{root}")))
        .unwrap_or(false);
    if same_host {
        return true;
    }

    let blocked_hosts = [
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        "github.com",
        "mp.weixin.qq.com",
        "jq.qq.com",
        "p.qlogo.cn",
        "adzhp.net",
        "simpleicons.org",
        "i.imgtg.com",
        "s1.imagehub.cc",
    ];
    if blocked_hosts
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
    {
        return false;
    }

    let lower = url.to_ascii_lowercase();
    lower.contains("raw/?url=")
        || lower.contains("raw.githubusercontent.com/")
        || lower.ends_with(".json")
        || lower.contains(".json?")
        || lower.contains("/tv")
        || lower.contains("tvbox")
}

fn deproxy_candidate_url(url: &str) -> Option<String> {
    let prefixes = [
        "https://ghproxy.net/",
        "http://ghproxy.net/",
        "https://ghproxy.com/",
        "http://ghproxy.com/",
    ];
    for prefix in prefixes {
        if let Some(rest) = url.strip_prefix(prefix) {
            if rest.starts_with("http://") || rest.starts_with("https://") {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn github_blob_to_raw_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    if parsed.host_str()?.to_ascii_lowercase() != "github.com" {
        return None;
    }
    let mut parts = parsed.path_segments()?.collect::<Vec<_>>();
    if parts.len() < 5 || parts[2] != "blob" {
        return None;
    }
    let owner = parts.remove(0);
    let repo = parts.remove(0);
    let _blob = parts.remove(0);
    let branch = parts.remove(0);
    let tail = parts.join("/");
    if tail.is_empty() {
        return None;
    }
    Some(format!(
        "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{tail}"
    ))
}

fn build_seed_candidates_for_root(root_url: &str) -> Vec<String> {
    let Ok(base) = Url::parse(root_url) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for path in ["/tv", "/tv/", "/config.json", "/index.json"] {
        if let Ok(u) = base.join(path) {
            out.push(u.to_string());
        }
    }
    out
}

fn tvbox_candidate_score(url: &str, root_host: Option<&str>) -> i32 {
    let lower = url.to_ascii_lowercase();
    let mut score = 0;
    if let (Some(root), Ok(parsed)) = (root_host, Url::parse(url)) {
        if let Some(host) = parsed.host_str() {
            let host_lower = host.to_ascii_lowercase();
            if host_lower == root || host_lower.ends_with(&format!(".{root}")) {
                score += 90;
            }
        }
    }
    if lower.ends_with(".json") || lower.contains(".json?") {
        score += 70;
    }
    if lower.contains("raw.githubusercontent.com/") {
        score += 35;
    }
    if lower.contains("raw/?url=") {
        score += 55;
    }
    if lower.contains("ghproxy.net/") || lower.contains("ghproxy.com/") {
        score -= 20;
    }
    if lower.contains("/tv") {
        score += 40;
    }
    if lower.contains("tvbox") {
        score += 30;
    }
    if lower.contains("config") || lower.contains("sites") || lower.contains("urls") {
        score += 24;
    }
    if lower.contains("api") || lower.contains("vod") {
        score += 15;
    }
    if lower.contains(".m3u8") || lower.ends_with(".m3u") {
        score -= 20;
    }
    if lower.ends_with('/') {
        score -= 4;
    }
    score
}

fn extract_html_candidate_urls(html: &str, page_url: &str) -> Vec<String> {
    let Ok(base) = Url::parse(page_url) else {
        return Vec::new();
    };
    let root_host = base.host_str().map(|s| s.to_ascii_lowercase());
    let mut out = build_seed_candidates_for_root(page_url);
    let mut unique: HashSet<String> = out.iter().cloned().collect();

    let mut push_candidate = |candidate: String| {
        if !is_tvbox_candidate_url(&candidate) {
            return;
        }
        if !candidate_is_reasonable_for_probe(&candidate, root_host.as_deref()) {
            return;
        }
        if unique.insert(candidate.clone()) {
            out.push(candidate);
        }
    };

    for caps in html_attr_url_regex().captures_iter(html) {
        if let Some(raw) = caps.get(1).map(|m| m.as_str()) {
            if let Some(candidate) = normalize_html_candidate_url(raw, &base) {
                push_candidate(candidate.clone());
                if let Some(mapped) = deproxy_candidate_url(&candidate) {
                    push_candidate(mapped);
                }
                if let Some(mapped) = github_blob_to_raw_url(&candidate) {
                    push_candidate(mapped);
                }
            }
        }
    }

    for mat in html_plain_url_regex().find_iter(html) {
        if let Some(candidate) = normalize_html_candidate_url(mat.as_str(), &base) {
            push_candidate(candidate.clone());
            if let Some(mapped) = deproxy_candidate_url(&candidate) {
                push_candidate(mapped);
            }
            if let Some(mapped) = github_blob_to_raw_url(&candidate) {
                push_candidate(mapped);
            }
        }
    }

    out.sort_by(|a, b| {
        tvbox_candidate_score(b, root_host.as_deref())
            .cmp(&tvbox_candidate_score(a, root_host.as_deref()))
            .then_with(|| a.cmp(b))
    });
    if out.len() > TVBOX_RESOLVE_MAX_CANDIDATES_PER_PAGE {
        out.truncate(TVBOX_RESOLVE_MAX_CANDIDATES_PER_PAGE);
    }
    out
}

fn try_decode_tvbox_base64_payload(text: &str) -> Option<String> {
    fn decode_candidate_base64(compact: &str) -> Option<String> {
        if compact.len() < 80
            || compact.starts_with('{')
            || compact.starts_with('[')
            || !compact
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=' | '-' | '_'))
        {
            return None;
        }

        let mut variants = vec![compact.to_string()];
        if !compact.ends_with('=') {
            let padding = (4 - (compact.len() % 4)) % 4;
            if padding > 0 {
                variants.push(format!("{compact}{}", "=".repeat(padding)));
            }
        }

        let engines = [
            &base64::engine::general_purpose::STANDARD,
            &base64::engine::general_purpose::URL_SAFE,
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        ];
        for variant in variants {
            for engine in engines {
                if let Ok(bytes) = base64::Engine::decode(engine, variant.as_bytes()) {
                    let decoded = decode_text_bytes(&bytes);
                    if let Some(normalized) = extract_tvbox_config_json(&decoded) {
                        return Some(normalized);
                    }
                }
            }
        }

        None
    }

    let compact: String = text.trim().chars().filter(|c| !c.is_whitespace()).collect();
    if let Some(decoded) = decode_candidate_base64(&compact) {
        return Some(decoded);
    }

    let mut segments = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '=' | '-' | '_') {
            current.push(ch);
            continue;
        }
        if current.len() >= 80 {
            segments.push(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }
    if current.len() >= 80 {
        segments.push(current);
    }
    segments.sort_by_key(|segment| std::cmp::Reverse(segment.len()));

    for segment in segments {
        if let Some(decoded) = decode_candidate_base64(&segment) {
            return Some(decoded);
        }
    }

    None
}

async fn fetch_remote_text(client: &Client, raw_url: &str) -> Result<String, String> {
    let request_url = match Url::parse(raw_url.trim()) {
        Ok(parsed) => parsed.to_string(),
        Err(_) => raw_url.trim().to_string(),
    };
    let resolved = resolve_media_request(&request_url, None);
    let resp = apply_request_headers(client.get(&resolved.url), &resolved.headers)
        .send()
        .await
        .map_err(|e| format!("request failed for {}: {e}", resolved.url))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), resolved.url));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read failed for {}: {e}", resolved.url))?;
    Ok(decode_text_bytes(bytes.as_ref()))
}

fn build_cms_api_url(api_url: &str, params: &[(&str, &str)]) -> String {
    if let Ok(mut parsed) = Url::parse(api_url) {
        let mut existing = parsed
            .query_pairs()
            .into_owned()
            .filter(|(key, _)| !matches!(key.as_str(), "ac" | "wd" | "ids" | "t" | "pg"))
            .collect::<Vec<_>>();
        for (key, value) in params {
            existing.push(((*key).to_string(), (*value).to_string()));
        }
        parsed.query_pairs_mut().clear().extend_pairs(existing);
        return parsed.to_string();
    }

    let joiner = if api_url.contains('?') { '&' } else { '?' };
    let extra = params
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    format!("{api_url}{joiner}{extra}")
}

fn contains_non_empty_detail_list(text: &str) -> bool {
    let Ok(mut data) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };

    if data.get("result").is_some() && (data.get("ok").is_some() || data.get("className").is_some())
    {
        data = data
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
    }

    if let Some(as_text) = data.as_str() {
        let trimmed = as_text.trim();
        if trimmed.is_empty() {
            return false;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            return false;
        };
        data = parsed;
    }

    data.get("list")
        .and_then(|value| value.as_array())
        .is_some_and(|list| !list.is_empty())
}

/// Known Chinese TVBox config decrypt-proxy endpoint prefixes.
/// These services accept a raw config URL and return the decrypted/resolved JSON
/// (often prepended with `// >>>` comment headers that `strip_leading_json_noise` handles).
const TVBOX_DECRYPT_PROXY_PREFIXES: &[&str] = &[
    "https://www.qiushui.vip/raw/?url=",
    "https://agit.ai/raw/?url=",
];

async fn try_tvbox_decrypt_proxies(client: &Client, source_url: &str) -> Option<String> {
    let encoded_url: String = url::form_urlencoded::byte_serialize(source_url.as_bytes()).collect();
    for prefix in TVBOX_DECRYPT_PROXY_PREFIXES {
        let proxy_url = format!("{}{}", prefix, encoded_url);
        println!("[tvbox][proxy] trying decrypt proxy: {}", proxy_url);
        match fetch_remote_text(client, &proxy_url).await {
            Ok(text) => {
                if let Some(normalized) = extract_tvbox_config_json(&text) {
                    println!("[tvbox][proxy] hit tvbox json via proxy: {}", prefix);
                    return Some(normalized);
                }
                if let Some(decoded) = try_decode_tvbox_base64_payload(&text) {
                    println!(
                        "[tvbox][proxy] hit decoded tvbox payload via proxy: {}",
                        prefix
                    );
                    return Some(decoded);
                }
                println!(
                    "[tvbox][proxy] proxy returned non-tvbox content (prefix={})",
                    prefix
                );
            }
            Err(e) => {
                println!("[tvbox][proxy] proxy failed prefix={} err={}", prefix, e);
            }
        }
    }
    None
}

async fn resolve_tvbox_config_from_html(
    client: &Client,
    root_url: &str,
    root_html: &str,
) -> Option<String> {
    let mut visited = HashSet::new();
    visited.insert(root_url.to_string());
    let mut queue: VecDeque<(String, usize)> = extract_html_candidate_urls(root_html, root_url)
        .into_iter()
        .map(|u| (u, 1usize))
        .collect();

    if queue.is_empty() {
        println!(
            "[tvbox][resolver] html detected but no candidate links: {}",
            root_url
        );
    }

    while let Some((candidate, depth)) = queue.pop_front() {
        if visited.len() >= TVBOX_RESOLVE_MAX_FETCHES {
            println!(
                "[tvbox][resolver] stop: fetch budget reached ({})",
                TVBOX_RESOLVE_MAX_FETCHES
            );
            break;
        }
        if !visited.insert(candidate.clone()) {
            continue;
        }

        println!("[tvbox][resolver] probe depth={} url={}", depth, candidate);
        let text = match fetch_remote_text(client, &candidate).await {
            Ok(v) => v,
            Err(err) => {
                println!(
                    "[tvbox][resolver] probe failed depth={} url={} err={}",
                    depth, candidate, err
                );
                continue;
            }
        };

        if let Some(normalized) = extract_tvbox_config_json(&text) {
            println!(
                "[tvbox][resolver] hit tvbox json depth={} url={}",
                depth, candidate
            );
            return Some(normalized);
        }

        if let Some(decoded) = try_decode_tvbox_base64_payload(&text) {
            println!(
                "[tvbox][resolver] hit decoded tvbox payload depth={} url={}",
                depth, candidate
            );
            return Some(decoded);
        }

        if depth < TVBOX_RESOLVE_MAX_DEPTH && looks_like_html_document(&text) {
            let nested = extract_html_candidate_urls(&text, &candidate);
            if !nested.is_empty() {
                println!(
                    "[tvbox][resolver] expand depth={} url={} candidates={}",
                    depth + 1,
                    candidate,
                    nested.len()
                );
            }
            for next in nested {
                if !visited.contains(&next) {
                    queue.push_back((next, depth + 1));
                }
            }
        }
    }

    None
}

async fn resolve_tvbox_config_from_known_candidates(
    client: &Client,
    source: &str,
    candidates: &[&str],
) -> Option<String> {
    for candidate in candidates {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            continue;
        }

        println!(
            "[tvbox][resolver] try known remote candidate for {} -> {}",
            source, trimmed
        );

        let text = match fetch_remote_text(client, trimmed).await {
            Ok(value) => value,
            Err(err) => {
                println!(
                    "[tvbox][resolver] known candidate failed for {} -> {} ({})",
                    source, trimmed, err
                );
                continue;
            }
        };

        if let Some(normalized) = extract_tvbox_config_json(&text) {
            println!(
                "[tvbox][resolver] known candidate produced tvbox json for {} -> {}",
                source, trimmed
            );
            return Some(normalized);
        }

        if let Some(decoded) = try_decode_tvbox_base64_payload(&text) {
            println!(
                "[tvbox][resolver] known candidate produced base64 tvbox payload for {} -> {}",
                source, trimmed
            );
            return Some(decoded);
        }

        if looks_like_html_document(&text) {
            if let Some(resolved) = resolve_tvbox_config_from_html(client, trimmed, &text).await {
                println!(
                    "[tvbox][resolver] known candidate resolved nested html tvbox config for {} -> {}",
                    source, trimmed
                );
                return Some(resolved);
            }
        }
    }

    None
}

pub async fn fetch_tvbox_config(url: String) -> Result<String, String> {
    let raw_source = url.trim().to_string();
    if raw_source.is_empty() {
        return Err("source url is empty".to_string());
    }
    let source = crate::media_cmds::media_cmds_source_fallbacks::resolve_known_source_redirect(
        &raw_source,
    )
    .map(str::to_string)
    .unwrap_or(raw_source.clone());
    if source != raw_source {
        println!(
            "[tvbox][resolver] redirected known source alias: {} -> {}",
            raw_source, source
        );
    }
    println!("[media_cmds] Fetching config from: {}", source);
    let known_source_fallback =
        crate::media_cmds::media_cmds_source_fallbacks::resolve_known_source_fallback(&source)
            .or_else(|| {
                crate::media_cmds::media_cmds_source_fallbacks::resolve_known_source_fallback(
                    &raw_source,
                )
            });
    let known_remote_candidates =
        crate::media_cmds::media_cmds_source_fallbacks::resolve_known_source_candidates(&source);

    if source.starts_with("file://") {
        let mut path = source.trim_start_matches("file:///").to_string();
        #[cfg(target_os = "windows")]
        {
            path = path.replace("/", "\\");
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("read local config failed: {}", e))?;
        println!("[media_cmds] Received {} bytes (local file)", bytes.len());
        let text = decode_text_bytes(&bytes);
        if let Some(decoded) = try_decode_tvbox_base64_payload(&text) {
            println!("[tvbox][resolver] local payload decoded as tvbox json");
            return Ok(decoded);
        }
        return Ok(text);
    }

    let client = build_client()?;
    let text = match fetch_remote_text(&client, &source).await {
        Ok(text) => text,
        Err(err) => {
            if let Some(resolved) =
                resolve_tvbox_config_from_known_candidates(&client, &source, known_remote_candidates)
                    .await
            {
                println!(
                    "[tvbox][resolver] stabilized source via known remote candidate after root fetch failure: {}",
                    source
                );
                return Ok(resolved);
            }
            if let Some(fallback) = known_source_fallback {
                println!(
                    "[tvbox][resolver] root fetch failed, using bundled source fallback: {}",
                    source
                );
                return Ok(fallback.to_string());
            }
            return Err(err);
        }
    };
    println!(
        "[media_cmds] Received {} chars (remote)",
        text.chars().count()
    );

    if let Some(normalized) = extract_tvbox_config_json(&text) {
        return Ok(normalized);
    }

    if let Some(decoded) = try_decode_tvbox_base64_payload(&text) {
        println!("[tvbox][resolver] root payload decoded as tvbox json");
        return Ok(decoded);
    }

    if looks_like_html_document(&text) {
        println!("[tvbox][resolver] html wrapper detected: {}", source);
        if let Some(resolved) =
            resolve_tvbox_config_from_known_candidates(&client, &source, known_remote_candidates).await
        {
            println!(
                "[tvbox][resolver] stabilized source via known remote candidate before html wrapper parse: {}",
                source
            );
            return Ok(resolved);
        }
        if let Some(resolved) = resolve_tvbox_config_from_html(&client, &source, &text).await {
            println!("[tvbox][resolver] resolved tvbox config from html wrapper");
            return Ok(resolved);
        }
        println!("[tvbox][resolver] unresolved html wrapper, trying decrypt proxies");
        if let Some(proxy_result) = try_tvbox_decrypt_proxies(&client, &source).await {
            println!("[tvbox][resolver] resolved tvbox config via decrypt proxy");
            return Ok(proxy_result);
        }
        println!("[tvbox][resolver] all resolution strategies failed, fallback raw body");
    } else {
        // Not HTML, not JSON, not base64 鈥?could be a custom-encrypted payload.
        // Try known decrypt proxies as a last resort.
        println!("[tvbox][resolver] unrecognized payload, trying decrypt proxies");
        if let Some(proxy_result) = try_tvbox_decrypt_proxies(&client, &source).await {
            println!("[tvbox][resolver] resolved unrecognized payload via decrypt proxy");
            return Ok(proxy_result);
        }
    }

    if let Some(resolved) =
        resolve_tvbox_config_from_known_candidates(&client, &source, known_remote_candidates).await
    {
        println!(
            "[tvbox][resolver] stabilized source via known remote candidate after resolution miss: {}",
            source
        );
        return Ok(resolved);
    }

    if let Some(fallback) = known_source_fallback {
        println!(
            "[tvbox][resolver] using bundled source fallback after resolution miss: {}",
            source
        );
        return Ok(fallback.to_string());
    }

    Ok(text)
}

pub async fn fetch_vod_home(api_url: String) -> Result<String, String> {
    let client = build_client()?;
    let url = if api_url.contains("ac=") {
        api_url.clone()
    } else if api_url.contains('?') {
        format!("{}&ac=videolist", api_url)
    } else {
        format!("{}?ac=videolist", api_url)
    };
    let resolved = resolve_media_request(&url, None);
    let resp = apply_request_headers(client.get(&resolved.url), &resolved.headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

pub async fn fetch_vod_category(api_url: String, tid: String, pg: u32) -> Result<String, String> {
    let client = build_client()?;
    // Query parameters for CMS category
    let url = if api_url.contains('?') {
        format!("{}&ac=videolist&t={}&pg={}", api_url, tid, pg)
    } else {
        format!("{}?ac=videolist&t={}&pg={}", api_url, tid, pg)
    };

    let resolved = resolve_media_request(&url, None);
    let resp = apply_request_headers(client.get(&resolved.url), &resolved.headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

pub async fn fetch_vod_search(api_url: String, keyword: String) -> Result<String, String> {
    let client = build_client()?;
    let encoded_keyword: String =
        url::form_urlencoded::byte_serialize(keyword.trim().as_bytes()).collect();
    let url = if api_url.contains("wd=") {
        api_url.clone()
    } else if api_url.contains("ac=") {
        format!("{}&wd={}", api_url, encoded_keyword)
    } else if api_url.contains('?') {
        format!("{}&ac=videolist&wd={}", api_url, encoded_keyword)
    } else {
        format!("{}?ac=videolist&wd={}", api_url, encoded_keyword)
    };

    let resolved = resolve_media_request(&url, None);
    let resp = apply_request_headers(client.get(&resolved.url), &resolved.headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.text().await.map_err(|e| e.to_string())
}

pub async fn fetch_vod_detail(api_url: String, ids: String) -> Result<String, String> {
    let trimmed_api = api_url.trim();
    let trimmed_ids = ids.trim();
    if trimmed_api.is_empty() {
        return Err("api_url is empty".to_string());
    }
    if trimmed_ids.is_empty() {
        return Err("ids is empty".to_string());
    }

    let encoded_ids: String =
        url::form_urlencoded::byte_serialize(trimmed_ids.as_bytes()).collect();
    let client = build_client()?;
    let candidates = [
        build_cms_api_url(
            trimmed_api,
            &[("ac", "detail"), ("ids", encoded_ids.as_str())],
        ),
        build_cms_api_url(
            trimmed_api,
            &[("ac", "videolist"), ("ids", encoded_ids.as_str())],
        ),
    ];

    let mut last_non_empty = None::<String>;
    for url in candidates {
        let resolved = resolve_media_request(&url, None);
        let resp = apply_request_headers(client.get(&resolved.url), &resolved.headers)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() || text.trim().is_empty() {
            continue;
        }
        if contains_non_empty_detail_list(&text) {
            return Ok(text);
        }
        last_non_empty = Some(text);
    }

    if let Some(text) = last_non_empty {
        return Err(format!(
            "detail response invalid: {}",
            text.trim().chars().take(200).collect::<String>()
        ));
    }

    Err("detail response empty".to_string())
}

fn build_image_origin_headers(url: &str) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    headers.insert(
        "Accept-Language".to_string(),
        "zh-CN,zh;q=0.9,en;q=0.8".to_string(),
    );

    if let Ok(parsed) = Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            let origin = format!("{}://{}", parsed.scheme(), host);
            headers.insert("Referer".to_string(), format!("{origin}/"));
            headers.insert("Origin".to_string(), origin);
        }
    }

    let lowered = url.to_ascii_lowercase();
    if lowered.contains("doubanio.com") || lowered.contains("douban.com") {
        headers.insert(
            "Referer".to_string(),
            "https://movie.douban.com/".to_string(),
        );
        headers.insert("Origin".to_string(), "https://movie.douban.com".to_string());
    }
    if lowered.contains("iqiyipic.com")
        || lowered.contains("qiyipic.com")
        || lowered.contains("iqiyi.com")
    {
        headers.insert("Referer".to_string(), "https://www.iqiyi.com/".to_string());
        headers.insert("Origin".to_string(), "https://www.iqiyi.com".to_string());
    }

    headers
}

fn apply_image_request_headers(
    builder: reqwest::RequestBuilder,
    url: &str,
) -> reqwest::RequestBuilder {
    let mut builder = builder
        .header("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

    for (key, value) in build_image_origin_headers(url) {
        builder = builder.header(key, value);
    }

    builder
}

async fn proxy_media_once(
    client: &Client,
    url: &str,
    headers: &Option<HashMap<String, String>>,
) -> Result<String, String> {
    let mut builder = apply_image_request_headers(client.get(url), url);
    builder = apply_request_headers(builder, headers);

    let resp = builder.send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Media fetch failed: {}", resp.status()));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);

    Ok(format!("data:{};base64,{}", content_type, b64))
}

pub async fn proxy_media(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let resolved = resolve_media_request(&url, headers);
    let client = build_client()?;

    match proxy_media_once(&client, &resolved.url, &resolved.headers).await {
        Ok(result) => Ok(result),
        Err(first_err) => {
            let rescue_client = build_rescue_client()?;
            proxy_media_once(&rescue_client, &resolved.url, &resolved.headers)
                .await
                .map_err(|second_err| format!("{first_err}; retry failed: {second_err}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_tvbox_base64_payload_roundtrip() {
        let sample = r#"{"sites":[{"key":"demo","api":"csp_Demo"}],"spider":"http://example.com/spider.jar","logo":"http://example.com/logo.png"}"#;
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, sample);
        let decoded = try_decode_tvbox_base64_payload(&encoded).unwrap_or_default();
        assert!(decoded.contains("\"sites\""));
    }

    #[test]
    fn decode_tvbox_base64_payload_from_mixed_binary_like_prefix() {
        let sample = r#"{"sites":[{"key":"demo","api":"csp_Demo"}],"spider":"http://example.com/spider.jar"}"#;
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, sample);
        let mixed = format!("\u{fffd}\u{fffd}JFIF\u{0000}\u{0001}***{encoded}");
        let decoded = try_decode_tvbox_base64_payload(&mixed).unwrap_or_default();
        assert!(decoded.contains("\"sites\""));
        assert!(decoded.contains("\"csp_Demo\""));
    }

    #[test]
    fn tvbox_config_detection_supports_result_wrapper() {
        let wrapped = r#"{"ok":true,"result":"{\"sites\":[{\"key\":\"a\"}],\"spider\":\"jar\"}"}"#;
        assert!(is_tvbox_config_text(wrapped));
    }

    #[test]
    fn tvbox_config_detection_supports_comment_prefixed_json() {
        let text =
            "// comment line\n// another line\n{\"spider\":\"x\",\"sites\":[{\"key\":\"a\"}]}";
        let normalized = extract_tvbox_config_json(text).expect("normalized config");
        assert!(normalized.contains("\"sites\""));
        assert!(is_tvbox_config_text(text));
    }

    #[test]
    fn tvbox_config_detection_ignores_square_brackets_in_comment() {
        let text = "// [notice] this line is not json\n// [debug]\n{\"spider\":\"x\",\"sites\":[{\"key\":\"a\"}]}";
        let normalized = extract_tvbox_config_json(text).expect("normalized config");
        assert!(normalized.contains("\"sites\""));
    }

    #[test]
    fn html_candidate_extracts_tvbox_links() {
        let html = r#"
        <html>
          <body>
            <a href="http://example.com/readme.html">readme</a>
            <a href="/tv">tv</a>
            <a href="https://cdn.example.com/app.js">js</a>
            <script>const api = "http://demo.test/config.json";</script>
          </body>
        </html>
        "#;
        let candidates = extract_html_candidate_urls(html, "http://example.com/");
        assert!(candidates.iter().any(|u| u.contains("/tv")));
        assert!(candidates.iter().any(|u| u.contains("config.json")));
        assert!(!candidates.iter().any(|u| u.ends_with(".js")));
    }

    #[test]
    fn deproxy_ghproxy_url_to_raw_github() {
        let input =
            "https://ghproxy.net/https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json";
        let mapped = deproxy_candidate_url(input).expect("mapped");
        assert_eq!(
            mapped,
            "https://raw.githubusercontent.com/yoursmile66/TVBox/main/XC.json"
        );
    }

    #[test]
    fn candidate_filter_skips_unrelated_hosts() {
        assert!(!candidate_is_reasonable_for_probe(
            "https://github.com/FongMi/TV",
            Some("xn--z7x900a.com")
        ));
        assert!(candidate_is_reasonable_for_probe(
            "https://raw.githubusercontent.com/a/b/main/c.json",
            Some("xn--z7x900a.com")
        ));
    }

    #[test]
    fn build_cms_api_url_replaces_conflicting_query_items() {
        let built = build_cms_api_url(
            "https://example.com/api.php?ac=videolist&t=2&wd=demo",
            &[("ac", "detail"), ("ids", "abc123")],
        );
        assert!(built.contains("ac=detail"));
        assert!(built.contains("ids=abc123"));
        assert!(!built.contains("wd=demo"));
        assert!(!built.contains("t=2"));
    }

    #[test]
    fn detail_response_detects_list_in_wrapper() {
        let text = r#"{"ok":true,"result":"{\"list\":[{\"vod_id\":\"1\"}]}"}"#;
        assert!(contains_non_empty_detail_list(text));
    }

    #[test]
    fn detail_response_rejects_empty_or_invalid_list() {
        assert!(!contains_non_empty_detail_list(r#"{"list":[]}"#));
        assert!(!contains_non_empty_detail_list("not-json"));
    }

    #[test]
    fn image_origin_headers_default_to_source_origin() {
        let headers = build_image_origin_headers("https://img.example.com/path/poster.jpg");
        assert_eq!(
            headers.get("Referer").map(String::as_str),
            Some("https://img.example.com/")
        );
        assert_eq!(
            headers.get("Origin").map(String::as_str),
            Some("https://img.example.com")
        );
    }

    #[test]
    fn image_origin_headers_override_known_hosts() {
        let headers = build_image_origin_headers(
            "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg",
        );
        assert_eq!(
            headers.get("Referer").map(String::as_str),
            Some("https://movie.douban.com/")
        );
        assert_eq!(
            headers.get("Origin").map(String::as_str),
            Some("https://movie.douban.com")
        );
    }
}
