use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::spider_cmds_runtime::{
    get_spider_execution_report, SpiderExecutionReport, SpiderFailureKind, SpiderPrefetchResult,
};
use crate::spider_response_contract::NormalizedSpiderMethodResponse;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderSourceDiagnostic {
    pub source_url: String,
    pub selected_repo_url: Option<String>,
    pub spider_url: String,
    pub site_count: usize,
    pub repo_count: usize,
    pub bridge: SpiderBridgeInventory,
    pub repos: Vec<SpiderRepoInventoryItem>,
    pub sites: Vec<SpiderSiteInventoryItem>,
    pub selected_site: Option<SpiderSiteDiagnostic>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderRepoInventoryItem {
    pub index: usize,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderBridgeInventory {
    pub runtime_bridge_jar: Option<String>,
    pub runtime_bridge_has_profile_runner: bool,
    pub profile_bridge_jar: Option<String>,
    pub profile_bridge_has_profile_runner: bool,
    pub profile_jar_differs_from_runtime: bool,
    pub anotherds_fallback_jar: Option<String>,
    pub halo_spider_jar: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderSiteInventoryItem {
    pub index: usize,
    pub key: String,
    pub name: String,
    pub api_class: String,
    pub spider_url: String,
    pub has_jar_override: bool,
    pub ext_kind: String,
    pub ext_preview: String,
    pub searchable: bool,
    pub quick_search: bool,
    pub filterable: bool,
    pub category_count: usize,
    #[serde(skip_serializing)]
    pub ext_input: String,
    #[serde(skip_serializing)]
    pub first_preset_category: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderSiteDiagnostic {
    pub site: SpiderSiteInventoryItem,
    pub prefetch: Option<SpiderPrefetchResult>,
    pub prefetch_error: Option<String>,
    pub profile: Option<SpiderExecutionReport>,
    pub home: Option<SpiderMethodDiagnostic>,
    pub category: Option<SpiderMethodDiagnostic>,
    pub search: Option<SpiderMethodDiagnostic>,
    pub detail: Option<SpiderMethodDiagnostic>,
    pub player: Option<SpiderPlayerDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderMethodDiagnostic {
    pub ok: bool,
    pub failure_kind: Option<SpiderFailureKind>,
    pub failure_message: Option<String>,
    pub execution_report: Option<SpiderExecutionReport>,
    pub payload_summary: Option<SpiderPayloadSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderPlayerDiagnostic {
    pub flag: String,
    pub episode_title: String,
    pub episode_id: String,
    pub ok: bool,
    pub failure_kind: Option<SpiderFailureKind>,
    pub failure_message: Option<String>,
    pub execution_report: Option<SpiderExecutionReport>,
    pub raw_payload: Option<String>,
    pub normalized_payload: Option<Value>,
    pub payload_summary: Option<SpiderPlayerPayloadSummary>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderPlayerPayloadSummary {
    pub payload_kind: String,
    pub payload_keys: Vec<String>,
    pub url: Option<String>,
    pub parse: Option<i64>,
    pub jx: Option<i64>,
    pub header_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderPayloadSummary {
    pub payload_kind: String,
    pub class_count: usize,
    pub list_count: usize,
    pub filter_count: usize,
    pub page: Option<i64>,
    pub page_count: Option<i64>,
    pub total: Option<i64>,
    pub first_category_id: Option<String>,
    pub first_category_name: Option<String>,
    pub sample_class_names: Vec<String>,
    pub sample_vod_names: Vec<String>,
    pub sample_vod_pics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawTvBoxSite {
    key: Option<String>,
    name: Option<String>,
    api: Option<String>,
    jar: Option<String>,
    ext: Option<Value>,
    searchable: Option<Value>,
    quick_search: Option<Value>,
    filterable: Option<Value>,
    categories: Option<Vec<Value>>,
}

fn normalize_text(value: Option<&str>) -> String {
    value.map(str::trim).unwrap_or("").to_string()
}

fn normalize_bool(value: Option<&Value>, fallback: bool) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_i64().is_some_and(|next| next != 0),
        Some(Value::String(text)) => {
            let normalized = text.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                fallback
            } else if matches!(normalized.as_str(), "0" | "false" | "off" | "no") {
                false
            } else if matches!(normalized.as_str(), "1" | "true" | "on" | "yes") {
                true
            } else {
                fallback
            }
        }
        _ => fallback,
    }
}

fn normalize_site_ext(ext: Option<&Value>) -> (String, String) {
    match ext {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                ("empty".to_string(), String::new())
            } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                ("url".to_string(), trimmed.to_string())
            } else {
                ("text".to_string(), trimmed.to_string())
            }
        }
        Some(Value::Array(items)) => (
            "array".to_string(),
            serde_json::to_string(items).unwrap_or_default(),
        ),
        Some(Value::Object(map)) => (
            "object".to_string(),
            serde_json::to_string(map).unwrap_or_default(),
        ),
        Some(Value::Null) | None => ("empty".to_string(), String::new()),
        Some(other) => ("text".to_string(), other.to_string()),
    }
}

fn preview_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max_chars).collect();
    format!("{head}...")
}

fn jar_contains_entry(path: &std::path::Path, entry_name: &str) -> bool {
    let normalized = path.to_string_lossy();
    let normalized = normalized
        .strip_prefix("\\\\?\\")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| normalized.to_string());
    let file = match std::fs::File::open(&normalized) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return false,
    };
    let exists = archive.by_name(entry_name).is_ok();
    exists
}

