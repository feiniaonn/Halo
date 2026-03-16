use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

use aes::Aes128;
use base64::prelude::{Engine as _, BASE64_STANDARD};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use serde_json::{json, Map, Value};

type Aes128CbcDec = cbc::Decryptor<Aes128>;

static APPQI_HOME_CACHE: LazyLock<Mutex<HashMap<String, HashMap<String, Vec<Value>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) async fn try_execute_fast_path(
    site_key: &str,
    ext: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    let config = AppQiConfig::from_ext(ext).await?;
    match method {
        "homeContent" => {
            super::append_fast_path_log(site_key, "AppQi", method, "desktop-direct home");
            let root = request_payload(
                &config,
                &format!("/qijiappapi.index/{}", config.init_method),
                "{}",
            )
            .await?;
            store_category_cache(
                site_key,
                &config.base_url,
                root.get("type_list"),
                root.get("recommend_list"),
            );
            let payload = json!({
                "class": build_class_items(root.get("type_list")),
                "filters": build_filter_map(root.get("type_list")),
                "list": build_vod_list(root.get("recommend_list")),
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let tid = super::arg_value(args, 0).unwrap_or("0").trim();
            let page = super::parse_page_arg(args, 1);
            let filters = super::parse_map_arg(args, 3);
            if let Some(cached_list) =
                seed_or_cached_category_list(site_key, &config, tid, page, &filters).await?
            {
                super::append_fast_path_log(
                    site_key,
                    "AppQi",
                    method,
                    &format!("desktop-direct seeded-category tid={tid} page={page}"),
                );
                let payload = json!({
                    "page": page,
                    "pagecount": 1,
                    "limit": cached_list.len(),
                    "total": cached_list.len(),
                    "list": cached_list,
                });
                return Ok(Some(payload.to_string()));
            }
            super::append_fast_path_log(
                site_key,
                "AppQi",
                method,
                &format!("desktop-direct tid={tid} page={page}"),
            );
            let root = request_payload(
                &config,
                &format!("/qijiappapi.index/typeFilterVodList?page={page}"),
                &build_category_body(tid, page, &filters),
            )
            .await?;
            let payload = json!({
                "page": page,
                "pagecount": root.get("pagecount").and_then(Value::as_u64).unwrap_or(page as u64),
                "limit": build_vod_list(root.get("recommend_list")).len(),
                "total": root.get("total").and_then(Value::as_u64).unwrap_or(0),
                "list": build_vod_list(root.get("recommend_list")),
            });
            Ok(Some(payload.to_string()))
        }
        "searchContent" => {
            let keywords = super::arg_value(args, 0).unwrap_or("").trim();
            if keywords.is_empty() {
                return Ok(Some(json!({ "list": [] }).to_string()));
            }
            super::append_fast_path_log(
                site_key,
                "AppQi",
                method,
                &format!("desktop-direct keywords={keywords}"),
            );
            let root = request_payload(
                &config,
                &format!("/qijiappapi.index/{}", config.search_method),
                &json!({
                    "type_id": 0,
                    "keywords": keywords,
                    "page": 1,
                })
                .to_string(),
            )
            .await?;
            let payload = json!({
                "list": build_vod_list(root.get("search_list")),
            });
            Ok(Some(payload.to_string()))
        }
        _ => Ok(None),
    }
}

struct AppQiConfig {
    base_url: String,
    data_key: String,
    data_iv: String,
    init_method: String,
    search_method: String,
    user_agent: String,
    device_id: String,
    version: String,
}

impl AppQiConfig {
    async fn from_ext(ext: &str) -> Result<Self, String> {
        let value = super::parse_ext_json(ext)?;
        let map = value
            .as_object()
            .ok_or_else(|| "AppQi fast-path requires object ext".to_string())?;
        let base_url = resolve_base_url(map)
            .await?
            .ok_or_else(|| "AppQi fast-path ext missing url/site".to_string())?;
        let data_key = pick_map_string(map, &["dataKey"])
            .ok_or_else(|| "AppQi fast-path ext missing dataKey".to_string())?;
        let data_iv = pick_map_string(map, &["dataIv"])
            .ok_or_else(|| "AppQi fast-path ext missing dataIv".to_string())?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            data_key,
            data_iv,
            init_method: pick_map_string(map, &["init"]).unwrap_or_else(|| "initV120".to_string()),
            search_method: pick_map_string(map, &["search"])
                .unwrap_or_else(|| "searchList".to_string()),
            user_agent: pick_map_string(map, &["ua"])
                .unwrap_or_else(|| "okhttp/3.14.9".to_string()),
            device_id: pick_map_string(map, &["deviceId"]).unwrap_or_default(),
            version: pick_map_string(map, &["version"]).unwrap_or_default(),
        })
    }

    fn headers(&self) -> HashMap<String, String> {
        let mut headers = HashMap::from([
            (
                "Content-Type".to_string(),
                "application/x-www-form-urlencoded".to_string(),
            ),
            ("User-Agent".to_string(), self.user_agent.clone()),
            ("app-ui-mode".to_string(), "light".to_string()),
            (
                "app-api-verify-time".to_string(),
                (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs())
                    .unwrap_or_default())
                .to_string(),
            ),
        ]);
        headers.insert("app-user-device-id".to_string(), self.device_id.clone());
        headers.insert("app-version-code".to_string(), self.version.clone());
        headers
    }
}

