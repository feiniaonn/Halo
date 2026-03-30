use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::compat_helper::fetch_last_trace;
use crate::spider_bridge_payload::recover_payload_from_stderr;
use crate::spider_cmds_profile::profile_prepared_spider_site;
use crate::spider_cmds_runtime::{
    failure_report, store_execution_report, success_report, PreparedSpiderJar,
    SpiderExecutionTarget, SpiderSiteProfile,
};

struct BridgeExecutionResult {
    class_name: Option<String>,
    payload: String,
}

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn profile_class_name(site_profile: &Option<SpiderSiteProfile>) -> Option<String> {
    site_profile
        .as_ref()
        .map(|value| value.class_name.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalized_hint_tokens(class_hint: &str) -> Vec<String> {
    class_hint
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter_map(|token| {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_ascii_lowercase())
            }
        })
        .collect()
}

fn token_prefers_compat_runtime(token: &str) -> bool {
    matches!(
        token,
        "douban"
            | "hxq"
            | "guazi"
            | "ttian"
            | "jpys"
            | "qiao2"
            | "qiji"
            | "xdai"
            | "configcenter"
            | "goconfigamnsr"
            | "goconfigamns"
    ) || token.ends_with("amns")
}

fn site_requires_anotherds_fallback(class_hint: &str) -> bool {
    let tokens = normalized_hint_tokens(class_hint);
    [
        "douban",
        "localfile",
        "ygp",
        "apprj",
        "appget",
        "appnox",
        "appqi",
        "appys",
        "appysv2",
        "hxq",
        "bili",
        "biliys",
        "xbpq",
        "wwys",
        "jianpian",
        "saohuo",
        "gz360",
        "liteapple",
        "czsapp",
        "sp360",
        "kugou",
    ]
    .iter()
    .any(|token| tokens.iter().any(|candidate| candidate == token))
}

fn site_prefers_compat_runtime(class_hint: &str) -> bool {
    normalized_hint_tokens(class_hint)
        .iter()
        .any(|candidate| token_prefers_compat_runtime(candidate))
}

fn site_uses_short_bridge_budget(class_hint: &str) -> bool {
    let tokens = normalized_hint_tokens(class_hint);
    [
        "douban",
        "tgyundoubanpan",
        "configcenter",
        "goconfigamnsr",
        "goconfigamns",
        "localfile",
        "ygp",
    ]
    .iter()
    .any(|token| tokens.iter().any(|candidate| candidate == token))
}

fn is_remote_ext_url(ext: &str) -> bool {
    ext.starts_with("http://") || ext.starts_with("https://")
}

fn is_file_ext_url(ext: &str) -> bool {
    ext.starts_with("file://")
}

fn rule_config_key_score(map: &serde_json::Map<String, serde_json::Value>) -> usize {
    const STRONG_KEYS: [&str; 10] = [
        "homeUrl",
        "class_url",
        "searchUrl",
        "detailUrl",
        "playUrl",
        "class_name",
        "\u{5206}\u{7c7b}url",
        "\u{9996}\u{9875}url",
        "\u{5206}\u{7c7b}\u{540d}\u{79f0}",
        "\u{5206}\u{7c7b}\u{94fe}\u{63a5}",
    ];
    const AUX_KEYS: [&str; 14] = [
        "title",
        "pic_url",
        "url",
        "desc",
        "headers",
        "class_url_filter",
        "cate_exclude",
        "tab_exclude",
        "\u{5206}\u{7c7b}",
        "\u{56fe}\u{7247}",
        "\u{6807}\u{9898}",
        "\u{526f}\u{6807}\u{9898}",
        "\u{641c}\u{7d22}\u{6a21}\u{5f0f}",
        "searchable",
    ];

    let strong = STRONG_KEYS
        .iter()
        .filter(|key| map.contains_key(**key))
        .count();
    let aux = AUX_KEYS
        .iter()
        .filter(|key| map.contains_key(**key))
        .count();

    strong * 3 + aux
}

fn value_looks_like_rule_config(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            let score = rule_config_key_score(map);
            score >= 4
                || (score >= 3
                    && (map.contains_key("homeUrl")
                        || map.contains_key("class_url")
                        || map.contains_key("鍒嗙被url")
                        || map.contains_key("棣栭〉url")))
        }
        serde_json::Value::Array(items) => items.iter().take(3).any(value_looks_like_rule_config),
        _ => false,
    }
}

fn looks_like_rule_config_payload(payload: &str) -> bool {
    let trimmed = payload.trim();
    if trimmed.is_empty() || !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return false;
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .map(|value| value_looks_like_rule_config(&value))
        .unwrap_or(false)
}

fn ext_prefers_remote_url(ext: &str, fetched_inline_ext: Option<&str>) -> bool {
    is_remote_ext_url(ext)
        && fetched_inline_ext
            .map(looks_like_rule_config_payload)
            .unwrap_or(false)
}

fn site_prefers_inline_rule_config(class_hint: &str) -> bool {
    let normalized = class_hint.trim().to_ascii_lowercase();
    normalized.contains("xbpq") || normalized.contains("xyqhiker")
}

fn ext_bootstraps_home_before_category(
    method: &str,
    ext: &str,
    fetched_inline_ext: Option<&str>,
) -> bool {
    method == "categoryContent"
        && fetched_inline_ext
            .map(looks_like_rule_config_payload)
            .unwrap_or_else(|| looks_like_rule_config_payload(ext))
}

fn site_uses_douban_home_fallback(class_hint: &str, method: &str) -> bool {
    method == "homeContent" && class_hint.to_ascii_lowercase().contains("douban")
}

fn douban_home_categories() -> serde_json::Value {
    serde_json::json!([
        { "type_id": "hot_gaia", "type_name": "\u{70ed}\u{95e8}\u{63a8}\u{8350}" },
        { "type_id": "tv_hot", "type_name": "\u{70ed}\u{64ad}\u{5267}\u{96c6}" },
        { "type_id": "anime_hot", "type_name": "\u{70ed}\u{95e8}\u{52a8}\u{6f2b}" },
        { "type_id": "show_hot", "type_name": "\u{70ed}\u{95e8}\u{7efc}\u{827a}" },
        { "type_id": "movie", "type_name": "\u{7535}\u{5f71}" },
        { "type_id": "tv", "type_name": "\u{7535}\u{89c6}\u{5267}" },
        { "type_id": "rank_list_movie", "type_name": "\u{7535}\u{5f71}\u{699c}\u{5355}" },
        { "type_id": "rank_list_tv", "type_name": "\u{5267}\u{96c6}\u{699c}\u{5355}" }
    ])
}

