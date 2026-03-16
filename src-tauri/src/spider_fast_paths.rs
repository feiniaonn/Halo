use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Map, Value};

mod app3q;
mod appqi;

const DOUBAN_COUNT: u32 = 20;
const DOUBAN_API_KEY: &str = "0ac44ae016490db2204ce0a042db2916";
const DOUBAN_HOME_SEED_URL: &str =
    "https://frodo.douban.com/api/v2/movie/hot_gaia?apikey=0ac44ae016490db2204ce0a042db2916&sort=recommend&area=%E5%85%A8%E9%83%A8&start=0&count=20";
const BILI_DEFAULT_COOKIE: &str = "buvid3=84B0395D-C9F2-C490-E92E-A09AB48FE26E71636infoc";

static BILI_CATALOG_CACHE: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();

fn bili_catalog_cache() -> &'static Mutex<HashMap<String, Value>> {
    BILI_CATALOG_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) async fn try_execute_fast_path(
    site_key: &str,
    api_class: &str,
    ext: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    let normalized = api_class.trim().to_ascii_lowercase();
    if normalized.contains("douban") {
        return try_execute_douban_fast_path(site_key, method, args).await;
    }
    if normalized.contains("app3q") {
        return app3q::try_execute_fast_path(site_key, ext, method, args).await;
    }
    if normalized.contains("appqi") {
        return appqi::try_execute_fast_path(site_key, ext, method, args).await;
    }
    if normalized.contains("biliys") {
        return try_execute_biliys_fast_path(site_key, ext, method, args).await;
    }
    if normalized.contains("xbpq") {
        return try_execute_xbpq_fast_path(site_key, ext, method, args).await;
    }
    Ok(None)
}