fn locate_fallback_jar(app: &AppHandle, file_name: &str) -> Option<String> {
    crate::spider_cmds::resolve_resource_jar_dirs(app)
        .into_iter()
        .map(|base| base.join("fallbacks").join(file_name))
        .find(|candidate| candidate.is_file())
        .map(|path| path.to_string_lossy().to_string())
}

fn build_bridge_inventory(app: &AppHandle) -> SpiderBridgeInventory {
    const PROFILE_RUNNER_CLASS: &str = "com/halo/spider/SpiderProfileRunner.class";

    let runtime_bridge_path = crate::spider_cmds::resolve_bridge_jar(app).ok();
    let runtime_bridge_has_profile_runner = runtime_bridge_path
        .as_ref()
        .is_some_and(|path| jar_contains_entry(path, PROFILE_RUNNER_CLASS));

    let profile_bridge_path =
        crate::spider_cmds_profile::resolve_profile_runner_bridge_jar(app).ok();
    let profile_bridge_has_profile_runner = profile_bridge_path
        .as_ref()
        .is_some_and(|path| jar_contains_entry(path, PROFILE_RUNNER_CLASS));

    SpiderBridgeInventory {
        runtime_bridge_jar: runtime_bridge_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        runtime_bridge_has_profile_runner,
        profile_bridge_jar: profile_bridge_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        profile_bridge_has_profile_runner,
        profile_jar_differs_from_runtime: runtime_bridge_path.as_ref()
            != profile_bridge_path.as_ref(),
        anotherds_fallback_jar: locate_fallback_jar(app, "anotherds_spider.jar"),
        halo_spider_jar: crate::spider_cmds::get_builtin_spider_jar_path(app.clone())
            .ok()
            .map(|value| value.trim_start_matches("file:///").replace('/', "\\")),
    }
}

fn find_tvbox_config_object(value: &Value) -> Option<&Map<String, Value>> {
    match value {
        Value::Object(map) => {
            if map.get("sites").is_some_and(Value::is_array) {
                return Some(map);
            }
            if let Some(result) = map.get("result").and_then(find_tvbox_config_object) {
                return Some(result);
            }
            if let Some(result) = map.get("data").and_then(find_tvbox_config_object) {
                return Some(result);
            }
            None
        }
        Value::Array(items) => items.iter().find_map(find_tvbox_config_object),
        _ => None,
    }
}

fn parse_repo_inventory(value: &Value) -> Vec<SpiderRepoInventoryItem> {
    let Some(config) = find_tvbox_config_object(value).or_else(|| value.as_object()) else {
        return Vec::new();
    };
    config
        .get("urls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, item)| {
            let url = normalize_text(item.get("url").and_then(Value::as_str));
            if url.is_empty() {
                return None;
            }
            let name = {
                let next = normalize_text(item.get("name").and_then(Value::as_str));
                if next.is_empty() {
                    url.clone()
                } else {
                    next
                }
            };
            Some(SpiderRepoInventoryItem {
                index: index + 1,
                name,
                url,
            })
        })
        .collect()
}

fn parse_site_inventory(value: &Value) -> Result<(String, Vec<SpiderSiteInventoryItem>), String> {
    let Some(config) = find_tvbox_config_object(value) else {
        return Err("TVBox config did not contain a sites array".to_string());
    };

    let root_spider = normalize_text(config.get("spider").and_then(Value::as_str));
    let sites_value = config
        .get("sites")
        .and_then(Value::as_array)
        .ok_or_else(|| "TVBox config did not contain a sites array".to_string())?;

    let mut sites = Vec::new();
    for (index, site_value) in sites_value.iter().enumerate() {
        let raw: RawTvBoxSite = match serde_json::from_value(site_value.clone()) {
            Ok(value) => value,
            Err(_) => continue,
        };

        let key = normalize_text(raw.key.as_deref());
        let api_class = normalize_text(raw.api.as_deref());
        if key.is_empty() || api_class.is_empty() {
            continue;
        }

        let name = {
            let next = normalize_text(raw.name.as_deref());
            if next.is_empty() {
                key.clone()
            } else {
                next
            }
        };
        let site_jar = normalize_text(raw.jar.as_deref());
        let spider_url = if site_jar.is_empty() {
            root_spider.clone()
        } else {
            site_jar.clone()
        };
        let (ext_kind, ext_value) = normalize_site_ext(raw.ext.as_ref());
        let searchable = normalize_bool(raw.searchable.as_ref(), true);
        let quick_search = normalize_bool(raw.quick_search.as_ref(), searchable);
        let filterable = normalize_bool(raw.filterable.as_ref(), false);
        let category_count = raw
            .categories
            .as_ref()
            .map(|items| items.len())
            .unwrap_or(0);

        sites.push(SpiderSiteInventoryItem {
            index: index + 1,
            key,
            name,
            api_class,
            spider_url,
            has_jar_override: !site_jar.is_empty(),
            ext_kind,
            ext_preview: preview_text(&ext_value, 120),
            searchable,
            quick_search,
            filterable,
            category_count,
            ext_input: ext_value,
            first_preset_category: raw
                .categories
                .as_ref()
                .and_then(|items| items.first())
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
        });
    }

    Ok((root_spider, sites))
}