fn build_douban_home_fallback_payload(category_payload: Option<&str>) -> String {
    let list = category_payload
        .and_then(|payload| serde_json::from_str::<serde_json::Value>(payload).ok())
        .and_then(|value| value.get("list").cloned())
        .filter(|value| value.is_array())
        .unwrap_or_else(|| serde_json::Value::Array(Vec::new()));

    serde_json::json!({
        "class": douban_home_categories(),
        "filters": {},
        "list": list
    })
    .to_string()
}

fn build_minimal_site_profile(
    prepared: &PreparedSpiderJar,
    app: &AppHandle,
    site_key: &str,
    api_class: &str,
    ext: &str,
    helper_ports: &[u16],
) -> SpiderSiteProfile {
    let compat_plan = crate::spider_compat::build_compat_plan(
        app,
        &prepared.artifact,
        site_key,
        api_class,
        ext,
        None,
        helper_ports,
    );

    SpiderSiteProfile {
        class_name: api_class.trim().to_string(),
        has_context_init: false,
        declares_context_init: false,
        has_non_context_init: false,
        has_native_init: false,
        has_native_content_method: false,
        native_methods: Vec::new(),
        init_signatures: Vec::new(),
        needs_context_shim: false,
        required_compat_packs: compat_plan.required_compat_packs,
        required_helper_ports: helper_ports.to_vec(),
        recommended_target: compat_plan.execution_target,
        routing_reason: Some("profile stage failed before a class was resolved".to_string()),
    }
}

async fn resolve_desktop_execution_context(
    app: &AppHandle,
    prepared: &PreparedSpiderJar,
    site_key: &str,
    api_class: &str,
    ext: &str,
) -> Result<(SpiderSiteProfile, Vec<PathBuf>), String> {
    let helper_ports = crate::spider_compat::detect_helper_ports(ext).await;
    let site_profile =
        match profile_prepared_spider_site(app, prepared, site_key, api_class, ext).await {
            Ok(profile) => profile,
            Err(err) => {
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderBridge] Spider site profile failed for {}: {}",
                    site_key, err
                ));
                build_minimal_site_profile(prepared, app, site_key, api_class, ext, &helper_ports)
            }
        };

    let (compat_jars, missing_compat_packs) =
        crate::spider_compat::prepare_compat_pack_jars(app, &site_profile.required_compat_packs)
            .await?;
    if !missing_compat_packs.is_empty() {
        return Err(format!(
            "Missing desktop compatibility pack(s): {}",
            missing_compat_packs.join(", ")
        ));
    }

    if !site_profile.required_helper_ports.is_empty() {
        crate::compat_helper::ensure_compat_helper_started(
            app,
            &site_profile.required_helper_ports,
        )
        .await
        .map_err(|err| format!("Compat helper unavailable: {err}"))?;
    }

    Ok((site_profile, compat_jars))
}

async fn append_helper_trace_if_needed(
    message: String,
    site_profile: Option<&SpiderSiteProfile>,
) -> String {
    let Some(profile) = site_profile else {
        return message;
    };
    if profile.recommended_target != SpiderExecutionTarget::DesktopHelper {
        return message;
    }

    match fetch_last_trace(&profile.required_helper_ports).await {
        Some(trace) => {
            let mut next = message;
            next.push_str(&format!(
                "\n\n======== Compat Helper Trace ========\nport={} method={} path={} query={} target={} status={} failure={}",
                trace.port,
                trace.method,
                trace.path,
                trace.query,
                trace.target_url.unwrap_or_else(|| "-".to_string()),
                trace
                    .response_status
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                trace.failure.unwrap_or_else(|| "-".to_string())
            ));
            next
        }
        None => message,
    }
}

fn validate_semantic_payload(method: &str, payload: &str) -> Result<(), String> {
    if !matches!(method, "homeContent" | "categoryContent" | "searchContent") {
        return Ok(());
    }

    let parsed = serde_json::from_str::<serde_json::Value>(payload).map_err(|err| {
        format!("Invalid response structure: failed to parse {method} payload: {err}")
    })?;
    let Some(obj) = parsed.as_object() else {
        return Err(format!(
            "Invalid response structure: {method} returned non-object payload"
        ));
    };

    let class_names = obj
        .get("class")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("type_name").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let list_len = obj
        .get("list")
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0);
    let class_is_placeholder_array = obj
        .get("class")
        .and_then(|value| value.as_array())
        .is_some_and(|items| {
            !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.as_object().is_some_and(|object| object.is_empty()))
        });
    let list_is_placeholder_array = obj
        .get("list")
        .and_then(|value| value.as_array())
        .is_some_and(|items| {
            !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.as_object().is_some_and(|object| object.is_empty()))
        });

    if method == "homeContent" {
        const DEFAULT_CLASS_NAMES: [&str; 6] = [
            "\u{7535}\u{5f71}",
            "\u{8fde}\u{7eed}\u{5267}",
            "\u{7efc}\u{827a}",
            "\u{52a8}\u{6f2b}",
            "4K",
            "\u{4f53}\u{80b2}",
        ];

        if class_names == DEFAULT_CLASS_NAMES && list_len == 0 {
            return Err(
                "Invalid response structure: spider returned fallback default categories without real content"
                    .to_string(),
            );
        }

        if class_is_placeholder_array || list_is_placeholder_array {
            return Err(
                "Invalid response structure: homeContent returned stripped placeholder objects"
                    .to_string(),
            );
        }

        if !obj.contains_key("class") && !obj.contains_key("list") {
            return Err(
                "Invalid response structure: homeContent returned neither class nor list"
                    .to_string(),
            );
        }
    }

    Ok(())
}
pub fn summarize_daemon_stderr_payload(payload: &str) -> String {
    summarize_text_payload_for_log(payload)
}

fn summarize_text_payload_for_log(payload: &str) -> String {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return "empty".to_string();
    }

    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(value) => summarize_json_payload_for_log(&value),
        Err(_) => format!("text chars={}", trimmed.chars().count()),
    }
}