async fn try_execute_douban_fast_path(
    site_key: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    match method {
        "homeContent" => {
            append_fast_path_log(site_key, "Douban", method, "using Frodo home seed");
            let response = fetch_json_value(DOUBAN_HOME_SEED_URL, Some(douban_headers())).await?;
            let list = response
                .get("items")
                .and_then(Value::as_array)
                .map(|items| map_douban_items(items))
                .unwrap_or_default();
            let payload = json!({
                "class": douban_home_categories(),
                "filters": {},
                "list": list
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let tid = arg_value(args, 0).unwrap_or("hot_gaia").trim();
            if tid.eq_ignore_ascii_case("anime_hot") {
                return Ok(None);
            }

            let page = parse_page_arg(args, 1);
            let filters = parse_map_arg(args, 3);
            let start = (page.saturating_sub(1)) * DOUBAN_COUNT;
            let (url, list_key) = build_douban_category_request(tid, start, &filters);
            append_fast_path_log(site_key, "Douban", method, &format!("requesting {tid}"));
            let response = fetch_json_value(&url, Some(douban_headers())).await?;
            let list = response
                .get(list_key)
                .and_then(Value::as_array)
                .map(|items| map_douban_items(items))
                .unwrap_or_default();
            let payload = json!({
                "page": page,
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        _ => Ok(None),
    }
}

async fn try_execute_biliys_fast_path(
    site_key: &str,
    ext: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    match method {
        "homeContent" => {
            let catalog = load_bili_catalog(ext).await?;
            let classes = catalog
                .get("class")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let filters = catalog
                .get("filters")
                .cloned()
                .unwrap_or_else(|| Value::Object(Map::new()));
            let first_tid = classes
                .first()
                .and_then(|item| item.get("type_id"))
                .and_then(stringify_json_value);
            let list = if let Some(tid) = first_tid {
                append_fast_path_log(site_key, "BiliYS", method, "seeding first category");
                fetch_bili_category_payload(&tid, 1, &HashMap::new())
                    .await
                    .map(|payload| payload.0)?
            } else {
                Vec::new()
            };
            let payload = json!({
                "class": classes,
                "filters": filters,
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let tid = arg_value(args, 0).unwrap_or("1").trim();
            let page = parse_page_arg(args, 1);
            let filters = parse_map_arg(args, 3);
            append_fast_path_log(site_key, "BiliYS", method, &format!("requesting tid={tid}"));
            let (list, total) = fetch_bili_category_payload(tid, page, &filters).await?;
            let payload = json!({
                "page": page,
                "pagecount": if total > 0 { total.div_ceil(20) } else { 0 },
                "limit": 20,
                "total": total,
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        _ => Ok(None),
    }
}

const RULE_UNKNOWN_PAGECOUNT: u32 = 2_147_483_647;
const RULE_MOBILE_UA: &str = "Mozilla/5.0 (Linux; Android 11; Ghxi Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/76.0.3809.89 Mobile Safari/537.36";

async fn try_execute_xbpq_fast_path(
    site_key: &str,
    ext: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    let config = load_rule_config(ext).await?;
    let classes = parse_rule_categories(&config);
    if classes.is_empty() {
        return Err("XBPQ fast-path rule config did not expose categories".to_string());
    }

    match method {
        "homeContent" => {
            let first_tid = classes
                .first()
                .and_then(|item| item.get("type_id"))
                .and_then(stringify_json_value)
                .unwrap_or_else(|| "1".to_string());
            append_fast_path_log(
                site_key,
                "XBPQ",
                method,
                "seeding first category from rule config",
            );
            let list = fetch_rule_category_payload(&config, &first_tid, 1, &HashMap::new()).await?;
            let payload = json!({
                "class": classes,
                "filters": {},
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let fallback_tid = classes
                .first()
                .and_then(|item| item.get("type_id"))
                .and_then(stringify_json_value)
                .unwrap_or_else(|| "1".to_string());
            let tid = arg_value(args, 0).unwrap_or(&fallback_tid).trim();
            let page = parse_page_arg(args, 1);
            let filters = parse_map_arg(args, 3);
            append_fast_path_log(
                site_key,
                "XBPQ",
                method,
                &format!("requesting tid={tid} page={page}"),
            );
            let list = fetch_rule_category_payload(&config, tid, page, &filters).await?;
            let payload = json!({
                "page": page,
                "pagecount": RULE_UNKNOWN_PAGECOUNT,
                "limit": list.len(),
                "total": RULE_UNKNOWN_PAGECOUNT,
                "list": list,
            });
            Ok(Some(payload.to_string()))
        }
        _ => Ok(None),
    }
}

async fn load_rule_config(ext: &str) -> Result<Value, String> {
    let trimmed = ext.trim();
    if trimmed.is_empty() {
        return Err("empty rule config ext".to_string());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let body = fetch_text_value(trimmed, None).await?;
        return parse_json_value_loose(&body)
            .map_err(|err| format!("invalid remote rule config for {trimmed}: {err}"));
    }
    parse_ext_json(trimmed)
}

fn parse_rule_categories(config: &Value) -> Vec<Value> {
    if let Some(raw) = config_string(config, &["\u{5206}\u{7c7b}", "class_name"]) {
        let separator = if raw.contains('#') { '#' } else { '&' };
        let values = raw
            .split(separator)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        if raw.contains('$') {
            return values
                .into_iter()
                .filter_map(|item| {
                    let (name, id) = item.split_once('$')?;
                    Some(json!({
                        "type_id": id.trim(),
                        "type_name": name.trim(),
                    }))
                })
                .collect();
        }

        if let Some(ids_raw) = config_string(config, &["\u{5206}\u{7c7b}\u{503c}", "class_url"]) {
            let ids = ids_raw
                .split(separator)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            return values
                .iter()
                .enumerate()
                .map(|(index, name)| {
                    json!({
                        "type_id": ids.get(index).copied().unwrap_or(*name),
                        "type_name": *name,
                    })
                })
                .collect();
        }
    }
    Vec::new()
}

async fn fetch_rule_category_payload(
    config: &Value,
    tid: &str,
    page: u32,
    filters: &HashMap<String, String>,
) -> Result<Vec<Value>, String> {
    let request_url = build_rule_category_url(config, tid, page, filters)?;
    let headers = build_rule_headers(config);
    let body = fetch_text_value(&request_url, Some(headers)).await?;
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderFastPath][XBPQ] request_url={} chars={} has_xvd={}",
        request_url,
        body.len(),
        body.contains("/xvd")
    ));

    let array_rule = config_string(config, &["\u{6570}\u{7ec4}"])
        .ok_or_else(|| "rule config missing array rule".to_string())?;
    let title_rule = config_string(config, &["\u{6807}\u{9898}"])
        .ok_or_else(|| "rule config missing title rule".to_string())?;
    let picture_rule = config_string(config, &["\u{56fe}\u{7247}"])
        .ok_or_else(|| "rule config missing picture rule".to_string())?;
    let link_rule = config_string(config, &["\u{94fe}\u{63a5}"])
        .ok_or_else(|| "rule config missing link rule".to_string())?;
    let remark_rule = config_string(
        config,
        &[
            "\u{526f}\u{6807}\u{9898}",
            "\u{5907}\u{6ce8}",
            "\u{72b6}\u{6001}",
        ],
    );

    let mut list = Vec::new();
    for segment in extract_rule_items(&body, &array_rule) {
        let Some(title) = extract_rule_value(&segment, &title_rule) else {
            continue;
        };
        let Some(link) = extract_rule_value(&segment, &link_rule) else {
            continue;
        };
        let detail_url = absolutize_rule_url(&request_url, &link).unwrap_or(link);
        let picture = extract_rule_value(&segment, &picture_rule).unwrap_or_default();
        let remarks = remark_rule
            .as_deref()
            .and_then(|rule| extract_rule_value(&segment, rule))
            .unwrap_or_default();
        list.push(json!({
            "vod_id": format!("{title}$${picture}$$${detail_url}"),
            "vod_name": title,
            "vod_pic": picture,
            "vod_remarks": remarks,
        }));
    }

    if list.is_empty() {
        let preview = body.chars().take(180).collect::<String>();
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderFastPath][XBPQ] empty list preview={}",
            preview.replace('\r', " ").replace('\n', " ")
        ));
    } else {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderFastPath][XBPQ] parsed {} items",
            list.len()
        ));
    }

    Ok(list)
}
fn build_rule_category_url(
    config: &Value,
    tid: &str,
    page: u32,
    filters: &HashMap<String, String>,
) -> Result<String, String> {
    let template = config_string(config, &["\u{5206}\u{7c7b}url", "class_url"])
        .ok_or_else(|| "rule config missing 閸掑棛琚玼rl".to_string())?;
    let template = template
        .split(";;")
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "rule config 閸掑棛琚玼rl empty".to_string())?;

    let mut values = filters.clone();
    values.insert("cateId".to_string(), tid.to_string());
    values.insert("catePg".to_string(), page.max(1).to_string());
    values
        .entry("pg".to_string())
        .or_insert_with(|| page.max(1).to_string());
    values
        .entry("page".to_string())
        .or_insert_with(|| page.max(1).to_string());
    for key in ["area", "by", "class", "lang", "letter", "year"] {
        values.entry(key.to_string()).or_default();
    }

    Ok(replace_rule_placeholders(template, &values))
}

fn replace_rule_placeholders(template: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::new();
    let mut rest = template;
    loop {
        let Some(start) = rest.find('{') else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after_start = &rest[(start + 1)..];
        let Some(end_rel) = after_start.find('}') else {
            out.push_str(&rest[start..]);
            break;
        };
        let key = &after_start[..end_rel];
        out.push_str(values.get(key).map(String::as_str).unwrap_or(""));
        rest = &after_start[(end_rel + 1)..];
    }
    out
}

fn build_rule_headers(config: &Value) -> HashMap<String, String> {
    let mut headers = HashMap::new();
    if let Some(raw) = config_string(config, &["\u{8bf7}\u{6c42}\u{5934}"]) {
        for entry in raw
            .split('#')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if let Some((key, value)) = entry.split_once('$') {
                headers.insert(
                    key.trim().to_string(),
                    expand_rule_header_value(value.trim()),
                );
            }
        }
    }
    if let Some(referer) = config_string(config, &["\u{4e3b}\u{9875}url", "homeUrl"]) {
        headers
            .entry("Referer".to_string())
            .or_insert_with(|| referer.trim().to_string());
    }
    headers
}

fn expand_rule_header_value(value: &str) -> String {
    match value.trim() {
        "MOBILE_UA" => RULE_MOBILE_UA.to_string(),
        other => other
            .replace("锛涳紱", "; ")
            .replace("$$", "$")
            .trim()
            .to_string(),
    }
}

fn config_string(config: &Value, keys: &[&str]) -> Option<String> {
    let map = config.as_object()?;
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(stringify_json_value)
}

fn extract_rule_items(body: &str, rule: &str) -> Vec<String> {
    let Some((prefix, suffix, _)) = parse_rule_capture(rule) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find(&prefix) {
        let after_start = &rest[(start + prefix.len())..];
        let Some(end) = after_start.find(&suffix) else {
            break;
        };
        items.push(after_start[..end].to_string());
        rest = &after_start[(end + suffix.len())..];
    }
    items
}

fn extract_rule_value(body: &str, rule: &str) -> Option<String> {
    let (prefix, suffix, prepend_prefix) = parse_rule_capture(rule)?;
    let rest = if let Some(start) = body.find(&prefix) {
        &body[(start + prefix.len())..]
    } else if prepend_prefix {
        body
    } else {
        return None;
    };
    let end = rest.find(&suffix)?;
    let captured = rest[..end].trim();
    if captured.is_empty() {
        return None;
    }
    Some(if prepend_prefix {
        format!("{prefix}{captured}")
    } else {
        captured.to_string()
    })
}

fn parse_rule_capture(rule: &str) -> Option<(String, String, bool)> {
    let trimmed = rule.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((prefix, suffix)) = trimmed.split_once("+&&") {
        return Some((prefix.to_string(), suffix.to_string(), true));
    }
    let (prefix, suffix) = trimmed.split_once("&&")?;
    Some((prefix.to_string(), suffix.to_string(), false))
}

fn absolutize_rule_url(base: &str, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed.to_string());
    }
    let base_url = url::Url::parse(base).ok()?;
    base_url.join(trimmed).ok().map(|value| value.to_string())
}

