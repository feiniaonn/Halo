use std::collections::HashMap;

use base64::prelude::{Engine as _, BASE64_STANDARD};
use serde_json::{json, Value};

const APP3Q_DEFAULT_BASE_URL: &str = "https://qqqys.com";
const APP3Q_BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const APP3Q_X_CLIENT: &str = "8f3d2a1c7b6e5d4c9a0b1f2e3d4c5b6a";
const APP3Q_WEB_SIGN: &str = "f65f3a83d6d9ad6f";
const APP3Q_SEARCH_LIMIT: &str = "15";

pub(super) async fn try_execute_fast_path(
    site_key: &str,
    ext: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    let config = App3QConfig::from_ext(ext);
    match method {
        "homeContent" => {
            super::append_fast_path_log(site_key, "App3Q", method, "web home");
            let root = request_json(&config, "/api.php/web/index/home", &[]).await?;
            let data = root.get("data").unwrap_or(&root);
            let categories = data
                .get("categories")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut list = map_vod_items(
                data.get("recommend")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            );
            if list.is_empty() {
                for item in &categories {
                    if let Some(videos) = item.get("videos").and_then(Value::as_array) {
                        list.extend(map_vod_items(videos.clone()));
                    }
                }
            }
            let payload = json!({
                "class": map_class_items(categories),
                "filters": {},
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let tid = super::arg_value(args, 0).unwrap_or("").trim();
            let page = super::parse_page_arg(args, 1);
            let filters = super::parse_map_arg(args, 3);
            let mut params = Vec::new();
            if !tid.is_empty() {
                if tid.parse::<u64>().is_ok() {
                    params.push(("type_id", tid.to_string()));
                } else {
                    params.push(("type_name", tid.to_string()));
                }
            }
            params.push(("page", page.to_string()));
            params.push((
                "sort",
                filters
                    .get("sort")
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("hits")
                    .to_string(),
            ));
            for key in ["class", "area", "year"] {
                if let Some(value) = filters
                    .get(key)
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                {
                    params.push((key, value.to_string()));
                }
            }

            super::append_fast_path_log(
                site_key,
                "App3Q",
                method,
                &format!("web category tid={tid} page={page}"),
            );
            let root = request_json(&config, "/api.php/web/filter/vod", &params).await?;
            let list = map_vod_items(
                root.get("data")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            );
            let payload = json!({
                "page": page,
                "pagecount": root.get("pageCount").and_then(Value::as_u64).unwrap_or(page as u64),
                "limit": root.get("limit").and_then(Value::as_u64).unwrap_or(list.len() as u64),
                "total": root.get("total").and_then(Value::as_u64).unwrap_or(list.len() as u64),
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        "searchContent" => {
            let keyword = super::arg_value(args, 0).unwrap_or("").trim();
            if keyword.is_empty() {
                return Ok(Some(json!({ "list": [] }).to_string()));
            }
            super::append_fast_path_log(
                site_key,
                "App3Q",
                method,
                &format!("web search keyword={keyword}"),
            );
            let root = request_json(
                &config,
                "/api.php/web/search/index",
                &[
                    ("wd", keyword.to_string()),
                    ("page", "1".to_string()),
                    ("limit", APP3Q_SEARCH_LIMIT.to_string()),
                ],
            )
            .await?;
            let payload = json!({
                "list": map_vod_items(
                    root.get("data")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                ),
            });
            Ok(Some(payload.to_string()))
        }
        "detailContent" => {
            let Some(vod_id) = decode_first_detail_id(args) else {
                return Ok(None);
            };
            super::append_fast_path_log(
                site_key,
                "App3Q",
                method,
                &format!("web detail vod_id={vod_id}"),
            );
            let root = request_json(
                &config,
                "/api.php/web/vod/get_detail",
                &[("vod_id", vod_id.clone())],
            )
            .await?;
            let Some(item) = root
                .get("data")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .cloned()
            else {
                return Ok(Some(json!({ "list": [] }).to_string()));
            };
            let vodplayer = root
                .get("vodplayer")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let payload = json!({
                "list": [{
                    "vod_id": vod_id,
                    "vod_name": json_string(item.get("vod_name")).unwrap_or_default(),
                    "vod_pic": json_string(item.get("vod_pic")).unwrap_or_default(),
                    "vod_year": json_string(item.get("vod_year")),
                    "vod_area": json_string(item.get("vod_area")),
                    "vod_actor": json_string(item.get("vod_actor")),
                    "vod_director": json_string(item.get("vod_director")),
                    "vod_content": json_string(item.get("vod_content")).map(|value| value.trim().to_string()),
                    "vod_remarks": json_string(item.get("vod_remarks")),
                    "type_name": json_string(item.get("type_name")),
                    "vod_class": json_string(item.get("vod_class")),
                    "vod_play_from": build_play_from(
                        json_string(item.get("vod_play_from")).unwrap_or_default().as_str(),
                        &vodplayer,
                    ),
                    "vod_play_url": build_play_url(
                        json_string(item.get("vod_play_from")).unwrap_or_default().as_str(),
                        json_string(item.get("vod_play_url")).unwrap_or_default().as_str(),
                        &vodplayer,
                        json_string(item.get("vod_name")).unwrap_or_default().as_str(),
                        json_string(item.get("vod_id")).unwrap_or_else(|| vod_id.clone()).as_str(),
                    ),
                }]
            });
            Ok(Some(payload.to_string()))
        }
        "playerContent" => {
            let flag = super::arg_value(args, 0).unwrap_or("").trim();
            let encoded_id = super::arg_value(args, 1).unwrap_or("").trim();
            if encoded_id.is_empty() {
                return Ok(Some(json!({}).to_string()));
            }

            let parts = encoded_id.split('@').collect::<Vec<_>>();
            let target = parts.first().copied().unwrap_or("").trim();
            let source = parts
                .get(1)
                .copied()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(flag);
            let episode_index = parts
                .get(3)
                .copied()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("1");
            let vod_id = parts
                .get(4)
                .copied()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("");

            let headers = player_headers(&config.base_url);
            if looks_like_direct_media_url(target) {
                super::append_fast_path_log(
                    site_key,
                    "App3Q",
                    method,
                    &format!("direct media {}", summarize_url(target)),
                );
                return Ok(Some(build_player_payload(target, headers, false)));
            }

            if let Some(play_page_url) =
                build_site_play_page_url(&config.base_url, vod_id, source, episode_index)
            {
                super::append_fast_path_log(
                    site_key,
                    "App3Q",
                    method,
                    &format!("site play page sid={source} nid={episode_index}"),
                );
                return Ok(Some(build_player_payload(&play_page_url, headers, true)));
            }

            super::append_fast_path_log(
                site_key,
                "App3Q",
                method,
                &format!("token fallback {}", summarize_url(target)),
            );
            Ok(Some(build_player_payload(target, headers, true)))
        }
        _ => Ok(None),
    }
}

struct App3QConfig {
    base_url: String,
}

impl App3QConfig {
    fn from_ext(ext: &str) -> Self {
        Self {
            base_url: resolve_base_url(ext),
        }
    }
}

fn resolve_base_url(ext: &str) -> String {
    let trimmed = ext.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return normalize_base_url(trimmed);
    }
    if !trimmed.is_empty() && (trimmed.starts_with('{') || trimmed.starts_with('[')) {
        if let Ok(value) = super::parse_ext_json(trimmed) {
            if let Some(base_url) = value
                .as_object()
                .and_then(|object| object.get("url").or_else(|| object.get("site")))
                .and_then(|value| json_string(Some(value)))
            {
                return normalize_base_url(&base_url);
            }
        }
    }
    APP3Q_DEFAULT_BASE_URL.to_string()
}

fn normalize_base_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

async fn request_json(
    config: &App3QConfig,
    path: &str,
    params: &[(&str, String)],
) -> Result<Value, String> {
    let url = build_endpoint_url(&config.base_url, path, params)?;
    let payload = super::fetch_json_value(&url, Some(web_headers(&config.base_url))).await?;
    let code = payload.get("code").and_then(Value::as_i64).unwrap_or(200);
    if code != 200 {
        return Err(format!(
            "App3Q fast-path request failed for {url}: code={code} msg={}",
            json_string(payload.get("msg")).unwrap_or_default()
        ));
    }
    Ok(payload)
}

fn build_endpoint_url(
    base_url: &str,
    path: &str,
    params: &[(&str, String)],
) -> Result<String, String> {
    let full = format!("{}{}", normalize_base_url(base_url), path);
    let mut url = url::Url::parse(&full)
        .map_err(|err| format!("App3Q fast-path invalid url {full}: {err}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in params {
            let normalized = value.trim();
            if normalized.is_empty() {
                continue;
            }
            query.append_pair(key, normalized);
        }
    }
    Ok(url.to_string())
}

fn web_headers(base_url: &str) -> HashMap<String, String> {
    HashMap::from([
        ("Accept".to_string(), "application/json".to_string()),
        ("User-Agent".to_string(), APP3Q_BROWSER_UA.to_string()),
        (
            "Referer".to_string(),
            format!("{}/", normalize_base_url(base_url)),
        ),
        ("X-Client".to_string(), APP3Q_X_CLIENT.to_string()),
        ("web-sign".to_string(), APP3Q_WEB_SIGN.to_string()),
    ])
}

fn player_headers(base_url: &str) -> HashMap<String, String> {
    let normalized = normalize_base_url(base_url);
    HashMap::from([
        ("Accept".to_string(), "*/*".to_string()),
        ("User-Agent".to_string(), APP3Q_BROWSER_UA.to_string()),
        ("Referer".to_string(), format!("{normalized}/")),
        ("Origin".to_string(), normalized),
    ])
}

fn map_class_items(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let type_id = json_string(object.get("type_id"))
                .or_else(|| json_string(object.get("type_name")))?;
            let type_name = json_string(object.get("type_name")).unwrap_or_else(|| type_id.clone());
            Some(json!({
                "type_id": type_id,
                "type_name": type_name,
            }))
        })
        .collect()
}

fn map_vod_items(items: Vec<Value>) -> Vec<Value> {
    items
        .into_iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let vod_id = json_string(object.get("vod_id"))
                .or_else(|| json_string(object.get("vod_name")))?;
            let vod_name = json_string(object.get("vod_name")).unwrap_or_else(|| vod_id.clone());
            Some(json!({
                "vod_id": vod_id,
                "vod_name": vod_name,
                "vod_pic": json_string(object.get("vod_pic")).unwrap_or_default(),
                "vod_remarks": json_string(object.get("vod_remarks")).unwrap_or_default(),
            }))
        })
        .collect()
}