fn site_matches_selector(site: &SpiderSiteInventoryItem, selector: &str) -> bool {
    let needle = selector.trim();
    if needle.is_empty() {
        return false;
    }
    if needle == site.index.to_string() {
        return true;
    }

    let normalized = needle.to_ascii_lowercase();
    site.key == needle
        || site.name == needle
        || site.api_class == needle
        || site.key.to_ascii_lowercase() == normalized
        || site.name.to_ascii_lowercase() == normalized
        || site.api_class.to_ascii_lowercase() == normalized
}

fn repo_matches_selector(repo: &SpiderRepoInventoryItem, selector: &str) -> bool {
    let needle = selector.trim();
    if needle.is_empty() {
        return false;
    }
    if needle == repo.index.to_string() {
        return true;
    }

    let normalized = needle.to_ascii_lowercase();
    repo.url == needle
        || repo.name == needle
        || repo.url.to_ascii_lowercase() == normalized
        || repo.name.to_ascii_lowercase() == normalized
}

fn summarize_payload(payload: &str) -> Result<SpiderPayloadSummary, String> {
    fn value_text(value: &Value) -> Option<String> {
        match value {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            Value::Number(number) => Some(number.to_string()),
            _ => None,
        }
    }

    fn pick_object_text(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
        keys.iter()
            .find_map(|key| object.get(*key).and_then(value_text))
    }

    fn summarize_class_item(item: &Value) -> Option<(String, String)> {
        match item {
            Value::String(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some((trimmed.to_string(), trimmed.to_string()))
                }
            }
            Value::Array(items) => {
                let values = items.iter().filter_map(value_text).collect::<Vec<_>>();
                if values.is_empty() {
                    None
                } else if values.len() == 1 {
                    Some((values[0].clone(), values[0].clone()))
                } else {
                    Some((values[0].clone(), values[1].clone()))
                }
            }
            Value::Object(object) => {
                let type_id = pick_object_text(
                    object,
                    &[
                        "type_id", "typeId", "tid", "id", "type", "tag", "cate_id", "a", "b",
                    ],
                );
                let type_name = pick_object_text(
                    object,
                    &[
                        "type_name",
                        "typeName",
                        "name",
                        "title",
                        "label",
                        "text",
                        "b",
                        "a",
                    ],
                );
                match (type_id, type_name) {
                    (Some(id), Some(name)) => Some((id, name)),
                    (Some(id), None) => Some((id.clone(), id)),
                    (None, Some(name)) => Some((name.clone(), name)),
                    (None, None) => None,
                }
            }
            _ => None,
        }
    }

    fn summarize_vod_item(item: &Value) -> Option<(String, String)> {
        match item {
            Value::Array(items) => {
                let values = items.iter().filter_map(value_text).collect::<Vec<_>>();
                if values.is_empty() {
                    None
                } else {
                    let name = values
                        .iter()
                        .find(|value| {
                            !value.starts_with("http://") && !value.starts_with("https://")
                        })
                        .cloned()
                        .unwrap_or_else(|| values[0].clone());
                    let pic = values
                        .iter()
                        .find(|value| value.starts_with("http://") || value.starts_with("https://"))
                        .cloned()
                        .unwrap_or_default();
                    Some((name, pic))
                }
            }
            Value::Object(object) => {
                let name = pick_object_text(
                    object,
                    &[
                        "vod_name",
                        "vodName",
                        "name",
                        "title",
                        "vod_title",
                        "c",
                        "b",
                    ],
                )
                .or_else(|| pick_object_text(object, &["vod_id", "vodId", "id", "sid", "a"]));
                let pic = pick_object_text(
                    object,
                    &[
                        "vod_pic", "vodPic", "pic", "img", "image", "cover", "thumb", "poster", "d",
                    ],
                )
                .or_else(|| {
                    ["image", "cover", "poster"].iter().find_map(|key| {
                        object
                            .get(*key)
                            .and_then(Value::as_object)
                            .and_then(|nested| {
                                pick_object_text(nested, &["url", "thumb", "src", "image"])
                            })
                    })
                })
                .unwrap_or_default();
                name.map(|resolved| (resolved, pic))
            }
            _ => None,
        }
    }

    let parsed: Value = serde_json::from_str(payload).map_err(|err| err.to_string())?;
    match parsed {
        Value::Object(map) => {
            let class_items = map
                .get("class")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let list_items = map
                .get("list")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let class_summaries = class_items
                .iter()
                .filter_map(summarize_class_item)
                .collect::<Vec<_>>();
            let list_summaries = list_items
                .iter()
                .filter_map(summarize_vod_item)
                .collect::<Vec<_>>();
            let filter_object = map.get("filters").and_then(Value::as_object);
            let fallback_filter_category =
                filter_object.and_then(|items| items.keys().next().cloned());

            let first_category_id = class_summaries
                .first()
                .map(|(type_id, _)| type_id.clone())
                .or(fallback_filter_category.clone());
            let first_category_name = class_summaries
                .first()
                .map(|(_, type_name)| type_name.clone())
                .or(fallback_filter_category);

            Ok(SpiderPayloadSummary {
                payload_kind: "object".to_string(),
                class_count: class_items.len(),
                list_count: list_items.len(),
                filter_count: filter_object.map(|items| items.len()).unwrap_or(0),
                page: map.get("page").and_then(Value::as_i64),
                page_count: map.get("pagecount").and_then(Value::as_i64),
                total: map.get("total").and_then(Value::as_i64),
                first_category_id,
                first_category_name,
                sample_class_names: class_summaries
                    .iter()
                    .map(|(_, type_name)| type_name.clone())
                    .take(5)
                    .collect(),
                sample_vod_names: list_summaries
                    .iter()
                    .map(|(name, _)| name.clone())
                    .take(5)
                    .collect(),
                sample_vod_pics: list_summaries
                    .iter()
                    .map(|(_, pic)| pic.clone())
                    .filter(|value| !value.is_empty())
                    .take(5)
                    .collect(),
            })
        }
        Value::Array(items) => Ok(SpiderPayloadSummary {
            payload_kind: "array".to_string(),
            class_count: 0,
            list_count: items.len(),
            filter_count: 0,
            page: None,
            page_count: None,
            total: None,
            first_category_id: None,
            first_category_name: None,
            sample_class_names: Vec::new(),
            sample_vod_names: Vec::new(),
            sample_vod_pics: Vec::new(),
        }),
        Value::String(text) => Ok(SpiderPayloadSummary {
            payload_kind: "string".to_string(),
            class_count: 0,
            list_count: 0,
            filter_count: 0,
            page: None,
            page_count: None,
            total: None,
            first_category_id: None,
            first_category_name: None,
            sample_class_names: Vec::new(),
            sample_vod_names: vec![preview_text(&text, 80)],
            sample_vod_pics: Vec::new(),
        }),
        other => Ok(SpiderPayloadSummary {
            payload_kind: match other {
                Value::Null => "null",
                Value::Bool(_) => "bool",
                Value::Number(_) => "number",
                _ => "unknown",
            }
            .to_string(),
            class_count: 0,
            list_count: 0,
            filter_count: 0,
            page: None,
            page_count: None,
            total: None,
            first_category_id: None,
            first_category_name: None,
            sample_class_names: Vec::new(),
            sample_vod_names: Vec::new(),
            sample_vod_pics: Vec::new(),
        }),
    }
}