async fn fetch_text_value(
    url: &str,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let resolved = crate::media_cmds::resolve_media_request(url, headers);
    let client = crate::media_cmds::build_client()?;
    let request =
        crate::media_cmds::apply_request_headers(client.get(&resolved.url), &resolved.headers);
    let response = request
        .send()
        .await
        .map_err(|err| format!("fast-path request failed for {url}: {err}"))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|err| format!("fast-path response read failed for {url}: {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "fast-path request failed for {url}: HTTP {}",
            status.as_u16()
        ));
    }
    Ok(String::from_utf8(body.to_vec())
        .unwrap_or_else(|_| String::from_utf8_lossy(&body).into_owned()))
}
fn arg_value<'a>(args: &'a [(&str, String)], index: usize) -> Option<&'a str> {
    args.get(index).map(|(_, value)| value.as_str())
}

fn parse_page_arg(args: &[(&str, String)], index: usize) -> u32 {
    arg_value(args, index)
        .and_then(|value| value.trim().parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1)
}

fn parse_map_arg(args: &[(&str, String)], index: usize) -> HashMap<String, String> {
    let Some(raw) = arg_value(args, index) else {
        return HashMap::new();
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return HashMap::new();
    }

    let Ok(Value::Object(map)) = serde_json::from_str::<Value>(trimmed) else {
        return HashMap::new();
    };

    map.into_iter()
        .filter_map(|(key, value)| {
            let text = stringify_json_value(&value)?;
            let normalized_key = key.trim().to_string();
            if normalized_key.is_empty() || text.is_empty() {
                None
            } else {
                Some((normalized_key, text))
            }
        })
        .collect()
}