fn summarize_json_payload_for_log(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(flag) => format!("bool={flag}"),
        serde_json::Value::Number(number) => format!("number={number}"),
        serde_json::Value::String(text) => format!("string chars={}", text.chars().count()),
        serde_json::Value::Array(items) => {
            if let Some(first) = items.first() {
                format!(
                    "array len={} first={}",
                    items.len(),
                    summarize_json_payload_for_log(first)
                )
            } else {
                "array len=0".to_string()
            }
        }
        serde_json::Value::Object(map) => {
            let mut fields = Vec::new();

            if let Some(len) = map
                .get("class")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
            {
                fields.push(format!("class={len}"));
            }

            if let Some(len) = map
                .get("list")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
            {
                fields.push(format!("list={len}"));
            }

            if let Some(len) = map
                .get("filters")
                .and_then(|value| value.as_object())
                .map(|items| items.len())
            {
                fields.push(format!("filters={len}"));
            }

            for key in ["page", "pagecount", "total", "code"] {
                if let Some(number) = map.get(key).and_then(|value| value.as_i64()) {
                    fields.push(format!("{key}={number}"));
                }
            }

            if fields.is_empty() {
                let keys = map.keys().take(6).cloned().collect::<Vec<_>>().join(",");
                fields.push(format!("keys={keys}"));
            }

            format!("object {}", fields.join(" "))
        }
    }
}

fn summarize_input_for_log(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "empty".to_string();
    }

    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("file://")
    {
        return format!("path chars={}", trimmed.chars().count());
    }

    summarize_text_payload_for_log(trimmed)
}

fn rewrite_local_spider_service_urls(payload: &str, proxy_base_url: &str) -> String {
    if payload.trim().is_empty() || proxy_base_url.trim().is_empty() {
        return payload.to_string();
    }

    [
        "http://127.0.0.1:9978",
        "https://127.0.0.1:9978",
        "http://localhost:9978",
        "https://localhost:9978",
    ]
    .iter()
    .fold(payload.to_string(), |next, target| {
        next.replace(target, proxy_base_url)
    })
}

fn sanitize_bridge_stderr(stderr: &str) -> String {
    let mut sanitized = Vec::new();
    let mut lines = stderr.lines().peekable();

    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "SPIDER_DEBUG: result" {
            let payload_line = lines.next().unwrap_or_default();
            sanitized.push(format!(
                "SPIDER_DEBUG: result [{}]",
                summarize_text_payload_for_log(payload_line)
            ));
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("DEBUG: invokeMethod result value: ") {
            sanitized.push(format!(
                "DEBUG: invokeMethod result value: [{}]",
                summarize_text_payload_for_log(payload)
            ));
            continue;
        }

        sanitized.push(trimmed.to_string());
    }

    sanitized.join("\n")
}

fn looks_like_compat_linkage_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    if normalized.contains("com.github.catvod.spider.init.context")
        || normalized.contains("init.context()")
    {
        return false;
    }
    normalized.contains("nosuchmethoderror")
        || normalized.contains("nosuchfielderror")
        || normalized.contains("incompatibleclasschangeerror")
        || normalized.contains("abstractmethoderror")
        || normalized.contains("linkageerror")
}

async fn try_site_home_fallback(
    app: &AppHandle,
    prepared: &PreparedSpiderJar,
    site_key: &str,
    api_class: &str,
    ext: &str,
    method: &str,
    compat_jars: &[PathBuf],
    site_profile: &mut Option<SpiderSiteProfile>,
    reason: &str,
) -> Option<String> {
    if !site_uses_douban_home_fallback(api_class, method) {
        return None;
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge] using Douban home fallback for {} because {}",
        site_key, reason
    ));

    let category_payload = match execute_bridge(
        app,
        &prepared.prepared_jar_path,
        site_key,
        api_class,
        ext,
        "categoryContent",
        vec![
            ("string", "hot_gaia".to_string()),
            ("string", "1".to_string()),
            ("bool", "false".to_string()),
            ("map", "".to_string()),
        ],
        compat_jars,
    )
    .await
    {
        Ok(output) => Some(output.payload),
        Err(err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderBridge] Douban category fallback prefetch failed for {}: {}",
                site_key, err
            ));
            None
        }
    };

    if let Some(profile) = site_profile.as_mut() {
        profile.routing_reason =
            Some("douban legacy home endpoint failed; used static category fallback".to_string());
    }

    Some(build_douban_home_fallback_payload(
        category_payload.as_deref(),
    ))
}

async fn fetch_inline_ext_payload(ext: &str) -> Option<String> {
    if !(ext.starts_with("http://") || ext.starts_with("https://")) {
        return None;
    }
    let client = crate::media_cmds::build_client().ok()?;
    let response = client.get(ext).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let bytes = response.bytes().await.ok()?;
    Some(
        String::from_utf8(bytes.to_vec())
            .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned()),
    )
}

async fn retry_bridge_with_inline_ext_if_needed(
    app: &AppHandle,
    prepared: &PreparedSpiderJar,
    site_key: &str,
    api_class: &str,
    ext: &str,
    method: &str,
    args: Vec<(&str, String)>,
    compat_jars: &[PathBuf],
    site_profile: &mut Option<SpiderSiteProfile>,
    reason: &str,
) -> Option<Result<BridgeExecutionResult, String>> {
    if !is_remote_ext_url(ext) {
        return None;
    }

    let inline_ext = fetch_inline_ext_payload(ext).await?;
    if inline_ext.trim().is_empty() || !looks_like_rule_config_payload(&inline_ext) {
        return None;
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge] retrying {} with inline rule-config ext for {} because {}",
        method, site_key, reason
    ));

    if let Some(profile) = site_profile.as_mut() {
        profile.routing_reason = Some(format!(
            "remote rule-config ext failed during {method}; retried with fetched inline ext payload"
        ));
    }

    Some(
        execute_bridge(
            app,
            &prepared.prepared_jar_path,
            site_key,
            api_class,
            &inline_ext,
            method,
            args,
            compat_jars,
        )
        .await,
    )
}