fn build_method_diagnostic(
    site_key: &str,
    result: Result<String, String>,
) -> SpiderMethodDiagnostic {
    let execution_report = get_spider_execution_report(site_key.to_string());
    match result {
        Ok(payload) => {
            let payload_summary = summarize_payload(&payload).ok();
            SpiderMethodDiagnostic {
                ok: true,
                failure_kind: None,
                failure_message: None,
                execution_report,
                payload_summary,
            }
        }
        Err(err) => {
            let (failure_kind, _, _) = crate::spider_cmds_runtime::classify_spider_failure(&err);
            SpiderMethodDiagnostic {
                ok: false,
                failure_kind: Some(failure_kind),
                failure_message: Some(err),
                execution_report,
                payload_summary: None,
            }
        }
    }
}

fn build_contract_method_diagnostic(
    site_key: &str,
    result: Result<NormalizedSpiderMethodResponse, String>,
) -> SpiderMethodDiagnostic {
    match result {
        Ok(response) => {
            let payload_summary = serde_json::to_string(&response.normalized_payload)
                .ok()
                .and_then(|payload| summarize_payload(&payload).ok());
            SpiderMethodDiagnostic {
                ok: true,
                failure_kind: None,
                failure_message: None,
                execution_report: Some(response.report),
                payload_summary,
            }
        }
        Err(err) => {
            let (failure_kind, _, _) = crate::spider_cmds_runtime::classify_spider_failure(&err);
            SpiderMethodDiagnostic {
                ok: false,
                failure_kind: Some(failure_kind),
                failure_message: Some(err),
                execution_report: get_spider_execution_report(site_key.to_string()),
                payload_summary: None,
            }
        }
    }
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn value_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
}