fn douban_headers() -> HashMap<String, String> {
    HashMap::from([
        ("Host".to_string(), "frodo.douban.com".to_string()),
        ("Connection".to_string(), "Keep-Alive".to_string()),
        (
            "Referer".to_string(),
            "https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html".to_string(),
        ),
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MicroMessenger/8.0.49.2600(0x63090b19) WindowsWechat MiniProgramEnv/Windows WindowsWechat".to_string(),
        ),
    ])
}

fn bili_headers() -> HashMap<String, String> {
    HashMap::from([
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0".to_string(),
        ),
        ("cookie".to_string(), BILI_DEFAULT_COOKIE.to_string()),
        ("Referer".to_string(), "https://www.bilibili.com".to_string()),
    ])
}

fn douban_home_categories() -> Vec<Value> {
    vec![
        json!({ "type_id": "hot_gaia", "type_name": "\u{70ed}\u{95e8}\u{63a8}\u{8350}" }),
        json!({ "type_id": "tv_hot", "type_name": "\u{70ed}\u{64ad}\u{5267}\u{96c6}" }),
        json!({ "type_id": "anime_hot", "type_name": "\u{70ed}\u{95e8}\u{52a8}\u{6f2b}" }),
        json!({ "type_id": "show_hot", "type_name": "\u{70ed}\u{95e8}\u{7efc}\u{827a}" }),
        json!({ "type_id": "movie", "type_name": "\u{7535}\u{5f71}" }),
        json!({ "type_id": "tv", "type_name": "\u{7535}\u{89c6}\u{5267}" }),
        json!({ "type_id": "rank_list_movie", "type_name": "\u{7535}\u{5f71}\u{699c}\u{5355}" }),
        json!({ "type_id": "rank_list_tv", "type_name": "\u{5267}\u{96c6}\u{699c}\u{5355}" }),
    ]
}