pub(crate) async fn execute_spider_method(
    app: &AppHandle,
    spider_url: &str,
    site_key: &str,
    api_class: &str,
    ext: &str,
    method: &str,
    args: Vec<(&str, String)>,
) -> Result<String, String> {
    match crate::spider_fast_paths::try_execute_fast_path(site_key, api_class, ext, method, &args)
        .await
    {
        Ok(Some(payload)) => {
            let class_name = Some(api_class.trim().to_string()).filter(|value| !value.is_empty());
            store_execution_report(success_report(site_key, method, class_name, None, None));
            return Ok(payload);
        }
        Ok(None) => {}
        Err(err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderFastPath] {} {} failed, falling back to JVM spider: {}",
                site_key, method, err
            ));
        }
    }
    let prepared = match crate::spider_cmds::resolve_spider_jar_with_fallback(
        app,
        spider_url,
        method,
        Some(api_class),
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(err) => {
            store_execution_report(failure_report(site_key, method, &err, None, None, None));
            return Err(err);
        }
    };

    let (site_profile, compat_jars) =
        match resolve_desktop_execution_context(app, &prepared, site_key, api_class, ext).await {
            Ok(context) => context,
            Err(err) => {
                let fallback_profile = build_minimal_site_profile(
                    &prepared,
                    app,
                    site_key,
                    api_class,
                    ext,
                    &crate::spider_compat::detect_helper_ports(ext).await,
                );
                store_execution_report(failure_report(
                    site_key,
                    method,
                    &err,
                    Some(prepared.artifact.clone()),
                    Some(fallback_profile.class_name.clone()),
                    Some(fallback_profile),
                ));
                return Err(err);
            }
        };
    let mut site_profile = Some(site_profile);

    let primary_args = args.clone();
    let execution_result = match execute_bridge(
        app,
        &prepared.prepared_jar_path,
        site_key,
        api_class,
        ext,
        method,
        primary_args,
        &compat_jars,
    )
    .await
    {
        Ok(output) => Ok(output),
        Err(err)
            if !compat_jars.is_empty()
                && site_profile
                    .as_ref()
                    .map(|profile| profile.required_helper_ports.is_empty())
                    .unwrap_or(true)
                && looks_like_compat_linkage_error(&err) =>
        {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderBridge] compat classpath conflict suspected for {}. Retrying without compat jars.",
                site_key
            ));

            match execute_bridge(
                app,
                &prepared.prepared_jar_path,
                site_key,
                api_class,
                ext,
                method,
                args.clone(),
                &[],
            )
            .await
            {
                Ok(output) => {
                    if let Some(profile) = site_profile.as_mut() {
                        profile.required_compat_packs.clear();
                        profile.recommended_target = SpiderExecutionTarget::DesktopDirect;
                        profile.routing_reason = Some(
                            "compat pack linkage conflict detected; fell back to clean desktop classpath"
                                .to_string(),
                        );
                    }
                    Ok(output)
                }
                Err(fallback_err) => {
                    crate::spider_cmds::append_spider_debug_log(&format!(
                        "[SpiderBridge] clean classpath retry failed for {}: {}",
                        site_key, fallback_err
                    ));
                    Err(fallback_err)
                }
            }
        }
        Err(err) => Err(err),
    };

    match execution_result {
        Ok(output) => {
            if let Err(err) = validate_semantic_payload(method, &output.payload) {
                if let Some(retry_result) = retry_bridge_with_inline_ext_if_needed(
                    app,
                    &prepared,
                    site_key,
                    api_class,
                    ext,
                    method,
                    args.clone(),
                    &compat_jars,
                    &mut site_profile,
                    &err,
                )
                .await
                {
                    match retry_result {
                        Ok(retry_output) => {
                            if validate_semantic_payload(method, &retry_output.payload).is_ok() {
                                store_execution_report(success_report(
                                    site_key,
                                    method,
                                    retry_output
                                        .class_name
                                        .clone()
                                        .or_else(|| profile_class_name(&site_profile)),
                                    Some(prepared.artifact.clone()),
                                    site_profile.clone(),
                                ));
                                return Ok(retry_output.payload);
                            }
                        }
                        Err(retry_err) => {
                            crate::spider_cmds::append_spider_debug_log(&format!(
                                "[SpiderBridge] inline ext retry failed for {}: {}",
                                site_key, retry_err
                            ));
                        }
                    }
                }

                if let Some(payload) = try_site_home_fallback(
                    app,
                    &prepared,
                    site_key,
                    api_class,
                    ext,
                    method,
                    &compat_jars,
                    &mut site_profile,
                    &err,
                )
                .await
                {
                    if let Err(fallback_err) = validate_semantic_payload(method, &payload) {
                        store_execution_report(failure_report(
                            site_key,
                            method,
                            &fallback_err,
                            Some(prepared.artifact),
                            output
                                .class_name
                                .or_else(|| profile_class_name(&site_profile)),
                            site_profile,
                        ));
                        return Err(fallback_err);
                    }

                    store_execution_report(success_report(
                        site_key,
                        method,
                        output
                            .class_name
                            .or_else(|| profile_class_name(&site_profile)),
                        Some(prepared.artifact),
                        site_profile,
                    ));
                    return Ok(payload);
                }

                store_execution_report(failure_report(
                    site_key,
                    method,
                    &err,
                    Some(prepared.artifact),
                    output
                        .class_name
                        .or_else(|| profile_class_name(&site_profile)),
                    site_profile,
                ));
                return Err(err);
            }

            store_execution_report(success_report(
                site_key,
                method,
                output.class_name.clone(),
                Some(prepared.artifact),
                site_profile,
            ));
            Ok(output.payload)
        }
        Err(err) => {
            if let Some(retry_result) = retry_bridge_with_inline_ext_if_needed(
                app,
                &prepared,
                site_key,
                api_class,
                ext,
                method,
                args,
                &compat_jars,
                &mut site_profile,
                &err,
            )
            .await
            {
                match retry_result {
                    Ok(retry_output) => {
                        if validate_semantic_payload(method, &retry_output.payload).is_ok() {
                            store_execution_report(success_report(
                                site_key,
                                method,
                                retry_output
                                    .class_name
                                    .clone()
                                    .or_else(|| profile_class_name(&site_profile)),
                                Some(prepared.artifact.clone()),
                                site_profile.clone(),
                            ));
                            return Ok(retry_output.payload);
                        }
                    }
                    Err(retry_err) => {
                        crate::spider_cmds::append_spider_debug_log(&format!(
                            "[SpiderBridge] inline ext retry failed for {}: {}",
                            site_key, retry_err
                        ));
                    }
                }
            }

            if let Some(payload) = try_site_home_fallback(
                app,
                &prepared,
                site_key,
                api_class,
                ext,
                method,
                &compat_jars,
                &mut site_profile,
                &err,
            )
            .await
            {
                if let Err(fallback_err) = validate_semantic_payload(method, &payload) {
                    store_execution_report(failure_report(
                        site_key,
                        method,
                        &fallback_err,
                        Some(prepared.artifact),
                        profile_class_name(&site_profile),
                        site_profile,
                    ));
                    return Err(fallback_err);
                }

                store_execution_report(success_report(
                    site_key,
                    method,
                    profile_class_name(&site_profile),
                    Some(prepared.artifact),
                    site_profile,
                ));
                return Ok(payload);
            }

            let err = append_helper_trace_if_needed(err, site_profile.as_ref()).await;
            store_execution_report(failure_report(
                site_key,
                method,
                &err,
                Some(prepared.artifact),
                profile_class_name(&site_profile),
                site_profile.clone(),
            ));
            Err(err)
        }
    }
}