fn decode_first_detail_id(args: &[(&str, String)]) -> Option<String> {
    let raw = super::arg_value(args, 0)?.trim();
    let encoded = raw.split(',').find(|value| !value.trim().is_empty())?;
    let bytes = BASE64_STANDARD.decode(encoded.trim()).ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    let trimmed = decoded.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn build_play_from(raw_play_from: &str, vodplayer: &[Value]) -> String {
    let aliases = read_source_aliases(vodplayer);
    raw_play_from
        .split("$$$")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|source| {
            aliases
                .get(source)
                .cloned()
                .unwrap_or_else(|| source.to_string())
        })
        .collect::<Vec<_>>()
        .join("$$$")
}

fn build_play_url(
    raw_play_from: &str,
    raw_play_url: &str,
    _vodplayer: &[Value],
    vod_name: &str,
    vod_id: &str,
) -> String {
    let sources = raw_play_from
        .split("$$$")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    raw_play_url
        .split("$$$")
        .enumerate()
        .filter_map(|(group_index, group)| {
            let source = sources.get(group_index).copied().unwrap_or("");
            let encoded_group = group
                .split('#')
                .enumerate()
                .filter_map(|(episode_index, episode)| {
                    let (title, token) = episode.split_once('$')?;
                    let normalized_title = title.trim();
                    let normalized_token = token.trim();
                    if normalized_title.is_empty() || normalized_token.is_empty() {
                        return None;
                    }
                    let index = extract_episode_index(normalized_title, episode_index + 1);
                    Some(format!(
                        "{}${}@{}@{}@{}@{}",
                        normalized_title,
                        normalized_token,
                        source,
                        vod_name.trim(),
                        index,
                        vod_id.trim(),
                    ))
                })
                .collect::<Vec<_>>()
                .join("#");
            (!encoded_group.is_empty()).then_some(encoded_group)
        })
        .collect::<Vec<_>>()
        .join("$$$")
}