fn object_text(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(value_text))
}

fn extract_first_vod_id_from_value(value: &Value) -> Option<String> {
    let items = value
        .as_object()
        .and_then(|object| object.get("list"))
        .and_then(Value::as_array)?;
    items.iter().find_map(|item| match item {
        Value::Object(object) => object_text(object, &["vod_id", "vodId", "id", "sid", "a"]),
        Value::Array(parts) => parts.first().and_then(value_text),
        _ => None,
    })
}

fn extract_search_keyword_from_value(value: &Value) -> Option<String> {
    let items = value
        .as_object()
        .and_then(|object| object.get("list"))
        .and_then(Value::as_array)?;
    items.iter().find_map(|item| match item {
        Value::Object(object) => object_text(
            object,
            &[
                "vod_name",
                "vodName",
                "name",
                "title",
                "vod_title",
                "c",
                "b",
            ],
        ),
        Value::Array(parts) => parts.iter().find_map(value_text),
        _ => None,
    })
}

fn extract_first_vod_id_from_payload(payload: &str) -> Option<String> {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|value| extract_first_vod_id_from_value(&value))
}

fn extract_search_keyword_from_payload(payload: &str) -> Option<String> {
    serde_json::from_str::<Value>(payload)
        .ok()
        .and_then(|value| extract_search_keyword_from_value(&value))
}

fn extract_header_keys(value: Option<&Value>) -> Vec<String> {
    let mut keys = match value {
        Some(Value::Object(object)) => object
            .keys()
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty())
            .collect::<Vec<_>>(),
        Some(Value::String(text)) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|parsed| match parsed {
                Value::Object(object) => Some(
                    object
                        .keys()
                        .map(|key| key.trim().to_string())
                        .filter(|key| !key.is_empty())
                        .collect::<Vec<_>>(),
                ),
                _ => None,
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    keys.sort();
    keys.dedup();
    keys
}

fn summarize_player_payload_value(value: &Value) -> SpiderPlayerPayloadSummary {
    match value {
        Value::Object(object) => {
            let mut payload_keys = object.keys().cloned().collect::<Vec<_>>();
            payload_keys.sort();
            let mut header_keys = extract_header_keys(object.get("headers"));
            header_keys.extend(extract_header_keys(object.get("header")));
            header_keys.sort();
            header_keys.dedup();

            SpiderPlayerPayloadSummary {
                payload_kind: "object".to_string(),
                payload_keys,
                url: object_text(object, &["url", "playUrl", "parseUrl"]),
                parse: object.get("parse").and_then(value_i64),
                jx: object.get("jx").and_then(value_i64),
                header_keys,
            }
        }
        Value::Array(_) => SpiderPlayerPayloadSummary {
            payload_kind: "array".to_string(),
            payload_keys: Vec::new(),
            url: None,
            parse: None,
            jx: None,
            header_keys: Vec::new(),
        },
        Value::String(text) => SpiderPlayerPayloadSummary {
            payload_kind: "string".to_string(),
            payload_keys: Vec::new(),
            url: Some(preview_text(text, 120)),
            parse: None,
            jx: None,
            header_keys: Vec::new(),
        },
        Value::Bool(_) => SpiderPlayerPayloadSummary {
            payload_kind: "bool".to_string(),
            payload_keys: Vec::new(),
            url: None,
            parse: None,
            jx: None,
            header_keys: Vec::new(),
        },
        Value::Number(number) => SpiderPlayerPayloadSummary {
            payload_kind: "number".to_string(),
            payload_keys: Vec::new(),
            url: Some(number.to_string()),
            parse: None,
            jx: None,
            header_keys: Vec::new(),
        },
        Value::Null => SpiderPlayerPayloadSummary {
            payload_kind: "null".to_string(),
            payload_keys: Vec::new(),
            url: None,
            parse: None,
            jx: None,
            header_keys: Vec::new(),
        },
    }
}

fn extract_first_play_target_from_detail_value(value: &Value) -> Option<(String, String, String)> {
    let detail = value
        .as_object()
        .and_then(|object| object.get("list"))
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_object)?;

    let play_from = object_text(detail, &["vod_play_from", "vodPlayFrom", "playFrom"])?;
    let play_url = object_text(detail, &["vod_play_url", "vodPlayUrl", "playUrl"])?;
    let route_names = play_from.split("$$$").map(str::trim).collect::<Vec<_>>();

    for (index, raw_group) in play_url.split("$$$").enumerate() {
        let route_name = route_names
            .get(index)
            .copied()
            .filter(|value| !value.is_empty())
            .unwrap_or("默认线路");
        for entry in raw_group
            .split('#')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let split_at = entry.find('$');
            let (episode_title, episode_id) = match split_at {
                Some(position) => {
                    let title = entry[..position].trim();
                    let id = entry[position + 1..].trim();
                    (if title.is_empty() { "未命名" } else { title }, id)
                }
                None => ("未命名", entry),
            };
            if !episode_id.is_empty() {
                return Some((
                    route_name.to_string(),
                    episode_title.to_string(),
                    episode_id.to_string(),
                ));
            }
        }
    }

    None
}