fn build_douban_category_request(
    tid: &str,
    start: u32,
    filters: &HashMap<String, String>,
) -> (String, &'static str) {
    match tid {
        "hot_gaia" => {
            let sort = filter_value(filters, &["sort"]).unwrap_or("recommend");
            let area = filter_value(filters, &["area"]).unwrap_or("\u{5168}\u{90e8}");
            (
                format!(
                    "https://frodo.douban.com/api/v2/movie/hot_gaia?apikey={DOUBAN_API_KEY}&sort={}&area={}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(sort),
                    encode_component(area),
                ),
                "items",
            )
        }
        "tv_hot" => {
            let collection = filter_value(filters, &["type"]).unwrap_or("tv_hot");
            (
                format!(
                    "https://frodo.douban.com/api/v2/subject_collection/{}/items?apikey={DOUBAN_API_KEY}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(collection),
                ),
                "subject_collection_items",
            )
        }
        "show_hot" => {
            let collection = filter_value(filters, &["type"]).unwrap_or("show_hot");
            (
                format!(
                    "https://frodo.douban.com/api/v2/subject_collection/{}/items?apikey={DOUBAN_API_KEY}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(collection),
                ),
                "subject_collection_items",
            )
        }
        "rank_list_movie" => {
            let collection =
                filter_value(filters, &["type", "listType"]).unwrap_or("movie_real_time_hotest");
            (
                format!(
                    "https://frodo.douban.com/api/v2/subject_collection/{}/items?apikey={DOUBAN_API_KEY}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(collection),
                ),
                "subject_collection_items",
            )
        }
        "rank_list_tv" => {
            let collection =
                filter_value(filters, &["type", "listType"]).unwrap_or("tv_real_time_hotest");
            (
                format!(
                    "https://frodo.douban.com/api/v2/subject_collection/{}/items?apikey={DOUBAN_API_KEY}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(collection),
                ),
                "subject_collection_items",
            )
        }
        "tv" => {
            let sort = filter_value(filters, &["sort"]).unwrap_or("T");
            let tags = filter_value(filters, &["tags", "type", "category", "kind"]).unwrap_or("");
            (
                format!(
                    "https://frodo.douban.com/api/v2/tv/recommend?apikey={DOUBAN_API_KEY}&sort={}&tags={}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(sort),
                    encode_component(tags),
                ),
                "items",
            )
        }
        _ => {
            let sort = filter_value(filters, &["sort"]).unwrap_or("T");
            let tags = filter_value(filters, &["tags", "type", "category", "kind"]).unwrap_or("");
            (
                format!(
                    "https://frodo.douban.com/api/v2/movie/recommend?apikey={DOUBAN_API_KEY}&sort={}&tags={}&start={start}&count={DOUBAN_COUNT}",
                    encode_component(sort),
                    encode_component(tags),
                ),
                "items",
            )
        }
    }
}

fn filter_value<'a>(filters: &'a HashMap<String, String>, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        filters
            .get(*key)
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