fn read_source_aliases(vodplayer: &[Value]) -> HashMap<String, String> {
    vodplayer
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let from = json_string(object.get("from"))?;
            let show = json_string(object.get("show")).unwrap_or_else(|| from.clone());
            Some((from, show))
        })
        .collect()
}

fn extract_episode_index(title: &str, fallback: usize) -> String {
    let digits = title
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if let Ok(index) = digits.parse::<u32>() {
        return index.max(1).to_string();
    }
    fallback.max(1).to_string()
}

fn build_site_play_page_url(
    base_url: &str,
    vod_id: &str,
    source: &str,
    episode_index: &str,
) -> Option<String> {
    let normalized_vod_id = vod_id.trim();
    let normalized_source = source.trim();
    if normalized_vod_id.is_empty() || normalized_source.is_empty() {
        return None;
    }
    let nid = episode_index
        .trim()
        .parse::<u32>()
        .map(|value| value.max(1))
        .unwrap_or(1);
    Some(format!(
        "{}/play/{}#sid={}&nid={}",
        normalize_base_url(base_url),
        normalized_vod_id,
        normalized_source,
        nid,
    ))
}

fn looks_like_direct_media_url(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized.starts_with("http")
        && (normalized.contains(".m3u8")
            || normalized.contains(".mp4")
            || normalized.contains(".flv")
            || normalized.contains(".mpd")
            || normalized.contains(".m4s")
            || normalized.contains(".ts")
            || normalized.contains("mime=video")
            || normalized.contains("contenttype=video")
            || normalized.contains("type=m3u8")
            || normalized.contains("type=mp4"))
}

fn build_player_payload(url: &str, headers: HashMap<String, String>, force_parse: bool) -> String {
    json!({
        "parse": if force_parse { 1 } else { 0 },
        "jx": 0,
        "url": url.trim(),
        "header": headers,
    })
    .to_string()
}

fn summarize_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 96 {
        return trimmed.to_string();
    }
    format!("{}...", &trimmed[..96])
}

fn json_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(if *flag {
            "true".to_string()
        } else {
            "false".to_string()
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{build_site_play_page_url, extract_episode_index};

    #[test]
    fn builds_site_play_page_url_with_sid_and_nid() {
        let url = build_site_play_page_url("https://qqqys.com", "88894", "YYNB", "01");
        assert_eq!(
            url.as_deref(),
            Some("https://qqqys.com/play/88894#sid=YYNB&nid=1")
        );
    }

    #[test]
    fn extracts_episode_index_from_chinese_title() {
        assert_eq!(extract_episode_index("第03集", 1), "3");
        assert_eq!(extract_episode_index("SP", 7), "7");
    }
}