async fn resolve_base_url(map: &Map<String, Value>) -> Result<Option<String>, String> {
    if let Some(url) = pick_map_string(map, &["url"]) {
        return Ok(Some(url));
    }

    let Some(site_url) = pick_map_string(map, &["site"]) else {
        return Ok(None);
    };
    let body = super::fetch_text_value(&site_url, None).await?;
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "AppQi fast-path remote site config empty: {site_url}"
        ));
    }
    if trimmed.starts_with('{') {
        let value = super::parse_json_value_loose(trimmed)
            .map_err(|err| format!("AppQi fast-path invalid site config for {site_url}: {err}"))?;
        if let Some(object) = value.as_object() {
            return Ok(pick_map_string(object, &["url", "site"]));
        }
    }
    Ok(Some(
        trimmed.lines().next().unwrap_or(trimmed).trim().to_string(),
    ))
}

async fn request_payload(config: &AppQiConfig, path: &str, body: &str) -> Result<Value, String> {
    let url = format!("{}{}", config.base_url, normalize_api_path(path));
    let resolved = crate::media_cmds::resolve_media_request(&url, Some(config.headers()));
    let client = crate::media_cmds::build_transport_client(
        &resolved,
        true,
        std::time::Duration::from_secs(15),
    )?;
    let request = crate::media_cmds::apply_request_headers(
        client.post(&resolved.url).body(body.to_string()),
        &resolved.headers,
    );
    let response = request
        .send()
        .await
        .map_err(|err| format!("AppQi fast-path request failed for {url}: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("AppQi fast-path response read failed for {url}: {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "AppQi fast-path request failed for {url}: HTTP {}",
            status.as_u16()
        ));
    }

    let envelope = super::parse_json_value_loose(&body)
        .map_err(|err| format!("AppQi fast-path invalid envelope for {url}: {err}"))?;
    let Some(data_value) = envelope.get("data") else {
        return Ok(envelope);
    };
    if let Some(text) = super::stringify_json_value(data_value) {
        let decrypted = decrypt_payload(&text, &config.data_key, &config.data_iv)?;
        return super::parse_json_value_loose(&decrypted)
            .map_err(|err| format!("AppQi fast-path invalid decrypted payload for {url}: {err}"));
    }
    Ok(data_value.clone())
}

fn normalize_api_path(path: &str) -> String {
    if path.starts_with("/api.php") {
        path.to_string()
    } else {
        format!("/api.php{}", path)
    }
}

fn decrypt_payload(data: &str, key: &str, iv: &str) -> Result<String, String> {
    let mut bytes = BASE64_STANDARD
        .decode(data.trim())
        .map_err(|err| format!("AppQi fast-path base64 decode failed: {err}"))?;
    let cipher = Aes128CbcDec::new_from_slices(key.as_bytes(), iv.as_bytes())
        .map_err(|err| format!("AppQi fast-path cipher init failed: {err}"))?;
    let decrypted = cipher
        .decrypt_padded_mut::<Pkcs7>(&mut bytes)
        .map_err(|err| format!("AppQi fast-path decrypt failed: {err}"))?;
    String::from_utf8(decrypted.to_vec())
        .map_err(|err| format!("AppQi fast-path UTF-8 decode failed: {err}"))
}

fn build_category_body(tid: &str, page: u32, filters: &HashMap<String, String>) -> String {
    let mut object = Map::new();
    object.insert(
        "type_id".to_string(),
        tid.trim()
            .parse::<i64>()
            .map(Value::from)
            .unwrap_or_else(|_| Value::String(tid.to_string())),
    );
    object.insert("page".to_string(), json!(page));
    for key in ["class", "lang", "area", "year", "sort"] {
        if let Some(value) = filters.get(key).filter(|value| !value.trim().is_empty()) {
            object.insert(key.to_string(), Value::String(value.trim().to_string()));
        }
    }
    Value::Object(object).to_string()
}