fn encode_component(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

async fn load_bili_catalog(ext: &str) -> Result<Value, String> {
    let ext_value = parse_ext_json(ext)?;
    if ext_value.get("class").is_some() || ext_value.get("filters").is_some() {
        return Ok(ext_value);
    }

    let Some(url) = ext_value
        .get("json")
        .and_then(stringify_json_value)
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
    else {
        return Err("BiliYS fast-path requires ext.json catalog URL".to_string());
    };

    if let Some(cached) = cached_bili_catalog(&url) {
        return Ok(cached);
    }

    let catalog = fetch_json_value(&url, None).await?;
    store_bili_catalog(&url, &catalog);
    Ok(catalog)
}

fn parse_ext_json(ext: &str) -> Result<Value, String> {
    let trimmed = ext.trim();
    if trimmed.is_empty() {
        return Err("empty ext payload".to_string());
    }
    serde_json::from_str::<Value>(trimmed).map_err(|err| format!("invalid ext payload: {err}"))
}

fn cached_bili_catalog(url: &str) -> Option<Value> {
    let guard = match bili_catalog_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.get(url).cloned()
}

fn store_bili_catalog(url: &str, catalog: &Value) {
    let mut guard = match bili_catalog_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.insert(url.to_string(), catalog.clone());
}

async fn fetch_bili_category_payload(
    tid: &str,
    page: u32,
    filters: &HashMap<String, String>,
) -> Result<(Vec<Value>, u32), String> {
    let order = filter_value(filters, &["order"]).unwrap_or("2");
    let season_status = filter_value(filters, &["season_status"]).unwrap_or("-1");
    let url = format!(
        "https://api.bilibili.com/pgc/season/index/result?order={}&season_status={}&style_id=-1&sort=-1&area=-1&pagesize=20&type=1&season_type={}&page={}",
        encode_component(order),
        encode_component(season_status),
        encode_component(tid),
        page.max(1),
    );
    let response = fetch_json_value(&url, Some(bili_headers())).await?;
    let Some(data) = response.get("data") else {
        return Err("BiliYS fast-path response missing data".to_string());
    };
    let list = data
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| map_bili_item(&item))
        .collect();
    let total = data
        .get("total")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .unwrap_or(0);
    Ok((list, total))
}

