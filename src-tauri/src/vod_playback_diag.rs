use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::media_cmds::{
    execute_media_transport, probe_stream_kind, resolve_jiexi, resolve_jiexi_webview,
    resolve_wrapped_media_url, MediaHostMapping, MediaNetworkPolicyInput, MediaRequestHeaderRule,
    MediaTransportOptions, MediaTransportRequest, MediaTransportResponse, StreamProbeResult,
};
use crate::spider_diag::{diagnose_spider_source, SpiderPlayerDiagnostic, SpiderSiteDiagnostic};
use crate::vod_hls_relay::{vod_close_hls_relay_session, vod_open_hls_relay_session};

const DEFAULT_WRAPPED_TIMEOUT_MS: u64 = 5_000;
const DEFAULT_PARSE_TIMEOUT_MS: u64 = 3_500;
const DEFAULT_BROWSER_TIMEOUT_MS: u64 = 6_000;
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 3_500;
const DEFAULT_TRANSPORT_TIMEOUT_MS: u64 = 6_000;
const DEFAULT_MPV_TIMEOUT_SECS: u64 = 20;
const DEFAULT_MPV_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[derive(Debug, Clone)]
pub struct VodPlaybackProbeArgs {
    pub source_url: String,
    pub repo_selector: Option<String>,
    pub site_selector: Option<String>,
    pub verify_mpv: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodPlaybackProbeReport {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    pub source_url: String,
    pub selected_repo_url: Option<String>,
    pub site_key: String,
    pub site_name: String,
    pub api_class: String,
    pub route_name: String,
    pub episode_title: String,
    pub episode_id: String,
    pub source_spider_url: String,
    pub ext_input: String,
    pub site_play_url: Option<String>,
    pub parse_count: usize,
    pub request_header_rule_count: usize,
    pub host_mapping_count: usize,
    pub player_payload: VodPlaybackProbePayload,
    pub steps: Vec<VodPlaybackProbeStep>,
    pub final_candidate: Option<VodPlaybackProbeCandidate>,
    pub mpv_verification: Option<MpvVerificationResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodPlaybackProbePayload {
    pub url: String,
    pub parse: i64,
    pub jx: i64,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodPlaybackProbeCandidate {
    pub url: String,
    pub headers: HashMap<String, String>,
    pub resolved_by: String,
    pub probe: Option<StreamProbeResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VodPlaybackProbeStep {
    pub stage: String,
    pub status: String,
    pub elapsed_ms: u128,
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<StreamProbeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvVerificationResult {
    pub attempted: bool,
    pub success: bool,
    pub timed_out: bool,
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_preview: Option<String>,
    pub log_path: Option<String>,
    pub log_tail: Vec<String>,
}

#[derive(Debug, Clone)]
struct SelectedConfig {
    site_play_url: Option<String>,
    parses: Vec<ConfigParse>,
    request_headers: Vec<MediaRequestHeaderRule>,
    host_mappings: Vec<MediaHostMapping>,
}

#[derive(Debug, Clone)]
struct ConfigParse {
    name: String,
    url: String,
    headers: HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawConfig {
    sites: Option<Vec<RawSite>>,
    parses: Option<Vec<RawParse>>,
    headers: Option<Vec<MediaRequestHeaderRule>>,
    hosts: Option<Value>,
}

#[derive(Debug, Default, Deserialize)]
struct RawSite {
    key: Option<String>,
    name: Option<String>,
    api: Option<String>,
    #[serde(rename = "playUrl")]
    play_url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawParse {
    name: Option<String>,
    url: Option<String>,
    ext: Option<Value>,
}

struct MediaPolicyGuard;

impl Drop for MediaPolicyGuard {
    fn drop(&mut self) {
        crate::media_cmds::set_media_network_policy(None);
    }
}

pub async fn probe_vod_playback_source(
    app: &AppHandle,
    args: VodPlaybackProbeArgs,
) -> Result<VodPlaybackProbeReport, String> {
    let source_diag = diagnose_spider_source(
        app,
        args.source_url.clone(),
        args.repo_selector.clone(),
        args.site_selector.clone(),
    )
    .await?;
    let selected_site = source_diag
        .selected_site
        .clone()
        .ok_or_else(|| "未选中站点，无法执行点播探针。请传入 --site。".to_string())?;
    let player = selected_site
        .player
        .clone()
        .ok_or_else(|| "选中站点没有 playerContent 结果，无法继续。".to_string())?;
    if !player.ok {
        return Err(player
            .failure_message
            .clone()
            .unwrap_or_else(|| "playerContent 调用失败".to_string()));
    }

    let config = load_selected_config(
        &args.source_url,
        source_diag.selected_repo_url.as_deref(),
        &selected_site,
    )
    .await?;
    install_media_policy(&config);
    let _policy_guard = MediaPolicyGuard;

    let payload = extract_player_payload(&player)?;
    let mut steps = Vec::new();
    steps.push(build_step(
        "spider_payload",
        "success",
        0,
        format!(
            "parse={} jx={} headers={} url={}",
            payload.parse,
            payload.jx,
            payload.headers.len(),
            summarize_url(&payload.url)
        ),
        Some(payload.url.clone()),
        None,
        None,
    ));

    let effective_parses = build_effective_parses(&config);
    let mut final_candidate = None;
    let mut failure_message = None;

    let payload_probe =
        probe_candidate("payload_probe", &payload.url, &payload.headers, "payload").await;
    steps.push(payload_probe.step.clone());
    if payload_probe.playable {
        final_candidate = payload_probe.candidate.clone();
    }

    let transport_preview =
        preview_transport("payload_transport", &payload.url, &payload.headers).await;
    steps.push(transport_preview.step.clone());
    if final_candidate.is_none() && transport_preview.playable {
        final_candidate = Some(VodPlaybackProbeCandidate {
            url: payload.url.clone(),
            headers: payload.headers.clone(),
            resolved_by: "payload-transport".to_string(),
            probe: payload_probe.probe.clone(),
        });
    }

    let mut parse_target_url = payload.url.clone();
    let wrapped_step = resolve_wrapped_target(&payload.url, &payload.headers).await;
    steps.push(wrapped_step.step.clone());
    if let Some(candidate) = wrapped_step.candidate.clone() {
        parse_target_url = candidate.url.clone();
        if final_candidate.is_none() {
            final_candidate = Some(candidate);
        }
    }

    let mut browser_candidates = Vec::new();
    if final_candidate.is_none() && !parse_target_url.trim().is_empty() {
        for parse in &effective_parses {
            let parse_headers = merge_headers(&parse.headers, &payload.headers);
            let parse_result = attempt_http_parse(parse, &parse_target_url, &parse_headers).await;
            steps.push(parse_result.step.clone());
            if let Some(candidate) = parse_result.candidate.clone() {
                final_candidate = Some(candidate);
                break;
            }
            if parse_result.browser_required {
                browser_candidates.push((parse.clone(), parse_headers));
            }
        }
    }

    if final_candidate.is_none() {
        for (parse, parse_headers) in browser_candidates.into_iter().take(2) {
            let webview_result =
                attempt_webview_parse(app, &parse, &parse_target_url, &parse_headers).await;
            steps.push(webview_result.step.clone());
            if let Some(candidate) = webview_result.candidate {
                final_candidate = Some(candidate);
                break;
            }
        }
    }

    if final_candidate.is_none() && !payload.url.trim().is_empty() {
        failure_message = Some("未从 wrapper/jiexi/webview 拿到可播放候选。".to_string());
    }

    let mpv_verification = if args.verify_mpv {
        let selected = final_candidate.clone().or_else(|| {
            if !parse_target_url.trim().is_empty() {
                Some(VodPlaybackProbeCandidate {
                    url: parse_target_url.clone(),
                    headers: payload.headers.clone(),
                    resolved_by: "fallback-target".to_string(),
                    probe: None,
                })
            } else {
                None
            }
        });
        match selected {
            Some(candidate) => Some(verify_with_mpv(app, &candidate).await),
            None => Some(MpvVerificationResult {
                attempted: false,
                success: false,
                timed_out: false,
                exit_code: None,
                transport_mode: None,
                effective_url: None,
                manifest_preview: None,
                log_path: None,
                log_tail: Vec::new(),
            }),
        }
    } else {
        None
    };

    Ok(VodPlaybackProbeReport {
        success: if args.verify_mpv {
            mpv_verification
                .as_ref()
                .is_some_and(|result| result.success)
        } else {
            final_candidate.is_some()
        },
        failure_message: if args.verify_mpv
            && mpv_verification
                .as_ref()
                .is_some_and(|result| !result.success)
        {
            Some("mpv 实播验证失败".to_string())
        } else {
            failure_message
        },
        source_url: args.source_url,
        selected_repo_url: source_diag.selected_repo_url,
        site_key: selected_site.site.key,
        site_name: selected_site.site.name,
        api_class: selected_site.site.api_class,
        route_name: player.flag,
        episode_title: player.episode_title,
        episode_id: player.episode_id,
        source_spider_url: selected_site.site.spider_url,
        ext_input: selected_site.site.ext_input,
        site_play_url: config.site_play_url,
        parse_count: effective_parses.len(),
        request_header_rule_count: config.request_headers.len(),
        host_mapping_count: config.host_mappings.len(),
        player_payload: payload,
        steps,
        final_candidate,
        mpv_verification,
    })
}

fn install_media_policy(config: &SelectedConfig) {
    crate::media_cmds::set_media_network_policy(Some(MediaNetworkPolicyInput {
        request_headers: config.request_headers.clone(),
        host_mappings: config.host_mappings.clone(),
        ..Default::default()
    }));
}

async fn load_selected_config(
    source_url: &str,
    selected_repo_url: Option<&str>,
    selected_site: &SpiderSiteDiagnostic,
) -> Result<SelectedConfig, String> {
    let config_url = selected_repo_url.unwrap_or(source_url).to_string();
    let config_text = crate::media_cmds::fetch_tvbox_config(config_url).await?;
    let parsed: RawConfig = serde_json::from_str(&config_text)
        .map_err(|err| format!("Failed to parse selected config JSON: {err}"))?;
    let site = parsed
        .sites
        .unwrap_or_default()
        .into_iter()
        .find(|site| site_matches_selected(site, selected_site))
        .ok_or_else(|| "在配置中找不到当前选中站点。".to_string())?;

    Ok(SelectedConfig {
        site_play_url: normalize_text(site.play_url),
        parses: parsed
            .parses
            .unwrap_or_default()
            .into_iter()
            .filter_map(parse_config_parse)
            .collect(),
        request_headers: parsed.headers.unwrap_or_default(),
        host_mappings: parse_host_mappings(parsed.hosts.as_ref()),
    })
}

fn site_matches_selected(site: &RawSite, selected_site: &SpiderSiteDiagnostic) -> bool {
    let key = normalize_text(site.key.clone());
    let name = normalize_text(site.name.clone());
    let api = normalize_text(site.api.clone());
    key.as_deref() == Some(selected_site.site.key.as_str())
        || name.as_deref() == Some(selected_site.site.name.as_str())
        || api.as_deref() == Some(selected_site.site.api_class.as_str())
}

fn parse_config_parse(parse: RawParse) -> Option<ConfigParse> {
    let url = normalize_text(parse.url)?;
    Some(ConfigParse {
        name: normalize_text(parse.name).unwrap_or_else(|| url.clone()),
        headers: parse_ext_headers(parse.ext.as_ref()),
        url,
    })
}

fn normalize_text(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn parse_ext_headers(ext: Option<&Value>) -> HashMap<String, String> {
    let Some(value) = ext else {
        return HashMap::new();
    };
    let parsed_value = if let Some(text) = value.as_str() {
        serde_json::from_str::<Value>(text).ok()
    } else {
        Some(value.clone())
    };
    let Some(parsed_value) = parsed_value else {
        return HashMap::new();
    };
    let Some(header_value) = parsed_value.get("header") else {
        return HashMap::new();
    };
    value_to_string_map(Some(header_value))
}

fn parse_host_mappings(hosts: Option<&Value>) -> Vec<MediaHostMapping> {
    let Some(Value::Array(entries)) = hosts else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| entry.as_str())
        .filter_map(|text| {
            let split_at = text.find('=')?;
            let host = text[..split_at].trim();
            let target = text[split_at + 1..].trim();
            if host.is_empty() || target.is_empty() {
                None
            } else {
                Some(MediaHostMapping {
                    host: host.to_string(),
                    target: target.to_string(),
                })
            }
        })
        .collect()
}

fn build_effective_parses(config: &SelectedConfig) -> Vec<ConfigParse> {
    let mut effective = Vec::new();
    if let Some(site_play_url) = config.site_play_url.as_ref() {
        effective.push(ConfigParse {
            name: "site_play_url".to_string(),
            url: site_play_url.clone(),
            headers: HashMap::new(),
        });
    }
    for parse in &config.parses {
        if effective.iter().any(|item| item.url == parse.url) {
            continue;
        }
        effective.push(parse.clone());
    }
    effective
}

fn extract_player_payload(
    player: &SpiderPlayerDiagnostic,
) -> Result<VodPlaybackProbePayload, String> {
    let payload_value = player
        .normalized_payload
        .as_ref()
        .ok_or_else(|| "playerContent 没有 normalized_payload".to_string())?;
    Ok(VodPlaybackProbePayload {
        url: payload_value
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string(),
        parse: payload_value
            .get("parse")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        jx: payload_value
            .get("jx")
            .and_then(Value::as_i64)
            .unwrap_or_default(),
        headers: extract_payload_headers(payload_value),
    })
}

fn extract_payload_headers(payload_value: &Value) -> HashMap<String, String> {
    let mut merged = HashMap::new();
    for key in ["headers", "header"] {
        for (header_key, header_value) in value_to_string_map(payload_value.get(key)) {
            merged.insert(header_key, header_value);
        }
    }
    for alias in ["Referer", "referer", "referrer"] {
        if let Some(value) = payload_value.get(alias).and_then(Value::as_str) {
            let next = value.trim();
            if !next.is_empty() {
                merged.insert("Referer".to_string(), next.to_string());
                break;
            }
        }
    }
    for alias in ["User-Agent", "user-agent", "ua"] {
        if let Some(value) = payload_value.get(alias).and_then(Value::as_str) {
            let next = value.trim();
            if !next.is_empty() {
                merged.insert("User-Agent".to_string(), next.to_string());
                break;
            }
        }
    }
    merged
}

fn value_to_string_map(value: Option<&Value>) -> HashMap<String, String> {
    let Some(value) = value else {
        return HashMap::new();
    };
    let candidate = if let Some(text) = value.as_str() {
        serde_json::from_str::<Value>(text).ok()
    } else {
        Some(value.clone())
    };
    let Some(Value::Object(object)) = candidate else {
        return HashMap::new();
    };
    object
        .into_iter()
        .filter_map(|(key, value)| {
            let text = match value {
                Value::String(text) => text.trim().to_string(),
                Value::Number(number) => number.to_string(),
                Value::Bool(flag) => {
                    if flag {
                        "true".to_string()
                    } else {
                        "false".to_string()
                    }
                }
                _ => String::new(),
            };
            if key.trim().is_empty() || text.is_empty() {
                None
            } else {
                Some((key.trim().to_string(), text))
            }
        })
        .collect()
}

fn merge_headers(
    primary: &HashMap<String, String>,
    secondary: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut merged = secondary.clone();
    for (key, value) in primary {
        merged.insert(key.clone(), value.clone());
    }
    merged
}

struct CandidateProbeResult {
    step: VodPlaybackProbeStep,
    probe: Option<StreamProbeResult>,
    candidate: Option<VodPlaybackProbeCandidate>,
    playable: bool,
}

async fn probe_candidate(
    stage: &str,
    url: &str,
    headers: &HashMap<String, String>,
    resolved_by: &str,
) -> CandidateProbeResult {
    let started = Instant::now();
    if url.trim().is_empty() {
        return CandidateProbeResult {
            step: build_step(
                stage,
                "skip",
                started.elapsed().as_millis(),
                "url 为空".to_string(),
                None,
                None,
                None,
            ),
            probe: None,
            candidate: None,
            playable: false,
        };
    }

    match probe_stream_kind(
        url.to_string(),
        as_optional_headers(headers),
        Some(DEFAULT_PROBE_TIMEOUT_MS),
    )
    .await
    {
        Ok(probe) => {
            let playable = probe_is_playable(&probe);
            let final_url = probe.final_url.clone().unwrap_or_else(|| url.to_string());
            CandidateProbeResult {
                step: build_step(
                    stage,
                    if playable { "success" } else { "miss" },
                    started.elapsed().as_millis(),
                    format!(
                        "kind={} reason={} final_url={}",
                        probe.kind,
                        probe.reason.clone().unwrap_or_else(|| "none".to_string()),
                        summarize_url(&final_url)
                    ),
                    Some(final_url.clone()),
                    Some(probe.clone()),
                    None,
                ),
                probe: Some(probe.clone()),
                candidate: if playable {
                    Some(VodPlaybackProbeCandidate {
                        url: final_url,
                        headers: headers.clone(),
                        resolved_by: resolved_by.to_string(),
                        probe: Some(probe),
                    })
                } else {
                    None
                },
                playable,
            }
        }
        Err(err) => CandidateProbeResult {
            step: build_step(
                stage,
                "error",
                started.elapsed().as_millis(),
                truncate_text(&err, 220),
                Some(url.to_string()),
                None,
                None,
            ),
            probe: None,
            candidate: None,
            playable: false,
        },
    }
}

struct TransportPreviewResult {
    step: VodPlaybackProbeStep,
    playable: bool,
}

async fn preview_transport(
    stage: &str,
    url: &str,
    headers: &HashMap<String, String>,
) -> TransportPreviewResult {
    let started = Instant::now();
    if url.trim().is_empty() {
        return TransportPreviewResult {
            step: build_step(
                stage,
                "skip",
                started.elapsed().as_millis(),
                "url 为空".to_string(),
                None,
                None,
                None,
            ),
            playable: false,
        };
    }

    let request = MediaTransportRequest {
        url: url.to_string(),
        options: MediaTransportOptions {
            timeout: Some(DEFAULT_TRANSPORT_TIMEOUT_MS),
            headers: if headers.is_empty() {
                None
            } else {
                serde_json::to_value(headers).ok()
            },
            ..Default::default()
        },
        request_id: Some("vod-playback-diag".to_string()),
        source: Some("vod-playback-diag".to_string()),
    };
    match execute_media_transport(request).await {
        Ok(response) => {
            let preview = body_preview(&response);
            let playable = preview
                .as_ref()
                .is_some_and(|text| looks_like_hls_manifest(text));
            TransportPreviewResult {
                step: build_step(
                    stage,
                    if response.ok { "success" } else { "miss" },
                    started.elapsed().as_millis(),
                    describe_transport_response(&response),
                    Some(response.url.clone()),
                    None,
                    preview,
                ),
                playable,
            }
        }
        Err(err) => TransportPreviewResult {
            step: build_step(
                stage,
                "error",
                started.elapsed().as_millis(),
                truncate_text(&err, 220),
                Some(url.to_string()),
                None,
                None,
            ),
            playable: false,
        },
    }
}

struct WrappedResolveResult {
    step: VodPlaybackProbeStep,
    candidate: Option<VodPlaybackProbeCandidate>,
}

async fn resolve_wrapped_target(
    url: &str,
    headers: &HashMap<String, String>,
) -> WrappedResolveResult {
    let started = Instant::now();
    if url.trim().is_empty() {
        return WrappedResolveResult {
            step: build_step(
                "wrapped_resolve",
                "skip",
                started.elapsed().as_millis(),
                "url 为空".to_string(),
                None,
                None,
                None,
            ),
            candidate: None,
        };
    }

    match resolve_wrapped_media_url(
        url.to_string(),
        as_optional_headers(headers),
        Some(DEFAULT_WRAPPED_TIMEOUT_MS),
    )
    .await
    {
        Ok(resolved) => {
            let resolved_probe =
                probe_candidate("wrapped_probe", &resolved, headers, "wrapped").await;
            WrappedResolveResult {
                step: build_step(
                    "wrapped_resolve",
                    if resolved_probe.playable {
                        "success"
                    } else {
                        "miss"
                    },
                    started.elapsed().as_millis(),
                    format!(
                        "resolved={} probe_stage_status={}",
                        summarize_url(&resolved),
                        resolved_probe.step.status
                    ),
                    Some(resolved.clone()),
                    resolved_probe.probe.clone(),
                    None,
                ),
                candidate: resolved_probe.candidate,
            }
        }
        Err(err) => WrappedResolveResult {
            step: build_step(
                "wrapped_resolve",
                "miss",
                started.elapsed().as_millis(),
                truncate_text(&err, 220),
                Some(url.to_string()),
                None,
                None,
            ),
            candidate: None,
        },
    }
}

struct ParseAttemptResult {
    step: VodPlaybackProbeStep,
    candidate: Option<VodPlaybackProbeCandidate>,
    browser_required: bool,
}

async fn attempt_http_parse(
    parse: &ConfigParse,
    target_url: &str,
    headers: &HashMap<String, String>,
) -> ParseAttemptResult {
    let started = Instant::now();
    match resolve_jiexi(
        parse.url.clone(),
        target_url.to_string(),
        as_optional_headers(headers),
        Some(DEFAULT_PARSE_TIMEOUT_MS),
    )
    .await
    {
        Ok(resolved) => {
            let resolved_probe = probe_candidate("parse_probe", &resolved, headers, "jiexi").await;
            ParseAttemptResult {
                step: build_step(
                    "parse_http",
                    if resolved_probe.playable {
                        "success"
                    } else {
                        "miss"
                    },
                    started.elapsed().as_millis(),
                    format!(
                        "parser={} resolved={} browser_required=0",
                        parse.name,
                        summarize_url(&resolved)
                    ),
                    Some(resolved),
                    resolved_probe.probe,
                    None,
                ),
                candidate: resolved_probe.candidate,
                browser_required: false,
            }
        }
        Err(err) => {
            let browser_required = err.contains("jiexi_needs_browser");
            ParseAttemptResult {
                step: build_step(
                    "parse_http",
                    if browser_required { "skip" } else { "error" },
                    started.elapsed().as_millis(),
                    format!("parser={} reason={}", parse.name, truncate_text(&err, 220)),
                    Some(parse.url.clone()),
                    None,
                    None,
                ),
                candidate: None,
                browser_required,
            }
        }
    }
}

async fn attempt_webview_parse(
    app: &AppHandle,
    parse: &ConfigParse,
    target_url: &str,
    headers: &HashMap<String, String>,
) -> ParseAttemptResult {
    let started = Instant::now();
    match resolve_jiexi_webview(
        app.clone(),
        parse.url.clone(),
        target_url.to_string(),
        Some(DEFAULT_BROWSER_TIMEOUT_MS),
        Some(false),
        None,
    )
    .await
    {
        Ok(resolved) => {
            let resolved_probe =
                probe_candidate("webview_probe", &resolved, headers, "jiexi-webview").await;
            ParseAttemptResult {
                step: build_step(
                    "parse_webview",
                    if resolved_probe.playable {
                        "success"
                    } else {
                        "miss"
                    },
                    started.elapsed().as_millis(),
                    format!(
                        "parser={} resolved={}",
                        parse.name,
                        summarize_url(&resolved)
                    ),
                    Some(resolved),
                    resolved_probe.probe,
                    None,
                ),
                candidate: resolved_probe.candidate,
                browser_required: false,
            }
        }
        Err(err) => ParseAttemptResult {
            step: build_step(
                "parse_webview",
                "error",
                started.elapsed().as_millis(),
                format!("parser={} reason={}", parse.name, truncate_text(&err, 220)),
                Some(parse.url.clone()),
                None,
                None,
            ),
            candidate: None,
            browser_required: false,
        },
    }
}

async fn verify_with_mpv(
    app: &AppHandle,
    candidate: &VodPlaybackProbeCandidate,
) -> MpvVerificationResult {
    let mpv_path = match resolve_builtin_mpv_path(app) {
        Ok(path) => path,
        Err(err) => {
            return MpvVerificationResult {
                attempted: false,
                success: false,
                timed_out: false,
                exit_code: None,
                transport_mode: None,
                effective_url: None,
                manifest_preview: None,
                log_path: None,
                log_tail: vec![err],
            };
        }
    };

    let mut transport_mode = Some("direct".to_string());
    let mut effective_url = candidate.url.clone();
    let mut effective_headers = candidate.headers.clone();
    let mut manifest_preview = None;
    let mut relay_session_id: Option<String> = None;

    if candidate_prefers_hls_relay(candidate) {
        match vod_open_hls_relay_session(
            candidate.url.clone(),
            as_optional_headers(&candidate.headers),
            None,
            None,
        )
        .await
        {
            Ok(session) => {
                relay_session_id = Some(session.session_id);
                effective_url = session.local_manifest_url;
                effective_headers.clear();
                transport_mode = Some("relay".to_string());
                manifest_preview = Some(preview_manifest_text(&effective_url).await);
            }
            Err(err) => {
                return MpvVerificationResult {
                    attempted: false,
                    success: false,
                    timed_out: false,
                    exit_code: None,
                    transport_mode: Some("relay".to_string()),
                    effective_url: Some(candidate.url.clone()),
                    manifest_preview: None,
                    log_path: None,
                    log_tail: vec![format!("打开本地 relay 失败: {err}")],
                };
            }
        }
    }

    let log_path = std::env::temp_dir().join(format!(
        "halo-vod-playback-diag-{}.log",
        chrono::Utc::now().timestamp_millis()
    ));
    let mut command = Command::new(&mpv_path);
    command
        .arg("--no-config")
        .arg("--force-window=no")
        .arg("--audio=no")
        .arg("--vo=null")
        .arg("--idle=no")
        .arg("--keep-open=no")
        .arg("--network-timeout=10")
        .arg("--msg-level=all=info")
        .arg(format!("--user-agent={DEFAULT_MPV_USER_AGENT}"))
        .arg(format!("--log-file={}", log_path.to_string_lossy()))
        .arg("--length=4")
        .arg(&effective_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(referer) = effective_headers.get("Referer") {
        command.arg(format!("--referrer={referer}"));
    }
    let extra_header_fields = effective_headers
        .iter()
        .filter(|(key, _)| !key.eq_ignore_ascii_case("referer"))
        .map(|(key, value)| format!("{key}: {value}"))
        .collect::<Vec<_>>();
    if !extra_header_fields.is_empty() {
        command.arg(format!(
            "--http-header-fields={}",
            extra_header_fields.join(",")
        ));
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            if let Some(session_id) = relay_session_id.take() {
                let _ = vod_close_hls_relay_session(Some(session_id), None).await;
            }
            return MpvVerificationResult {
                attempted: false,
                success: false,
                timed_out: false,
                exit_code: None,
                transport_mode,
                effective_url: Some(effective_url),
                manifest_preview,
                log_path: Some(log_path.to_string_lossy().to_string()),
                log_tail: vec![format!("启动 mpv 失败: {err}")],
            };
        }
    };

    let deadline = Instant::now() + Duration::from_secs(DEFAULT_MPV_TIMEOUT_SECS);
    let mut exit_code = None;
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = status.code();
                break;
            }
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(250)),
            Err(err) => {
                if let Some(session_id) = relay_session_id.take() {
                    let _ = vod_close_hls_relay_session(Some(session_id), None).await;
                }
                return MpvVerificationResult {
                    attempted: true,
                    success: false,
                    timed_out: false,
                    exit_code: None,
                    transport_mode,
                    effective_url: Some(effective_url),
                    manifest_preview,
                    log_path: Some(log_path.to_string_lossy().to_string()),
                    log_tail: vec![format!("等待 mpv 结束失败: {err}")],
                };
            }
        }
    }

    let log_tail = read_log_tail(&log_path, 30);
    let success = exit_code == Some(0)
        || log_tail
            .iter()
            .any(|line| line.contains("Starting playback") || line.contains("AV:"));
    if let Some(session_id) = relay_session_id.take() {
        let _ = vod_close_hls_relay_session(Some(session_id), None).await;
    }
    MpvVerificationResult {
        attempted: true,
        success,
        timed_out,
        exit_code,
        transport_mode,
        effective_url: Some(effective_url),
        manifest_preview,
        log_path: Some(log_path.to_string_lossy().to_string()),
        log_tail,
    }
}

fn candidate_prefers_hls_relay(candidate: &VodPlaybackProbeCandidate) -> bool {
    if candidate
        .probe
        .as_ref()
        .is_some_and(|probe| probe.kind.eq_ignore_ascii_case("hls"))
    {
        return true;
    }
    let lower = candidate.url.to_ascii_lowercase();
    lower.contains(".m3u8") || lower.contains("/m3u8/") || lower.contains("getm3u8")
}

async fn preview_manifest_text(url: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(client) => client,
        Err(err) => return format!("build relay preview client failed: {err}"),
    };
    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status();
            match response.text().await {
                Ok(text) => {
                    let preview = text
                        .replace("\r\n", "\n")
                        .replace('\r', "\n")
                        .lines()
                        .take(12)
                        .collect::<Vec<_>>()
                        .join("\n");
                    truncate_text(&format!("status={status} {preview}"), 600)
                }
                Err(err) => format!("read relay preview failed: {err}"),
            }
        }
        Err(err) => format!("request relay preview failed: {err}"),
    }
}