async fn execute_bridge(
    app: &AppHandle,
    spider_jar_path: &Path,
    site_key: &str,
    class_hint: &str,
    ext: &str,
    method: &str,
    args: Vec<(&str, String)>,
    compat_jars: &[PathBuf],
) -> Result<BridgeExecutionResult, String> {
    let candidate_paths = {
        let mut paths = Vec::new();

        if let Ok(resource_dir) = app.path().resource_dir() {
            paths.push(resource_dir.join("resources").join("jar"));
            paths.push(resource_dir.join("jar"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            paths.push(cwd.join("src-tauri").join("resources").join("jar"));
            paths.push(cwd.join("resources").join("jar"));
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                paths.push(exe_dir.join("resources").join("jar"));
                paths.push(exe_dir.join("jar"));
            }
        }
        paths
    };

    let mut bridge_jar: Option<PathBuf> = None;
    let mut libs_root: Option<PathBuf> = None;

    for base_path in candidate_paths {
        let potential_bridge_jar = base_path.join("bridge.jar");
        let potential_libs_root = base_path.join("libs");

        if potential_bridge_jar.exists() {
            bridge_jar = Some(potential_bridge_jar);
            if potential_libs_root.exists() {
                libs_root = Some(potential_libs_root);
            }
            break;
        }
    }

    let bridge_jar =
        bridge_jar.ok_or_else(|| "bridge.jar not found in any candidate path".to_string())?;
    let bridge_jar_cleaned = clean_path(&bridge_jar);
    let spider_jar_cleaned = clean_path(spider_jar_path);
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let mut classpath_parts = Vec::new();
    let compat_classpath_parts = compat_jars
        .iter()
        .filter(|compat_jar| compat_jar.is_file())
        .map(|compat_jar| clean_path(compat_jar))
        .collect::<Vec<_>>();
    let prefer_compat_runtime =
        site_prefers_compat_runtime(class_hint) || !compat_classpath_parts.is_empty();

    let fallback_jar = if site_requires_anotherds_fallback(class_hint) {
        let mut fallback_candidates: Vec<PathBuf> = Vec::new();
        if let Some(jar_root) = libs_root.as_ref().and_then(|root| root.parent()) {
            fallback_candidates.push(jar_root.join("fallbacks").join("anotherds_spider.jar"));
        }
        if let Some(spider_parent) = spider_jar_path.parent() {
            fallback_candidates.push(spider_parent.join("fallbacks").join("anotherds_spider.jar"));
        }
        fallback_candidates.into_iter().find(|path| path.is_file())
    } else {
        None
    };
    let fallback_jar_cleaned = fallback_jar.as_ref().map(|path| clean_path(path));
    let compat_classpath = compat_classpath_parts.join(cp_separator);

    classpath_parts.push(bridge_jar_cleaned.clone());

    if let Some(libs_root) = libs_root.as_ref() {
        let preferred_lang3 = libs_root.join("commons-lang3.jar");
        if preferred_lang3.exists() {
            classpath_parts.push(clean_path(&preferred_lang3));
        }
        classpath_parts.push(clean_path(&libs_root.join("*")));
    } else {
        let log = "[SpiderBridge] libs directory not found; continuing with bridge.jar only";
        println!("{}", log);
        crate::spider_cmds::append_spider_debug_log(log);
    }
    let classpath = classpath_parts.join(cp_separator);

    let fetched_inline_ext = if is_remote_ext_url(ext) {
        fetch_inline_ext_payload(ext).await
    } else {
        None
    };
    let preserve_remote_ext_url = !site_prefers_inline_rule_config(class_hint)
        && ext_prefers_remote_url(ext, fetched_inline_ext.as_deref());
    let mut resolved_ext = ext.to_string();
    if is_remote_ext_url(ext) && !preserve_remote_ext_url {
        if let Some(inline_ext) = fetched_inline_ext.as_ref() {
            resolved_ext = inline_ext.clone();
        }
    } else if is_file_ext_url(ext) {
        let mut path = ext.trim_start_matches("file:///").to_string();
        #[cfg(target_os = "windows")]
        {
            path = path.replace("/", "\\");
        }
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                resolved_ext = text;
            } else {
                resolved_ext = String::from_utf8_lossy(&bytes).into_owned();
            }
        }
    }

    let java_bin = crate::java_runtime::resolve_java_binary(app)?;
    let java_home = crate::java_runtime::resolve_java_home(app)?;
    let proxy_base_url: String =
        crate::spider_local_service::ensure_spider_local_service_started().await?;
    let rewritten_ext = rewrite_local_spider_service_urls(&resolved_ext, &proxy_base_url);
    if rewritten_ext != resolved_ext {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge Rust] rewrote localhost spider service urls to {}",
            proxy_base_url
        ));
        resolved_ext = rewritten_ext;
    }

    crate::spider_local_service::register_spider_proxy_context(
        crate::spider_proxy_bridge::SpiderProxyBridgeContext {
            java_bin: java_bin.clone(),
            java_home: java_home.clone(),
            bridge_jar: bridge_jar.clone(),
            libs_root: libs_root.clone(),
            spider_jar: spider_jar_path.to_path_buf(),
            site_key: site_key.to_string(),
            class_hint: class_hint.to_string(),
            resolved_ext: resolved_ext.clone(),
            compat_jars: compat_jars.to_vec(),
            fallback_jar: fallback_jar.clone(),
            prefer_compat_runtime,
            proxy_base_url: proxy_base_url.clone(),
        },
    )
    .await;
    let precall_methods =
        if ext_bootstraps_home_before_category(method, ext, fetched_inline_ext.as_deref()) {
            "homeContent".to_string()
        } else {
            String::new()
        };
    let mut cmd = Command::new(&java_bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge Rust] method={} ext={} resolved_ext={} ext_strategy={}",
        method,
        summarize_input_for_log(ext),
        summarize_input_for_log(&resolved_ext),
        if preserve_remote_ext_url {
            "remote-rule-config-first"
        } else if is_remote_ext_url(ext) {
            "inline-remote-ext"
        } else if looks_like_rule_config_payload(ext) {
            "inline-rule-config"
        } else {
            "direct"
        }
    ));

    let lib_dir = crate::spider_compat::get_native_lib_dir(spider_jar_path);
    let js_runtime_root = crate::spider_cmds::resolve_tvbox_runtime_root(app)
        .map(|path| clean_path(&path))
        .unwrap_or_default();
    let lib_dir_cleaned = clean_path(&lib_dir);
    let timeout_secs = bridge_timeout_secs(method, class_hint, &resolved_ext, compat_jars);

    let daemon_request = crate::spider_daemon::DaemonCallRequest {
        jar_path: spider_jar_cleaned.clone(),
        site_key: site_key.to_string(),
        class_hint: class_hint.to_string(),
        ext: resolved_ext.clone(),
        spider_method: method.to_string(),
        args: args
            .iter()
            .map(|(arg_type, value)| crate::spider_daemon::DaemonArg {
                arg_type: (*arg_type).to_string(),
                value: value.clone(),
            })
            .collect(),
        compat_jars: compat_classpath.clone(),
        fallback_jar: fallback_jar_cleaned.clone(),
        prefer_compat_runtime,
        precall_methods: precall_methods.clone(),
        proxy_base_url: proxy_base_url.clone(),
        js_runtime_root: js_runtime_root.clone(),
        lib_dir: lib_dir_cleaned.clone(),
    };

    match crate::spider_daemon::daemon_call(app, daemon_request, Duration::from_secs(timeout_secs))
        .await
    {
        Ok(result) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderDaemon] served {} via daemon for {}",
                method, site_key
            ));
            return Ok(BridgeExecutionResult {
                class_name: result.class_name,
                payload: result.payload,
            });
        }
        Err(err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderDaemon] falling back to per-call bridge for {} {}: {}",
                site_key, method, err
            ));
        }
    }

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg("-noverify")
        .arg(format!("-Dspider.lib.dir={lib_dir_cleaned}"))
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(&classpath)
        .arg("com.halo.spider.BridgeRunnerCompat")
        .env("JAVA_HOME", java_home)
        .env("HALO_JAR_PATH", &spider_jar_cleaned)
        .env("HALO_SITE_KEY", site_key)
        .env("HALO_CLASS_HINT", class_hint)
        .env("HALO_EXT", &resolved_ext)
        .env("HALO_METHOD", method)
        .env("HALO_PROXY_BASE_URL", &proxy_base_url)
        .env("HALO_PRECALL_METHODS", &precall_methods)
        .env("HALO_COMPAT_JARS", &compat_classpath)
        .env("HALO_JS_RUNTIME_ROOT", &js_runtime_root)
        .env(
            "HALO_UNIFIED_REQUEST_POLICY_V1",
            if crate::spider_runtime_contract::current_spider_feature_flags()
                .unified_request_policy_v1
            {
                "1"
            } else {
                "0"
            },
        )
        .env(
            "HALO_SPIDER_EXECUTION_ENVELOPE_V1",
            if crate::spider_runtime_contract::current_spider_feature_flags()
                .spider_execution_envelope_v1
            {
                "1"
            } else {
                "0"
            },
        )
        .env(
            "HALO_NORMALIZED_PAYLOAD_V1",
            if crate::spider_runtime_contract::current_spider_feature_flags().normalized_payload_v1
            {
                "1"
            } else {
                "0"
            },
        )
        .env(
            "HALO_SPIDER_TASK_MANAGER_V1",
            if crate::spider_runtime_contract::current_spider_feature_flags().spider_task_manager_v1
            {
                "1"
            } else {
                "0"
            },
        )
        .env(
            "HALO_PREFER_COMPAT_RUNTIME",
            if prefer_compat_runtime { "1" } else { "0" },
        )
        .env("HALO_ARG_COUNT", args.len().to_string());

    if let Some(fallback) = fallback_jar_cleaned.as_ref() {
        cmd.env("HALO_FALLBACK_JAR", fallback);
    }

    println!(
        "[SpiderBridge] Invoking {} -> {} (Site: {}, Hint: {}, Jar: {})",
        method, class_hint, site_key, class_hint, spider_jar_cleaned
    );
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge Rust] local proxy base url={proxy_base_url}"
    ));
    if !js_runtime_root.is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge Rust] js runtime root={js_runtime_root}"
        ));
    }
    if !precall_methods.is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge Rust] precall methods={precall_methods}"
        ));
    }

    for (index, (arg_type, arg_val)) in args.iter().enumerate() {
        cmd.env(format!("HALO_ARG_{}_TYPE", index), arg_type);
        cmd.env(format!("HALO_ARG_{}_VALUE", index), arg_val);
    }

    cmd.kill_on_drop(true);
    let execution = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output());

    match execution.await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let sanitized_stderr = sanitize_bridge_stderr(&stderr);

            if !sanitized_stderr.is_empty() {
                eprintln!("[SpiderBridge:Log]\n{}", sanitized_stderr.trim_end());

                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[{}] Spider: {} | Method: {}\n{}",
                    timestamp,
                    spider_jar_cleaned,
                    method,
                    sanitized_stderr.trim_end()
                ));
            }

            if !output.status.success() {
                return Err(format!(
                    "Spider execution failed (Exit {}). Path: {:?}\nStdout: {}\nStderr: {}",
                    output.status.code().unwrap_or(-1),
                    bridge_jar.display(),
                    stdout,
                    sanitized_stderr
                ));
            }

            let start_tag = ">>HALO_RESPONSE<<";
            let end_tag = ">>HALO_RESPONSE<<";

            if let (Some(start_idx), Some(end_idx)) =
                (stdout.find(start_tag), stdout.rfind(end_tag))
            {
                if start_idx + start_tag.len() < end_idx {
                    let json_payload = &stdout[start_idx + start_tag.len()..end_idx].trim();
                    match serde_json::from_str::<serde_json::Value>(json_payload) {
                        Ok(parsed) => {
                            if let Some(ok_flag) =
                                parsed.get("ok").and_then(|value| value.as_bool())
                            {
                                if ok_flag {
                                    let class_name = parsed
                                        .get("className")
                                        .and_then(|value| value.as_str())
                                        .map(str::trim)
                                        .filter(|value| !value.is_empty())
                                        .map(ToOwned::to_owned);
                                    if let Some(result_value) = parsed.get("result") {
                                        let result = match result_value {
                                            serde_json::Value::Null => Ok(BridgeExecutionResult {
                                                class_name: class_name.clone(),
                                                payload: "{}".to_string(),
                                            }),
                                            serde_json::Value::String(result) => {
                                                if result.is_empty() {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: "{}".to_string(),
                                                    })
                                                } else {
                                                    match serde_json::from_str::<serde_json::Value>(
                                                        result,
                                                    ) {
                                                        Ok(result_val) => {
                                                            if let Some(arr) = result_val.as_array()
                                                            {
                                                                if let Some(first) = arr.first() {
                                                                    Ok(BridgeExecutionResult {
                                                                        class_name: class_name
                                                                            .clone(),
                                                                        payload: first.to_string(),
                                                                    })
                                                                } else {
                                                                    Ok(BridgeExecutionResult {
                                                                        class_name: class_name
                                                                            .clone(),
                                                                        payload: "{}".to_string(),
                                                                    })
                                                                }
                                                            } else {
                                                                Ok(BridgeExecutionResult {
                                                                    class_name: class_name.clone(),
                                                                    payload: result_val.to_string(),
                                                                })
                                                            }
                                                        }
                                                        Err(_) => Ok(BridgeExecutionResult {
                                                            class_name: class_name.clone(),
                                                            payload: result.to_string(),
                                                        }),
                                                    }
                                                }
                                            }
                                            serde_json::Value::Array(arr) => {
                                                if let Some(first) = arr.first() {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: first.to_string(),
                                                    })
                                                } else {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: "{}".to_string(),
                                                    })
                                                }
                                            }
                                            other => Ok(BridgeExecutionResult {
                                                class_name: class_name.clone(),
                                                payload: other.to_string(),
                                            }),
                                        };

                                        result.map(|mut execution| {
                                            if let Some(recovered) = recover_payload_from_stderr(
                                                &stderr,
                                                &execution.payload,
                                            ) {
                                                execution.payload = recovered;
                                            }
                                            execution
                                        })
                                    } else {
                                        Ok(BridgeExecutionResult {
                                            class_name,
                                            payload: "{}".to_string(),
                                        })
                                    }
                                } else {
                                    let mut final_err = if let Some(error_msg) =
                                        parsed.get("error").and_then(|value| value.as_str())
                                    {
                                        format!("Spider Java execution failed: {}", error_msg)
                                    } else {
                                        "Bridge execution failed with unparseable JSON.".to_string()
                                    };
                                    if !sanitized_stderr.trim().is_empty() {
                                        final_err.push_str(&format!(
                                            "\n\n======== Java stderr ========\n{}",
                                            sanitized_stderr.trim_end()
                                        ));
                                    }
                                    Err(final_err)
                                }
                            } else {
                                let mut err_msg =
                                    format!("Invalid response structure: {}", json_payload);
                                if !sanitized_stderr.trim().is_empty() {
                                    err_msg.push_str(&format!(
                                        "\n\n======== Java stderr ========\n{}",
                                        sanitized_stderr.trim_end()
                                    ));
                                }
                                Err(err_msg)
                            }
                        }
                        Err(err) => {
                            Err(format!("Failed to parse spider response. Error: {}.", err))
                        }
                    }
                } else {
                    Err("Empty payload between response delimiters.".to_string())
                }
            } else {
                let first_lines = stdout.lines().take(5).collect::<Vec<_>>().join("\n");
                Err(format!(
                    "Spider bridge failed to return delimited response. Stdout snippet:\n{}\nStderr:\n{}",
                    first_lines,
                    sanitized_stderr
                        .lines()
                        .take(5)
                        .collect::<Vec<_>>()
                        .join("\n")
                ))
            }
        }
        Ok(Err(err)) => Err(format!("Failed to spawn java process: {}", err)),
        Err(_) => Err(format!(
            "Spider execution timeout exceeded after {timeout_secs}s for method {method}. Process was killed to prevent memory leak."
        )),
    }
}