async fn seed_or_cached_category_list(
    site_key: &str,
    config: &AppQiConfig,
    tid: &str,
    page: u32,
    filters: &HashMap<String, String>,
) -> Result<Option<Vec<Value>>, String> {
    if page != 1 || has_active_filters(filters) {
        return Ok(None);
    }
    if let Some(cached) = cached_category_list(site_key, &config.base_url, tid, page, filters) {
        return Ok(Some(cached));
    }
    let root = request_payload(
        config,
        &format!("/qijiappapi.index/{}", config.init_method),
        "{}",
    )
    .await?;
    store_category_cache(
        site_key,
        &config.base_url,
        root.get("type_list"),
        root.get("recommend_list"),
    );
    Ok(cached_category_list(
        site_key,
        &config.base_url,
        tid,
        page,
        filters,
    ))
}

fn store_category_cache(
    site_key: &str,
    base_url: &str,
    value: Option<&Value>,
    root_recommend_list: Option<&Value>,
) {
    let cache_key = cache_key(site_key, base_url);
    let category_map = build_category_cache(value, root_recommend_list);
    if let Ok(mut cache) = APPQI_HOME_CACHE.lock() {
        if category_map.is_empty() {
            cache.remove(&cache_key);
        } else {
            cache.insert(cache_key, category_map);
        }
    }
}

fn cached_category_list(
    site_key: &str,
    base_url: &str,
    tid: &str,
    page: u32,
    filters: &HashMap<String, String>,
) -> Option<Vec<Value>> {
    if page != 1 || has_active_filters(filters) {
        return None;
    }
    APPQI_HOME_CACHE
        .lock()
        .ok()?
        .get(&cache_key(site_key, base_url))?
        .get(tid.trim())
        .cloned()
}

fn build_category_cache(
    value: Option<&Value>,
    root_recommend_list: Option<&Value>,
) -> HashMap<String, Vec<Value>> {
    let mut result: HashMap<String, Vec<Value>> = value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let type_id = pick_map_string(object, &["type_id"])?;
            let recommend_list = build_vod_list(object.get("recommend_list"));
            if recommend_list.is_empty() {
                return None;
            }
            Some((type_id, recommend_list))
        })
        .collect();

    let root_list = build_vod_list(root_recommend_list);
    if !root_list.is_empty() {
        result.entry("0".to_string()).or_insert(root_list);
    }

    result
}

fn has_active_filters(filters: &HashMap<String, String>) -> bool {
    filters
        .iter()
        .any(|(_, value)| !value.trim().is_empty() && value.trim() != "全部")
}

fn cache_key(site_key: &str, base_url: &str) -> String {
    let _ = site_key;
    base_url.to_string()
}

fn build_class_items(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let type_id = pick_map_string(object, &["type_id"])
                .or_else(|| pick_map_string(object, &["type_name"]))?;
            let type_name =
                pick_map_string(object, &["type_name"]).unwrap_or_else(|| type_id.clone());
            Some(json!({
                "type_id": type_id,
                "type_name": type_name,
            }))
        })
        .collect()
}

fn build_filter_map(value: Option<&Value>) -> Value {
    let mut result = Map::new();
    for entry in value.and_then(Value::as_array).into_iter().flatten() {
        let Some(object) = entry.as_object() else {
            continue;
        };
        let Some(type_id) = pick_map_string(object, &["type_id"]) else {
            continue;
        };
        let Some(filter_items) = object.get("filter_type_list").and_then(Value::as_array) else {
            continue;
        };
        let normalized = filter_items
            .iter()
            .filter_map(|item| {
                let source = item.as_object()?;
                let key = pick_map_string(source, &["name"])?;
                if !matches!(key.as_str(), "class" | "area" | "lang" | "year" | "sort") {
                    return None;
                }
                let values = source
                    .get("list")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(super::stringify_json_value)
                    .map(|value| json!({ "name": value, "value": value }))
                    .collect::<Vec<_>>();
                if values.is_empty() {
                    return None;
                }
                Some(json!({
                    "key": key,
                    "name": key,
                    "value": values,
                }))
            })
            .collect::<Vec<_>>();
        if !normalized.is_empty() {
            result.insert(type_id, Value::Array(normalized));
        }
    }
    Value::Object(result)
}

fn build_vod_list(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let vod_id = pick_map_string(object, &["vod_id", "vodId", "id", "ids", "sid", "nextlink", "url"])
                .or_else(|| pick_map_string(object, &["vod_name", "name", "title"]))?;
            let vod_name = pick_map_string(object, &["vod_name", "vodName", "name", "title"])
                .unwrap_or_else(|| vod_id.clone());
            Some(json!({
                "vod_id": vod_id,
                "vod_name": vod_name,
                "vod_pic": pick_map_string(object, &["vod_pic", "vodPic", "pic", "img", "image", "cover", "thumb", "poster"]).unwrap_or_default(),
                "vod_remarks": pick_map_string(object, &["vod_remarks", "vodRemarks", "remarks", "remark", "note", "detailMemo", "conerMemo"]).unwrap_or_default(),
            }))
        })
        .collect()
}