fn resolve_builtin_mpv_path(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(
                resource_dir
                    .join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
            candidates.push(resource_dir.join("mpv").join("windows").join("mpv.exe"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(
                    exe_dir
                        .join("resources")
                        .join("mpv")
                        .join("windows")
                        .join("mpv.exe"),
                );
                candidates.push(exe_dir.join("mpv").join("windows").join("mpv.exe"));
            }
        }
        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(
                cwd.join("src-tauri")
                    .join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
            candidates.push(
                cwd.join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
        }
        for path in candidates {
            if path.is_file() {
                return Ok(path);
            }
        }
        Err("找不到内置 mpv.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("mpv 验证当前只在 Windows 下实现".to_string())
    }
}

fn read_log_tail(path: &PathBuf, max_lines: usize) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = text
        .lines()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    if lines.len() > max_lines {
        lines.drain(0..lines.len() - max_lines);
    }
    lines
}

fn body_preview(response: &MediaTransportResponse) -> Option<String> {
    if response.body_base64.trim().is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(response.body_base64.as_bytes())
        .ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let preview = text
        .replace('\r', "")
        .lines()
        .take(12)
        .collect::<Vec<_>>()
        .join("\n");
    if preview.trim().is_empty() {
        None
    } else {
        Some(truncate_text(&preview, 600))
    }
}

fn describe_transport_response(response: &MediaTransportResponse) -> String {
    let content_type = response
        .headers
        .get("content-type")
        .cloned()
        .or_else(|| response.headers.get("Content-Type").cloned())
        .unwrap_or_else(|| "unknown".to_string());
    format!(
        "ok={} status={} content_type={} url={} error={}",
        if response.ok { "1" } else { "0" },
        response.status,
        content_type,
        summarize_url(&response.url),
        truncate_text(&response.error, 120)
    )
}

fn looks_like_hls_manifest(text: &str) -> bool {
    text.trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with("#EXTM3U")
}

fn probe_is_playable(probe: &StreamProbeResult) -> bool {
    if probe.kind == "unknown" {
        return false;
    }
    !matches!(
        probe.reason.as_deref(),
        Some(
            "stream_probe_hls_image_manifest"
                | "stream_probe_hls_html_manifest"
                | "stream_probe_hls_manifest_unreadable"
                | "stream_probe_audio_only"
        )
    )
}

fn as_optional_headers(headers: &HashMap<String, String>) -> Option<HashMap<String, String>> {
    if headers.is_empty() {
        None
    } else {
        Some(headers.clone())
    }
}

fn build_step(
    stage: &str,
    status: &str,
    elapsed_ms: u128,
    detail: String,
    url: Option<String>,
    probe: Option<StreamProbeResult>,
    body_preview: Option<String>,
) -> VodPlaybackProbeStep {
    VodPlaybackProbeStep {
        stage: stage.to_string(),
        status: status.to_string(),
        elapsed_ms,
        detail,
        url,
        probe,
        body_preview,
    }
}

fn summarize_url(url: &str) -> String {
    truncate_text(url.trim(), 180)
}

fn truncate_text(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let head = trimmed
            .chars()
            .take(max_chars.saturating_sub(3))
            .collect::<String>();
        format!("{head}...")
    }
}