fn bridge_timeout_secs(method: &str, class_hint: &str, ext: &str, compat_jars: &[PathBuf]) -> u64 {
    let compat_content_site = !compat_jars.is_empty() && !site_uses_short_bridge_budget(class_hint);
    let remote_or_bootstrap_ext = is_remote_ext_url(ext) || ext.trim().is_empty();

    match method {
        "homeContent" | "categoryContent" => {
            if compat_content_site && remote_or_bootstrap_ext {
                12
            } else if compat_content_site {
                10
            } else {
                5
            }
        }
        "searchContent" => {
            if compat_content_site && remote_or_bootstrap_ext {
                10
            } else if compat_content_site {
                8
            } else {
                5
            }
        }
        "detailContent" => 75,
        "playerContent" => 20,
        _ => 30,
    }
}

#[cfg(test)]
mod log_summary_tests {
    use super::{
        build_douban_home_fallback_payload, looks_like_compat_linkage_error,
        sanitize_bridge_stderr, summarize_input_for_log, summarize_text_payload_for_log,
    };

    #[test]
    fn summarizes_result_payloads_in_stderr() {
        let stderr = concat!(
            "SPIDER_DEBUG: result\n",
            "{\"class\":[{\"type_name\":\"movie\"}],\"list\":[{\"vod_id\":\"1\"},{\"vod_id\":\"2\"}],\"page\":1}\n",
            "DEBUG: invokeMethod result value: [{\"list\":[{\"vod_id\":\"1\"}],\"page\":2}]"
        );

        let sanitized = sanitize_bridge_stderr(stderr);

        assert!(sanitized.contains("SPIDER_DEBUG: result [object class=1 list=2 page=1]"));
        assert!(sanitized.contains(
            "DEBUG: invokeMethod result value: [array len=1 first=object list=1 page=2]"
        ));
        assert!(!sanitized.contains("\"vod_id\":\"1\""));
    }