fn pick_map_string(map: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(super::stringify_json_value)
}

#[cfg(test)]
mod tests {
    use super::{
        build_category_body, build_category_cache, build_class_items, build_filter_map,
        cached_category_list, decrypt_payload, store_category_cache,
    };
    use aes::Aes128;
    use base64::prelude::{Engine as _, BASE64_STANDARD};
    use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
    use serde_json::json;
    use std::collections::HashMap;

    type Aes128CbcEnc = cbc::Encryptor<Aes128>;

    #[test]
    fn decrypts_appqi_payload() {
        let key = "123456789abcdefg";
        let iv = "123456789abcdefg";
        let payload = "{\"type_list\":[{\"type_id\":0,\"type_name\":\"电影\"}]}";
        let mut buffer = vec![0u8; payload.len() + 16];
        buffer[..payload.len()].copy_from_slice(payload.as_bytes());
        let encrypted = Aes128CbcEnc::new_from_slices(key.as_bytes(), iv.as_bytes())
            .expect("cipher")
            .encrypt_padded_mut::<Pkcs7>(&mut buffer, payload.len())
            .expect("encrypt")
            .to_vec();
        let encoded = BASE64_STANDARD.encode(encrypted);
        let decrypted = decrypt_payload(&encoded, key, iv).expect("decrypt");
        assert_eq!(decrypted, payload);
    }

    #[test]
    fn preserves_numeric_appqi_type_ids() {
        let payload = json!([
            {
                "type_id": 0,
                "type_name": "电影",
                "filter_type_list": [
                    { "name": "year", "list": [2025, 2024] }
                ]
            }
        ]);
        let classes = build_class_items(Some(&payload));
        let filters = build_filter_map(Some(&payload));
        assert_eq!(classes[0]["type_id"], "0");
        assert_eq!(classes[0]["type_name"], "电影");
        assert_eq!(filters["0"][0]["value"][0]["value"], "2025");
    }

    #[test]
    fn sends_numeric_type_id_when_possible() {
        let body = build_category_body("2", 1, &std::collections::HashMap::new());
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("json");
        assert_eq!(parsed["type_id"], 2);
        assert_eq!(parsed["page"], 1);
    }

    #[test]
    fn builds_category_cache_from_home_type_list() {
        let payload = json!([
            {
                "type_id": 2,
                "recommend_list": [
                    { "vod_id": 101, "vod_name": "剧一" }
                ]
            },
            {
                "type_id": 3,
                "recommend_list": [
                    { "vod_id": 202, "vod_name": "综一" }
                ]
            }
        ]);
        let cache = build_category_cache(Some(&payload), None);
        assert_eq!(cache["2"][0]["vod_id"], "101");
        assert_eq!(cache["3"][0]["vod_name"], "综一");
    }

    #[test]
    fn uses_cached_category_lists_on_first_page_without_filters() {
        let payload = json!([
            {
                "type_id": 2,
                "recommend_list": [
                    { "vod_id": 101, "vod_name": "剧一" }
                ]
            }
        ]);
        store_category_cache("csp_appqi", "http://example.com", Some(&payload), None);
        let cached =
            cached_category_list("csp_appqi", "http://example.com", "2", 1, &HashMap::new())
                .expect("cached list");
        assert_eq!(cached[0]["vod_name"], "剧一");
    }

    #[test]
    fn skips_cached_category_lists_when_filters_are_active() {
        let payload = json!([
            {
                "type_id": 2,
                "recommend_list": [
                    { "vod_id": 101, "vod_name": "剧一" }
                ]
            }
        ]);
        store_category_cache(
            "csp_appqi_filter",
            "http://example.com",
            Some(&payload),
            None,
        );
        let mut filters = HashMap::new();
        filters.insert("class".to_string(), "古装".to_string());
        let cached =
            cached_category_list("csp_appqi_filter", "http://example.com", "2", 1, &filters);
        assert!(cached.is_none());
    }

    #[test]
    fn fills_all_category_from_root_recommend_list() {
        let payload = json!([
            {
                "type_id": 2,
                "recommend_list": [
                    { "vod_id": 101, "vod_name": "鍓т竴" }
                ]
            }
        ]);
        let root = json!([
            { "vod_id": 999, "vod_name": "棣栭〉涓€" }
        ]);
        let cache = build_category_cache(Some(&payload), Some(&root));
        assert_eq!(cache["0"][0]["vod_name"], "棣栭〉涓€");
    }
}