fn fallback_search_keyword(site: &SpiderSiteInventoryItem) -> Option<String> {
    [site.name.trim(), site.key.trim()]
        .into_iter()
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn build_player_diagnostic(
    site_key: &str,
    flag: String,
    episode_title: String,
    episode_id: String,
    result: Result<NormalizedSpiderMethodResponse, String>,
) -> SpiderPlayerDiagnostic {
    match result {
        Ok(response) => {
            let payload_summary = summarize_player_payload_value(&response.normalized_payload);
            SpiderPlayerDiagnostic {
                flag,
                episode_title,
                episode_id,
                ok: true,
                failure_kind: None,
                failure_message: None,
                execution_report: Some(response.report),
                raw_payload: Some(response.raw_payload),
                normalized_payload: Some(response.normalized_payload),
                payload_summary: Some(payload_summary),
            }
        }
        Err(err) => {
            let (failure_kind, _, _) = crate::spider_cmds_runtime::classify_spider_failure(&err);
            SpiderPlayerDiagnostic {
                flag,
                episode_title,
                episode_id,
                ok: false,
                failure_kind: Some(failure_kind),
                failure_message: Some(err),
                execution_report: get_spider_execution_report(site_key.to_string()),
                raw_payload: None,
                normalized_payload: None,
                payload_summary: None,
            }
        }
    }
}

fn pick_first_category_id(
    site: &SpiderSiteInventoryItem,
    home: &SpiderMethodDiagnostic,
) -> Option<String> {
    home.payload_summary
        .as_ref()
        .and_then(|summary| summary.first_category_id.clone())
        .or_else(|| site.first_preset_category.clone())
}

async fn diagnose_selected_site(
    app: &AppHandle,
    site: SpiderSiteInventoryItem,
) -> SpiderSiteDiagnostic {
    let ext_input = if site.ext_kind == "empty" {
        String::new()
    } else {
        site.ext_input.clone()
    };

    let prefetch = crate::spider_cmds::prefetch_spider_jar(
        app.clone(),
        site.spider_url.clone(),
        Some(site.api_class.clone()),
    )
    .await;
    let (prefetch_result, prefetch_error) = match prefetch {
        Ok(result) => (Some(result), None),
        Err(err) => (None, Some(err)),
    };

    if prefetch_result.is_none() {
        return SpiderSiteDiagnostic {
            site,
            prefetch: None,
            prefetch_error,
            profile: None,
            home: None,
            category: None,
            search: None,
            detail: None,
            player: None,
        };
    }

    let profile = crate::spider_cmds_profile::profile_spider_site(
        app.clone(),
        site.spider_url.clone(),
        site.key.clone(),
        site.api_class.clone(),
        ext_input.clone(),
    )
    .await;

    let home_result = crate::spider_cmds::spider_home(
        app.clone(),
        site.spider_url.clone(),
        site.key.clone(),
        site.api_class.clone(),
        ext_input.clone(),
    )
    .await;
    let home_search_keyword = home_result
        .as_ref()
        .ok()
        .and_then(|payload| extract_search_keyword_from_payload(payload));
    let home_detail_id = home_result
        .as_ref()
        .ok()
        .and_then(|payload| extract_first_vod_id_from_payload(payload));
    let home = build_method_diagnostic(&site.key, home_result);

    let category_result = if let Some(first_tid) = pick_first_category_id(&site, &home) {
        Some(
            crate::spider_cmds::spider_category(
                app.clone(),
                site.spider_url.clone(),
                site.key.clone(),
                site.api_class.clone(),
                ext_input.clone(),
                first_tid,
                1,
            )
            .await,
        )
    } else {
        None
    };
    let category_search_keyword = category_result
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .and_then(|payload| extract_search_keyword_from_payload(payload));
    let category_detail_id = category_result
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .and_then(|payload| extract_first_vod_id_from_payload(payload));
    let category = category_result.map(|result| build_method_diagnostic(&site.key, result));

    let search_keyword = if site.searchable {
        home_search_keyword
            .or(category_search_keyword)
            .or_else(|| fallback_search_keyword(&site))
    } else {
        None
    };
    let search_result = if let Some(keyword) = search_keyword {
        Some(
            crate::spider_cmds::spider_search_v2(
                app.clone(),
                site.spider_url.clone(),
                site.key.clone(),
                site.api_class.clone(),
                ext_input.clone(),
                keyword,
                site.quick_search,
            )
            .await,
        )
    } else {
        None
    };
    let search_detail_id = search_result
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .and_then(|response| extract_first_vod_id_from_value(&response.normalized_payload));
    let search = search_result.map(|result| build_contract_method_diagnostic(&site.key, result));

    let detail_result = category_detail_id
        .or(home_detail_id)
        .or(search_detail_id)
        .map(|vod_id| {
            crate::spider_cmds::spider_detail_v2(
                app.clone(),
                site.spider_url.clone(),
                site.key.clone(),
                site.api_class.clone(),
                ext_input.clone(),
                vec![vod_id],
            )
        });
    let detail_result = if let Some(result) = detail_result {
        Some(result.await)
    } else {
        None
    };
    let player = if let Some(Ok(detail_response)) = detail_result.as_ref() {
        if let Some((flag, episode_title, episode_id)) =
            extract_first_play_target_from_detail_value(&detail_response.normalized_payload)
        {
            Some(build_player_diagnostic(
                &site.key,
                flag.clone(),
                episode_title.clone(),
                episode_id.clone(),
                crate::spider_cmds::spider_player_v2(
                    app.clone(),
                    site.spider_url.clone(),
                    site.key.clone(),
                    site.api_class.clone(),
                    ext_input.clone(),
                    flag,
                    episode_id,
                    Vec::new(),
                )
                .await,
            ))
        } else {
            None
        }
    } else {
        None
    };
    let detail = detail_result.map(|result| build_contract_method_diagnostic(&site.key, result));

    SpiderSiteDiagnostic {
        site,
        prefetch: prefetch_result,
        prefetch_error,
        profile: Some(profile),
        home: Some(home),
        category,
        search,
        detail,
        player,
    }
}

pub async fn diagnose_spider_source(
    app: &AppHandle,
    source_url: String,
    repo_selector: Option<String>,
    site_selector: Option<String>,
) -> Result<SpiderSourceDiagnostic, String> {
    let root_config_text = crate::media_cmds::fetch_tvbox_config(source_url.clone()).await?;
    let root_parsed: Value = serde_json::from_str(&root_config_text)
        .map_err(|err| format!("Failed to parse normalized TVBox config JSON: {err}"))?;
    let repos = parse_repo_inventory(&root_parsed);

    let selected_repo_url = if repos.is_empty() {
        None
    } else if let Some(selector) = repo_selector.as_ref() {
        Some(
            repos
                .iter()
                .find(|repo| repo_matches_selector(repo, selector))
                .map(|repo| repo.url.clone())
                .ok_or_else(|| format!("Repo selector not found: {selector}"))?,
        )
    } else if site_selector.is_some() || repos.len() == 1 {
        repos.first().map(|repo| repo.url.clone())
    } else {
        None
    };

    let resolved_parsed = if let Some(repo_url) = selected_repo_url.as_ref() {
        let text = crate::media_cmds::fetch_tvbox_config(repo_url.clone()).await?;
        let parsed: Value = serde_json::from_str(&text)
            .map_err(|err| format!("Failed to parse selected repo config JSON: {err}"))?;
        parsed
    } else {
        root_parsed
    };
    let (root_spider, sites) = if repos.is_empty() || selected_repo_url.is_some() {
        parse_site_inventory(&resolved_parsed)?
    } else {
        (String::new(), Vec::new())
    };

    let selected_site = if let Some(selector) = site_selector {
        let site = sites
            .iter()
            .find(|site| site_matches_selector(site, &selector))
            .cloned()
            .ok_or_else(|| format!("Site selector not found: {selector}"))?;
        Some(diagnose_selected_site(app, site).await)
    } else {
        None
    };

    Ok(SpiderSourceDiagnostic {
        source_url,
        selected_repo_url,
        spider_url: root_spider,
        site_count: sites.len(),
        repo_count: repos.len(),
        bridge: build_bridge_inventory(app),
        repos,
        sites,
        selected_site,
    })
}

#[tauri::command]
pub async fn spider_diagnose_source(
    app: tauri::AppHandle,
    source_url: String,
    repo_selector: Option<String>,
    site_selector: Option<String>,
) -> Result<SpiderSourceDiagnostic, String> {
    diagnose_spider_source(&app, source_url, repo_selector, site_selector).await
}

#[cfg(test)]
mod tests {
    use super::{
        extract_first_play_target_from_detail_value, jar_contains_entry, parse_repo_inventory,
        parse_site_inventory, repo_matches_selector, site_matches_selector, summarize_payload,
        summarize_player_payload_value, SpiderRepoInventoryItem, SpiderSiteInventoryItem,
    };
    use serde_json::json;
    use std::io::Write;
    use std::path::Path;

    fn build_test_jar(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn parses_site_inventory_with_root_and_override_jars() {
        let value = json!({
            "spider": "https://example.com/root.jar",
            "sites": [
                {
                    "key": "hot",
                    "name": "热播",
                    "api": "csp_AppRJ",
                    "ext": "https://example.com/ext.txt"
                },
                {
                    "key": "local",
                    "name": "本地",
                    "api": "csp_LocalFile",
                    "jar": "file:///custom.jar",
                    "ext": { "path": "/tmp/demo.json" }
                }
            ]
        });

        let (root_spider, sites) = parse_site_inventory(&value).unwrap();
        assert_eq!(root_spider, "https://example.com/root.jar");
        assert_eq!(sites.len(), 2);
        assert_eq!(sites[0].spider_url, "https://example.com/root.jar");
        assert_eq!(sites[0].ext_kind, "url");
        assert!(sites[0].searchable);
        assert_eq!(sites[1].spider_url, "file:///custom.jar");
        assert!(sites[1].has_jar_override);
        assert_eq!(sites[1].ext_kind, "object");
    }

    #[test]
    fn site_selector_matches_index_and_api_class() {
        let site = SpiderSiteInventoryItem {
            index: 2,
            key: "hot".to_string(),
            name: "热播".to_string(),
            api_class: "csp_AppRJ".to_string(),
            spider_url: "https://example.com/root.jar".to_string(),
            has_jar_override: false,
            ext_kind: "url".to_string(),
            ext_preview: "https://example.com/ext.txt".to_string(),
            searchable: true,
            quick_search: true,
            filterable: false,
            category_count: 0,
            ext_input: "https://example.com/ext.txt".to_string(),
            first_preset_category: None,
        };

        assert!(site_matches_selector(&site, "2"));
        assert!(site_matches_selector(&site, "csp_AppRJ"));
        assert!(site_matches_selector(&site, "热播"));
        assert!(!site_matches_selector(&site, "missing"));
    }

    #[test]
    fn detects_jar_entry_presence() {
        let mut jar_path = std::env::temp_dir();
        jar_path.push(format!(
            "halo-spider-diag-{}.jar",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        build_test_jar(&jar_path, &[("demo/Entry.class", b"classdata")]);
        assert!(jar_contains_entry(&jar_path, "demo/Entry.class"));
        assert!(!jar_contains_entry(&jar_path, "demo/Missing.class"));
        let _ = std::fs::remove_file(&jar_path);
    }

    #[test]
    fn parses_repo_inventory_and_matches_repo_selector() {
        let value = json!({
            "urls": [
                { "name": "首页", "url": "https://example.com/a.json" },
                { "name": "备用", "url": "https://example.com/b.json" }
            ]
        });

        let repos = parse_repo_inventory(&value);
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].name, "首页");
        assert!(repo_matches_selector(&repos[0], "1"));
        assert!(repo_matches_selector(&repos[1], "备用"));
        assert!(repo_matches_selector(
            &SpiderRepoInventoryItem {
                index: 2,
                name: "备用".to_string(),
                url: "https://example.com/b.json".to_string(),
            },
            "https://example.com/b.json"
        ));
    }

    #[test]
    fn summarizes_object_payload_with_categories_and_vods() {
        let summary = summarize_payload(
            r#"{
                "class": [{"type_id":"movie","type_name":"电影"},{"type_id":"tv","type_name":"电视剧"}],
                "list": [{"vod_name":"第一部"},{"vod_name":"第二部"}],
                "filters": {"movie": []},
                "page": 1,
                "pagecount": 9,
                "total": 180
            }"#,
        )
        .unwrap();

        assert_eq!(summary.payload_kind, "object");
        assert_eq!(summary.class_count, 2);
        assert_eq!(summary.list_count, 2);
        assert_eq!(summary.filter_count, 1);
        assert_eq!(summary.first_category_id.as_deref(), Some("movie"));
        assert_eq!(summary.sample_class_names, vec!["电影", "电视剧"]);
        assert_eq!(summary.sample_vod_names, vec!["第一部", "第二部"]);
    }

    #[test]
    fn extracts_first_player_target_from_normalized_detail_payload() {
        let payload = json!({
            "list": [{
                "vod_play_from": "线路A$$$线路B",
                "vod_play_url": "第1集$play-1#第2集$play-2$$$备用$play-b"
            }]
        });

        let target = extract_first_play_target_from_detail_value(&payload).unwrap();
        assert_eq!(
            target,
            (
                "线路A".to_string(),
                "第1集".to_string(),
                "play-1".to_string()
            )
        );
    }

    #[test]
    fn summarizes_player_payload_headers_and_flags() {
        let payload = json!({
            "url": "https://media.example.com/live.m3u8",
            "parse": 1,
            "jx": "0",
            "headers": {
                "User-Agent": "Halo",
                "Referer": "https://example.com"
            },
            "header": "{\"X-Test\":\"1\"}"
        });

        let summary = summarize_player_payload_value(&payload);
        assert_eq!(summary.payload_kind, "object");
        assert_eq!(
            summary.payload_keys,
            vec![
                "header".to_string(),
                "headers".to_string(),
                "jx".to_string(),
                "parse".to_string(),
                "url".to_string()
            ]
        );
        assert_eq!(
            summary.url.as_deref(),
            Some("https://media.example.com/live.m3u8")
        );
        assert_eq!(summary.parse, Some(1));
        assert_eq!(summary.jx, Some(0));
        assert_eq!(
            summary.header_keys,
            vec![
                "Referer".to_string(),
                "User-Agent".to_string(),
                "X-Test".to_string()
            ]
        );
    }
}