    #[test]
    fn summarizes_large_json_payloads_without_dumping_fields() {
        let summary = summarize_text_payload_for_log(
            r#"{"class":[{"type_name":"movie"}],"list":[{"vod_id":"1"},{"vod_id":"2"}],"filters":{"genre":[]}}"#,
        );

        assert_eq!(summary, "object class=1 list=2 filters=1");
    }

    #[test]
    fn summarizes_ext_input_by_shape() {
        assert_eq!(
            summarize_input_for_log("https://example.com/ext.json"),
            "path chars=28"
        );
        assert_eq!(summarize_input_for_log("{\"a\":1}"), "object keys=a");
    }

    #[test]
    fn init_context_linkage_error_keeps_compat_classpath() {
        assert!(!looks_like_compat_linkage_error(
            "java.lang.NoSuchMethodError: 'android.app.Application com.github.catvod.spider.Init.context()'"
        ));
    }

    #[test]
    fn douban_home_fallback_uses_category_list_when_available() {
        let payload = build_douban_home_fallback_payload(Some(
            r#"{"list":[{"vod_id":"1","vod_name":"绀轰緥褰辩墖"}],"page":1}"#,
        ));
        assert!(payload.contains("\"hot_gaia\""));
        assert!(payload.contains("\"vod_name\":\"绀轰緥褰辩墖\""));
    }
}
#[cfg(test)]
mod tests {
    use super::{
        bridge_timeout_secs, ext_bootstraps_home_before_category, ext_prefers_remote_url,
        looks_like_rule_config_payload, rewrite_local_spider_service_urls,
        site_prefers_compat_runtime, site_prefers_inline_rule_config,
        site_requires_anotherds_fallback, validate_semantic_payload,
    };