async fn fetch_json_value(
    url: &str,
    headers: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let resolved = crate::media_cmds::resolve_media_request(url, headers);
    let client = crate::media_cmds::build_client()?;
    let request =
        crate::media_cmds::apply_request_headers(client.get(&resolved.url), &resolved.headers);
    let response = request
        .send()
        .await
        .map_err(|err| format!("fast-path request failed for {url}: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("fast-path response read failed for {url}: {err}"))?;
    if !status.is_success() {
        return Err(format!(
            "fast-path request failed for {url}: HTTP {}",
            status.as_u16()
        ));
    }
    parse_json_value_loose(&body).map_err(|err| format!("fast-path invalid JSON for {url}: {err}"))
}

fn parse_json_value_loose(body: &str) -> Result<Value, serde_json::Error> {
    let trimmed = body.trim_start_matches('\u{feff}').trim_start();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }

    let first_obj = trimmed.find('{');
    let first_arr = trimmed.find('[');
    let start = match (first_obj, first_arr) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return serde_json::from_str::<Value>(trimmed),
    };

    let last_obj = trimmed.rfind('}');
    let last_arr = trimmed.rfind(']');
    let end = match (last_obj, last_arr) {
        (Some(a), Some(b)) => a.max(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return serde_json::from_str::<Value>(trimmed),
    };

    if end <= start {
        return serde_json::from_str::<Value>(trimmed);
    }

    serde_json::from_str::<Value>(&trimmed[start..=end])
}

fn map_douban_items(items: &[Value]) -> Vec<Value> {
    items.iter().filter_map(map_douban_item).collect()
}

fn map_douban_item(item: &Value) -> Option<Value> {
    let id = pick_nested_string(item, &[&["id"], &["target", "id"], &["subject", "id"]])?;
    let title = pick_nested_string(
        item,
        &[&["title"], &["target", "title"], &["subject", "title"]],
    )
    .unwrap_or_else(|| id.clone());
    let pic = pick_nested_string(
        item,
        &[
            &["pic", "normal"],
            &["pic", "large"],
            &["cover_url"],
            &["cover", "url"],
            &["target", "pic", "normal"],
            &["subject", "pic", "normal"],
        ],
    )
    .unwrap_or_default();
    let remarks = pick_nested_string(
        item,
        &[
            &["honor_infos", "0", "title"],
            &["rating", "value"],
            &["card_subtitle"],
            &["info"],
            &["target", "card_subtitle"],
            &["subject", "card_subtitle"],
        ],
    )
    .unwrap_or_default();

    Some(json!({
        "vod_id": id,
        "vod_name": title,
        "vod_pic": pic,
        "vod_remarks": remarks,
    }))
}

fn map_bili_item(item: &Value) -> Option<Value> {
    Some(json!({
        "vod_name": pick_nested_string(item, &[&["title"]])?,
        "vod_id": pick_nested_string(item, &[&["season_id"], &["seasonId"]])?,
        "vod_pic": pick_nested_string(item, &[&["cover"]]).unwrap_or_default(),
        "vod_remarks": pick_nested_string(item, &[&["index_show"], &["badge_info", "text"]]).unwrap_or_default(),
    }))
}

fn pick_nested_string(value: &Value, paths: &[&[&str]]) -> Option<String> {
    for path in paths {
        let mut current = value;
        let mut matched = true;
        for segment in *path {
            if let Ok(index) = segment.parse::<usize>() {
                let Some(next) = current.as_array().and_then(|items| items.get(index)) else {
                    matched = false;
                    break;
                };
                current = next;
                continue;
            }
            let Some(next) = current.as_object().and_then(|map| map.get(*segment)) else {
                matched = false;
                break;
            };
            current = next;
        }
        if matched {
            if let Some(text) = stringify_json_value(current) {
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
    }
    None
}

fn stringify_json_value(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_string()).filter(|text| !text.is_empty()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(if *flag {
            "true".to_string()
        } else {
            "false".to_string()
        }),
        _ => None,
    }
}

fn append_fast_path_log(site_key: &str, family: &str, method: &str, detail: &str) {
    let line = format!(
        "[SpiderFastPath] {} -> {} ({}) {}",
        site_key, family, method, detail
    );
    crate::spider_cmds::append_spider_debug_log(&line);
    println!("{line}");
}

#[cfg(test)]
mod tests {
    use super::{
        build_douban_category_request, douban_home_categories, extract_rule_value, map_bili_item,
        map_douban_item, parse_json_value_loose, parse_map_arg,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn builds_hot_gaia_request_with_defaults() {
        let (url, list_key) = build_douban_category_request("hot_gaia", 20, &HashMap::new());
        assert!(url.contains("movie/hot_gaia"));
        assert!(url.contains("sort=recommend"));
        assert!(url.contains("start=20"));
        assert_eq!(list_key, "items");
    }

    #[test]
    fn exposes_expected_douban_categories() {
        let categories = douban_home_categories();
        assert_eq!(categories.len(), 8);
        assert_eq!(categories[0]["type_id"], "hot_gaia");
    }

    #[test]
    fn parses_filter_map_argument() {
        let args = vec![
            ("string", "1".to_string()),
            ("string", "1".to_string()),
            ("bool", "false".to_string()),
            ("map", r#"{"order":"4","season_status":"2,6"}"#.to_string()),
        ];
        let parsed = parse_map_arg(&args, 3);
        assert_eq!(parsed.get("order").map(String::as_str), Some("4"));
        assert_eq!(parsed.get("season_status").map(String::as_str), Some("2,6"));
    }

    #[test]
    fn parses_json_with_utf8_bom() {
        let parsed = parse_json_value_loose("\u{feff}{\"class\":[]}").expect("json with bom");
        assert!(parsed
            .get("class")
            .and_then(serde_json::Value::as_array)
            .is_some());
    }
    #[test]
    fn parses_json_wrapped_in_text() {
        let parsed =
            parse_json_value_loose("wrapper={\"class\":[],\"filters\":{}};").expect("wrapped json");
        assert!(parsed.get("filters").is_some());
    }
    #[test]
    fn extracts_prefixed_rule_value_from_trimmed_segment() {
        let value =
            extract_rule_value("1483.html\" title=\"Test", "/xvd+&&\"").expect("prefixed link");
        assert_eq!(value, "/xvd1483.html");
    }
    #[test]
    fn maps_douban_item_with_nested_picture() {
        let item = json!({
            "id": "42",
            "title": "Test",
            "pic": { "normal": "https://img.example/test.jpg" },
            "card_subtitle": "2026"
        });
        let mapped = map_douban_item(&item).unwrap();
        assert_eq!(mapped["vod_id"], "42");
        assert_eq!(mapped["vod_pic"], "https://img.example/test.jpg");
        assert_eq!(mapped["vod_remarks"], "2026");
    }

    #[test]
    fn maps_bili_item() {
        let item = json!({
            "title": "Bangumi",
            "season_id": "99",
            "cover": "https://img.example/bili.jpg",
            "index_show": "\u{66f4}\u{65b0}\u{81f3}12\u{8bdd}"
        });
        let mapped = map_bili_item(&item).unwrap();
        assert_eq!(mapped["vod_id"], "99");
        assert_eq!(mapped["vod_name"], "Bangumi");
    }
}