    #[test]
    fn rejects_fallback_default_categories() {
        let payload = r#"{
            "class":[
                {"type_name":"鐢靛奖"},
                {"type_name":"杩炵画鍓?},
                {"type_name":"缁艰壓"},
                {"type_name":"鍔ㄦ极"},
                {"type_name":"4K"},
                {"type_name":"浣撹偛"}
            ],
            "list":[]
        }"#;
        assert!(validate_semantic_payload("homeContent", payload).is_err());
    }

    #[test]
    fn accepts_regular_home_payload() {
        let payload = r#"{
            "class":[{"type_name":"鐢靛奖"}],
            "list":[{"vod_id":"1","vod_name":"demo"}]
        }"#;
        assert!(validate_semantic_payload("homeContent", payload).is_ok());
    }

    #[test]
    fn rejects_placeholder_home_payloads() {
        let payload = r#"{
            "class":[{},{}],
            "list":[{},{}],
            "filters":{"anime_hot":[{"name":"鐑棬鍔ㄦ极"}]}
        }"#;
        assert!(validate_semantic_payload("homeContent", payload).is_err());
    }

    #[test]
    fn routes_douban_and_hxq_through_anotherds_fallback() {
        assert!(site_requires_anotherds_fallback("csp_Douban"));
        assert!(site_requires_anotherds_fallback("csp_Hxq"));
        assert!(site_requires_anotherds_fallback("csp_AppGet"));
        assert!(site_requires_anotherds_fallback("csp_LiteApple"));
        assert!(site_requires_anotherds_fallback("csp_YGP"));
        assert!(site_requires_anotherds_fallback("csp_XBPQ"));
        assert!(!site_requires_anotherds_fallback("csp_ConfigCenter"));
        assert!(!site_requires_anotherds_fallback("csp_GoConfigAmnsr"));
        assert!(!site_requires_anotherds_fallback("csp_Jpys"));
        assert!(!site_requires_anotherds_fallback("csp_Other"));
    }

    #[test]
    fn prefers_compat_runtime_for_douban_and_hxq() {
        assert!(site_prefers_compat_runtime("csp_Douban"));
        assert!(site_prefers_compat_runtime("csp_Hxq"));
        assert!(site_prefers_compat_runtime("csp_GuaZi"));
        assert!(site_prefers_compat_runtime("csp_qiao2"));
        assert!(site_prefers_compat_runtime("csp_ConfigCenter"));
        assert!(site_prefers_compat_runtime("csp_CzzyAmns"));
        assert!(site_prefers_compat_runtime("csp_HHkkAmns"));
        assert!(!site_prefers_compat_runtime("csp_AppRJ"));
    }

    #[test]
    fn extends_timeout_for_compat_content_sites_only() {
        let compat = vec![std::path::PathBuf::from("compat.jar")];
        assert_eq!(
            bridge_timeout_secs("homeContent", "csp_Lkdy", "https://lkvod.com", &compat),
            12
        );
        assert_eq!(
            bridge_timeout_secs("searchContent", "csp_Lkdy", "https://lkvod.com", &compat),
            10
        );
        assert_eq!(
            bridge_timeout_secs("homeContent", "csp_ConfigCenter", "", &compat),
            5
        );
        assert_eq!(
            bridge_timeout_secs("searchContent", "csp_Douban", "", &compat),
            5
        );
    }

    #[test]
    fn detects_rule_config_payload_variants() {
        assert!(looks_like_rule_config_payload(
            r#"{"鍒嗙被url":"https://example.com/list/{cateId}","鍒嗙被":"鍒嗙被1","鏍囬":"a&&Text","鍓爣棰?:"span&&Text","鍥剧墖":"img&&src"}"#
        ));
        assert!(looks_like_rule_config_payload(
            r#"{"homeUrl":"https://example.com","class_url":"/show/{cateId}","searchUrl":"/search","title":"a&&Text","pic_url":"img&&src"}"#
        ));
        assert!(!looks_like_rule_config_payload(
            r#"{"commonConfig":"https://example.com/config.json"}"#
        ));
    }

    #[test]
    fn preserves_remote_url_for_rule_config_payloads() {
        let payload = r#"{"鍒嗙被url":"https://example.com/list/{cateId}","鍒嗙被":"鍒嗙被1","鏍囬":"a&&Text","鍥剧墖":"img&&src"}"#;
        assert!(ext_prefers_remote_url(
            "https://example.com/rule.json",
            Some(payload)
        ));
        assert!(!ext_prefers_remote_url(
            "https://example.com/config.json",
            Some(r#"{"commonConfig":"https://example.com/peizhi.json"}"#)
        ));
    }

    #[test]
    fn bootstraps_home_before_rule_config_category() {
        let payload = r#"{"鍒嗙被url":"https://example.com/list/{cateId}","鍒嗙被":"鍒嗙被1","鏍囬":"a&&Text","鍥剧墖":"img&&src"}"#;
        assert!(ext_bootstraps_home_before_category(
            "categoryContent",
            "https://example.com/rule.json",
            Some(payload)
        ));
        assert!(ext_bootstraps_home_before_category(
            "categoryContent",
            payload,
            None
        ));
        assert!(!ext_bootstraps_home_before_category(
            "homeContent",
            payload,
            None
        ));
        assert!(!ext_bootstraps_home_before_category(
            "categoryContent",
            r#"{"commonConfig":"https://example.com/peizhi.json"}"#,
            None
        ));
    }

    #[test]
    fn xbpq_family_prefers_inline_rule_config() {
        assert!(site_prefers_inline_rule_config("csp_XBPQ"));
        assert!(site_prefers_inline_rule_config("csp_XYQHiker"));
        assert!(!site_prefers_inline_rule_config("csp_Douban"));
    }

    #[test]
    fn rewrites_legacy_local_service_urls() {
        let payload = r#"{"cookie":"http://127.0.0.1:9978/file/TVBox/bili_cookie.txt","proxy":"http://localhost:9978/proxy"}"#;
        let rewritten = rewrite_local_spider_service_urls(payload, "http://127.0.0.1:61234");
        assert!(rewritten.contains("http://127.0.0.1:61234/file/TVBox/bili_cookie.txt"));
        assert!(rewritten.contains("http://127.0.0.1:61234/proxy"));
    }
}
