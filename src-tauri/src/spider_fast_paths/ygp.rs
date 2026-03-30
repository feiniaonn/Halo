use std::collections::HashMap;

use regex::Regex;
use serde_json::{json, Value};

const YGP_SITE_BASE: &str = "https://www.6huo.com";
const YGP_ACCEPT_JSON: &str = "application/json";
const YGP_DEFAULT_TID: &str = "later";

pub(super) async fn try_execute_fast_path(
    site_key: &str,
    method: &str,
    args: &[(&str, String)],
) -> Result<Option<String>, String> {
    match method {
        "homeContent" => {
            super::append_fast_path_log(site_key, "YGP", method, "using jina desktop fallback");
            let markdown = fetch_markdown_for_path("/later").await?;
            let payload = json!({
                "class": build_category_items(),
                "filters": {},
                "list": parse_catalog_items(&markdown),
            });
            Ok(Some(payload.to_string()))
        }
        "categoryContent" => {
            let tid = normalize_tid(super::arg_value(args, 0).unwrap_or(YGP_DEFAULT_TID));
            let page = super::parse_page_arg(args, 1);
            let path = category_path_for_tid(&tid);
            super::append_fast_path_log(
                site_key,
                "YGP",
                method,
                &format!("desktop fallback tid={tid} page={page}"),
            );
            let markdown = fetch_markdown_for_path(path).await?;
            let payload = json!({
                "page": page,
                "pagecount": 1,
                "limit": 60,
                "total": 60,
                "list": parse_catalog_items(&markdown),
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
                "YGP",
                method,
                &format!("desktop fallback keyword={keyword}"),
            );
            let markdown = fetch_markdown_for_path(&format!(
                "/?keyword={}&view=search",
                super::encode_component(keyword)
            ))
            .await?;
            let payload = json!({
                "page": 1,
                "pagecount": 1,
                "limit": 20,
                "total": 20,
                "list": parse_search_items(&markdown),
            });
            Ok(Some(payload.to_string()))
        }
        "detailContent" => {
            let Some(vod_id) = decode_first_detail_id(args) else {
                return Ok(Some(json!({ "list": [] }).to_string()));
            };
            super::append_fast_path_log(
                site_key,
                "YGP",
                method,
                &format!("desktop fallback vod_id={vod_id}"),
            );
            let movie_url = normalize_movie_url(&vod_id);
            let markdown = fetch_markdown_for_absolute_url(&movie_url).await?;
            let Some(detail) = parse_detail_payload(&movie_url, &markdown) else {
                return Ok(Some(json!({ "list": [] }).to_string()));
            };
            Ok(Some(json!({ "list": [detail] }).to_string()))
        }
        "playerContent" => {
            let raw_id = super::arg_value(args, 1).unwrap_or("").trim();
            if raw_id.is_empty() {
                return Ok(Some(json!({}).to_string()));
            }
            super::append_fast_path_log(
                site_key,
                "YGP",
                method,
                &format!("desktop fallback id={}", summarize_player_id(raw_id)),
            );
            let payload = resolve_player_payload(raw_id).await?;
            Ok(Some(payload.to_string()))
        }
        _ => Ok(None),
    }
}

fn build_category_items() -> Vec<Value> {
    vec![
        json!({ "type_id": "later", "type_name": "即将上映" }),
        json!({ "type_id": "allmovies", "type_name": "全部电影" }),
        json!({ "type_id": "nowplaying", "type_name": "正在热映" }),
        json!({ "type_id": "hd", "type_name": "高清预告" }),
    ]
}

fn normalize_tid(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('/');
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("movlist") {
        return YGP_DEFAULT_TID.to_string();
    }
    trimmed.to_string()
}

fn category_path_for_tid(tid: &str) -> &'static str {
    match tid {
        "allmovies" => "/allmovies",
        "nowplaying" => "/nowplaying",
        "hd" => "/hd",
        _ => "/later",
    }
}

async fn fetch_markdown_for_path(path: &str) -> Result<String, String> {
    fetch_markdown_for_absolute_url(&format!("{YGP_SITE_BASE}{}", normalize_site_path(path))).await
}

async fn fetch_markdown_for_absolute_url(url: &str) -> Result<String, String> {
    let jina_url = format!(
        "https://r.jina.ai/http://{}",
        url.trim_start_matches("https://")
    );
    let payload = super::fetch_json_value(&jina_url, Some(jina_headers())).await?;
    let Some(content) = payload
        .get("data")
        .and_then(|value| value.get("content"))
        .and_then(super::stringify_json_value)
    else {
        return Err(format!("YGP fast-path content missing for {url}"));
    };
    Ok(content)
}

fn jina_headers() -> HashMap<String, String> {
    HashMap::from([("Accept".to_string(), YGP_ACCEPT_JSON.to_string())])
}

fn normalize_site_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "/".to_string();
    }
    if trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    format!("/{trimmed}")
}

fn parse_catalog_items(markdown: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut started = false;

    for line in markdown.lines().map(str::trim) {
        if started && should_stop_catalog_scan(line) {
            break;
        }
        let Some(item) = parse_catalog_item(line) else {
            continue;
        };
        started = true;
        if !seen.insert(item.movie_url.clone()) {
            continue;
        }
        items.push(json!({
            "vod_id": item.movie_url,
            "vod_name": item.title,
            "vod_pic": item.poster,
            "vod_remarks": item.remarks,
        }));
    }

    items
}

fn parse_search_items(markdown: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let relevant_markdown = isolate_search_result_section(markdown);

    for line in relevant_markdown.lines().map(str::trim) {
        let Some(item) = parse_search_row(line) else {
            continue;
        };
        if !seen.insert(item.movie_url.clone()) {
            continue;
        }
        items.push(json!({
            "vod_id": item.movie_url,
            "vod_name": item.title,
            "vod_pic": item.poster,
            "vod_remarks": item.remarks,
        }));
    }

    items
}

#[derive(Debug, Clone)]
struct ListingItem {
    movie_url: String,
    title: String,
    poster: String,
    remarks: String,
}

fn parse_catalog_item(line: &str) -> Option<ListingItem> {
    parse_catalog_list_item(line).or_else(|| parse_catalog_row(line))
}

fn parse_catalog_list_item(line: &str) -> Option<ListingItem> {
    let trimmed = line.trim();
    if !trimmed.starts_with('*') {
        return None;
    }

    let captures = search_item_regex().captures(trimmed)?;
    let movie_url = normalize_known_site_url(captures.name("movie")?.as_str());
    let poster = captures
        .name("pic")
        .map(|value| normalize_asset_url(value.as_str()))
        .unwrap_or_default();
    let body = captures
        .name("body")
        .map(|value| clean_inline_text(value.as_str()))
        .unwrap_or_default();
    let (title, remarks) = split_search_title_and_meta(&body);
    let title = if title.is_empty() {
        movie_id_from_url(&movie_url).unwrap_or_else(|| movie_url.clone())
    } else {
        title
    };

    Some(ListingItem {
        movie_url,
        title,
        poster,
        remarks,
    })
}

fn parse_catalog_row(line: &str) -> Option<ListingItem> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') || trimmed.starts_with("| ---") {
        return None;
    }

    let cells = split_markdown_table_row(trimmed);
    if cells.len() < 2 {
        return None;
    }

    let (poster, movie_url) = extract_image_and_movie_url(&cells[0])?;
    let (title, meta) = extract_link_title_and_tail(&cells[1])?;
    let row_remarks = first_useful_cell_remarks(&cells[2..]);
    let remarks = if !row_remarks.is_empty() {
        row_remarks
    } else if !meta.is_empty() {
        clean_inline_text(&meta)
    } else {
        String::new()
    };
    let title = clean_inline_text(&title)
        .chars()
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();
    let title = if title.is_empty() {
        movie_id_from_url(&movie_url).unwrap_or_else(|| movie_url.clone())
    } else {
        title
    };

    Some(ListingItem {
        movie_url,
        title,
        poster,
        remarks,
    })
}

fn parse_search_row(line: &str) -> Option<ListingItem> {
    let trimmed = line.trim();
    if !trimmed.starts_with('*') {
        return None;
    }

    let captures = search_item_regex().captures(trimmed)?;
    let movie_url = normalize_known_site_url(captures.name("movie")?.as_str());
    let poster = captures
        .name("pic")
        .map(|value| normalize_asset_url(value.as_str()))
        .unwrap_or_default();
    let body = captures
        .name("body")
        .map(|value| clean_inline_text(value.as_str()))
        .unwrap_or_default();
    let (title, remarks) = split_search_title_and_meta(&body);
    let title = if title.is_empty() {
        movie_id_from_url(&movie_url).unwrap_or_else(|| movie_url.clone())
    } else {
        title
    };

    Some(ListingItem {
        movie_url,
        title,
        poster,
        remarks,
    })
}

fn isolate_search_result_section(markdown: &str) -> &str {
    let Some(start) = markdown.find("\n# 搜索电影:") else {
        return markdown;
    };
    let section = &markdown[(start + 1)..];
    if let Some(end) = section.find("\n## 全网搜索") {
        &section[..end]
    } else {
        section
    }
}

fn split_markdown_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(clean_inline_text)
        .collect()
}

fn extract_image_and_movie_url(value: &str) -> Option<(String, String)> {
    let captures = table_item_regex().captures(value)?;
    let poster = normalize_asset_url(captures.name("pic")?.as_str());
    let movie_url = normalize_known_site_url(captures.name("movie")?.as_str());
    Some((poster, movie_url))
}

fn extract_link_title_and_tail(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let open = trimmed.find('[')?;
    let close = trimmed[open + 1..].find(']')? + open + 1;
    let title = clean_inline_text(&trimmed[(open + 1)..close]);
    let link_start = trimmed[close..].find("](")? + close;
    let link_end = trimmed[(link_start + 2)..].find(')')? + link_start + 2;
    let tail = clean_inline_text(&trimmed[(link_end + 1)..]);
    Some((title, tail))
}

fn split_search_title_and_meta(value: &str) -> (String, String) {
    let trimmed = clean_inline_text(value);
    if trimmed.is_empty() {
        return (String::new(), String::new());
    }
    if let Some(index) = search_meta_start_regex()
        .find(&trimmed)
        .map(|mat| mat.start())
    {
        let title = clean_inline_text(&trimmed[..index]);
        let remarks = clean_search_meta(&trimmed[index..]);
        return (title, remarks);
    }
    (trimmed, String::new())
}

fn should_stop_catalog_scan(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("### ")
        || trimmed.starts_with("©")
        || trimmed.contains("手机版")
        || trimmed.contains("网站服务")
}

fn first_useful_cell_remarks(cells: &[String]) -> String {
    let mut fallback = String::new();
    for cell in cells {
        let cleaned = flatten_markdown_text(cell);
        if cleaned.is_empty() {
            continue;
        }
        if fallback.is_empty() {
            fallback = cleaned.clone();
        }
        if cleaned.contains("上映")
            || cleaned.contains("豆瓣")
            || cleaned.contains("月")
            || cleaned.contains("年")
            || cleaned.chars().any(|ch| ch.is_ascii_digit())
        {
            return cleaned;
        }
    }
    fallback
}

fn parse_detail_payload(movie_url: &str, markdown: &str) -> Option<Value> {
    let vod_id = movie_id_from_url(movie_url).unwrap_or_else(|| movie_url.to_string());
    let vod_name = detail_movie_heading_regex()
        .captures_iter(markdown)
        .filter_map(|captures| {
            captures
                .name("title")
                .map(|value| clean_inline_text(value.as_str()))
        })
        .find(|value| !value.is_empty())
        .or_else(|| {
            main_heading_regex()
                .captures_iter(markdown)
                .filter_map(|captures| {
                    captures
                        .name("title")
                        .map(|value| clean_inline_text(value.as_str()))
                })
                .find(|value| !value.contains("高清电影预告片"))
        })
        .map(|value| normalize_detail_title(&value))
        .unwrap_or_else(|| vod_id.clone());

    let vod_pic = detail_poster_regex()
        .captures(markdown)
        .and_then(|captures| {
            captures
                .name("pic")
                .map(|value| normalize_asset_url(value.as_str()))
        })
        .unwrap_or_default();
    let vod_class = detail_line_value(markdown, "类型：");
    let vod_year = detail_line_value(markdown, "上映：");
    let director_actor = detail_line_value(markdown, "导演：");
    let (vod_director, vod_actor) = split_director_actor(&director_actor);
    let vod_content = detail_line_value(markdown, "剧情：")
        .map(|value| value.replace("[(详细)]", "").trim().to_string());

    let episodes = parse_detail_episodes(markdown);
    let (vod_play_from, vod_play_url) = if episodes.is_empty() {
        (String::new(), String::new())
    } else {
        (
            "预告片".to_string(),
            episodes
                .into_iter()
                .map(|episode| {
                    format!(
                        "{}${}",
                        episode.title,
                        build_episode_token(&episode.show_url, episode.download_url.as_deref())
                    )
                })
                .collect::<Vec<_>>()
                .join("#"),
        )
    };

    Some(json!({
        "vod_id": vod_id,
        "vod_name": vod_name,
        "vod_pic": vod_pic,
        "vod_year": vod_year,
        "vod_area": Value::Null,
        "vod_actor": vod_actor,
        "vod_director": vod_director,
        "vod_content": vod_content,
        "vod_play_from": vod_play_from,
        "vod_play_url": vod_play_url,
        "vod_class": vod_class,
    }))
}

fn detail_line_value(markdown: &str, prefix: &str) -> Option<String> {
    markdown.lines().map(str::trim).find_map(|line| {
        line.strip_prefix(prefix)
            .map(clean_inline_text)
            .filter(|value| !value.is_empty())
    })
}

fn split_director_actor(value: &Option<String>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    if let Some((director, actor)) = value.split_once("主演：") {
        let director = clean_inline_text(director);
        let actor = clean_inline_text(actor);
        return (
            (!director.is_empty()).then_some(director),
            (!actor.is_empty()).then_some(actor),
        );
    }
    let cleaned = clean_inline_text(value);
    ((!cleaned.is_empty()).then_some(cleaned), None)
}

#[derive(Debug, Clone)]
struct DetailEpisode {
    title: String,
    show_url: String,
    download_url: Option<String>,
}

fn parse_detail_episodes(markdown: &str) -> Vec<DetailEpisode> {
    detail_episode_regex()
        .captures_iter(markdown)
        .filter_map(|captures| {
            let title = captures
                .name("title")
                .map(|value| clean_inline_text(value.as_str()))
                .filter(|value| !value.is_empty())?;
            let show_url = normalize_known_site_url(captures.name("show")?.as_str());
            let download_url = captures
                .name("download")
                .map(|value| normalize_known_site_url(value.as_str()))
                .filter(|value| !value.is_empty());
            Some(DetailEpisode {
                title,
                show_url,
                download_url,
            })
        })
        .collect()
}

fn build_episode_token(show_url: &str, download_url: Option<&str>) -> String {
    match download_url {
        Some(download_url) if !download_url.trim().is_empty() => {
            format!("{}@@{}", show_url.trim(), download_url.trim())
        }
        _ => show_url.trim().to_string(),
    }
}

async fn resolve_player_payload(raw_id: &str) -> Result<Value, String> {
    let (show_url, download_url) = split_episode_token(raw_id);
    let markdown = fetch_markdown_for_absolute_url(&show_url).await?;
    let source_url = extract_source_url(&markdown).or_else(|| {
        download_url
            .as_deref()
            .and_then(extract_source_url_from_download_url)
    });

    if let Some(source_url) = source_url {
        if is_direct_media_url(&source_url) {
            return Ok(json!({
                "parse": 0,
                "url": source_url,
            }));
        }
        if is_mtime_source(&source_url) {
            if let Some(play_url) = resolve_mtime_play_url(&source_url).await? {
                return Ok(json!({
                    "parse": 0,
                    "url": play_url,
                }));
            }
        }
        if is_maoyan_source(&source_url) {
            if let Some(play_url) = resolve_maoyan_play_url(&source_url).await? {
                return Ok(json!({
                    "parse": 0,
                    "url": play_url,
                }));
            }
        }
        if let Some(play_url) = resolve_embedded_media_url(&source_url).await? {
            return Ok(json!({
                "parse": 0,
                "url": play_url,
            }));
        }
        if is_maoyan_source(&source_url) {
            return Ok(json!({
                "parse": 1,
                "url": source_url,
            }));
        }
        return Ok(json!({
            "parse": 1,
            "url": source_url,
        }));
    }

    Ok(json!({
        "parse": 1,
        "url": show_url,
    }))
}

fn split_episode_token(raw_id: &str) -> (String, Option<String>) {
    if let Some((show_url, download_url)) = raw_id.split_once("@@") {
        return (
            normalize_known_site_url(show_url),
            (!download_url.trim().is_empty()).then(|| normalize_known_site_url(download_url)),
        );
    }
    (normalize_known_site_url(raw_id), None)
}

fn extract_source_url(markdown: &str) -> Option<String> {
    let captures = source_link_regex().captures(markdown)?;
    let raw = captures.name("url")?.as_str().trim();
    normalize_source_url(raw)
}

fn extract_source_url_from_download_url(download_url: &str) -> Option<String> {
    if download_url.trim().is_empty() {
        return None;
    }
    None
}

fn normalize_source_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(normalize_known_site_url(trimmed))
}

fn is_mtime_source(url: &str) -> bool {
    url.contains("video.mtime.com/")
}

fn is_maoyan_source(url: &str) -> bool {
    url.contains("maoyan.com/films/") && url.contains("/preview")
}

fn is_direct_media_url(url: &str) -> bool {
    let lowered = url.to_ascii_lowercase();
    lowered.contains(".m3u8") || lowered.contains(".mp4")
}

async fn resolve_embedded_media_url(source_url: &str) -> Result<Option<String>, String> {
    let body = super::fetch_text_value(source_url, Some(browser_headers(source_url))).await?;
    Ok(extract_direct_media_url(&body))
}

async fn resolve_maoyan_play_url(source_url: &str) -> Result<Option<String>, String> {
    let Some((movie_id, video_id)) = maoyan_identifiers(source_url) else {
        return Ok(None);
    };

    let mobile_page_url = match video_id.as_deref() {
        Some(video_id) if !video_id.is_empty() => {
            format!("https://m.maoyan.com/asgard/movie/{movie_id}?videoId={video_id}")
        }
        _ => format!("https://m.maoyan.com/asgard/movie/{movie_id}"),
    };

    let mobile_page =
        super::fetch_text_value(&mobile_page_url, Some(maoyan_mobile_headers())).await?;
    if let Some(play_url) = extract_maoyan_video_url_from_page(&mobile_page, video_id.as_deref()) {
        return Ok(Some(play_url));
    }

    let ajax_url = format!("https://m.maoyan.com/ajax/detailmovie?movieId={movie_id}");
    let ajax_payload = super::fetch_text_value(&ajax_url, Some(maoyan_ajax_headers())).await?;
    Ok(extract_maoyan_video_url_from_detail(&ajax_payload))
}

async fn resolve_mtime_play_url(source_url: &str) -> Result<Option<String>, String> {
    let Some(video_id) = mtime_video_id(source_url) else {
        return Ok(None);
    };
    let api_url = format!(
        "https://front-gateway.mtime.com/video/play_url?video_id={video_id}&source=1&scheme=https"
    );
    let payload = super::fetch_json_value(&api_url, Some(mtime_headers(source_url))).await?;
    let Some(items) = payload.get("data").and_then(Value::as_array) else {
        return Ok(None);
    };
    let best = items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let url = object.get("url").and_then(super::stringify_json_value)?;
            let resolution = object
                .get("resolutionType")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let file_size = object
                .get("fileSize")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            Some((resolution, file_size, url))
        })
        .max_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    Ok(best.map(|(_, _, url)| url))
}

fn mtime_video_id(source_url: &str) -> Option<String> {
    let parsed = url::Url::parse(source_url).ok()?;
    parsed
        .path_segments()
        .and_then(|segments| segments.filter(|segment| !segment.is_empty()).next_back())
        .map(str::trim)
        .filter(|segment| segment.chars().all(|ch| ch.is_ascii_digit()))
        .map(ToOwned::to_owned)
}

fn mtime_headers(source_url: &str) -> HashMap<String, String> {
    HashMap::from([
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string(),
        ),
        ("Referer".to_string(), source_url.to_string()),
        ("Accept".to_string(), "application/json".to_string()),
    ])
}

fn maoyan_mobile_headers() -> HashMap<String, String> {
    HashMap::from([
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1".to_string(),
        ),
        ("Referer".to_string(), "https://m.maoyan.com/".to_string()),
        ("Accept".to_string(), "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8".to_string()),
    ])
}

fn maoyan_ajax_headers() -> HashMap<String, String> {
    HashMap::from([
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1".to_string(),
        ),
        ("Referer".to_string(), "https://m.maoyan.com/".to_string()),
        ("X-Requested-With".to_string(), "XMLHttpRequest".to_string()),
        ("Accept".to_string(), "application/json".to_string()),
    ])
}

fn browser_headers(source_url: &str) -> HashMap<String, String> {
    HashMap::from([
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".to_string(),
        ),
        ("Referer".to_string(), source_url.to_string()),
        ("Accept".to_string(), "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8".to_string()),
    ])
}

fn normalize_movie_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return normalize_known_site_url(trimmed);
    }
    if trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return format!("{YGP_SITE_BASE}/movie/{trimmed}");
    }
    format!("{YGP_SITE_BASE}/movie/{}", trimmed.trim_start_matches('/'))
}

fn decode_first_detail_id(args: &[(&str, String)]) -> Option<String> {
    use base64::Engine as _;

    let raw = super::arg_value(args, 0)?.trim();
    let encoded = raw.split(',').find(|value| !value.trim().is_empty())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .ok()?;
    let decoded = String::from_utf8(bytes).ok()?;
    let trimmed = decoded.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn summarize_player_id(raw_id: &str) -> String {
    let (show_url, download_url) = split_episode_token(raw_id);
    match download_url {
        Some(download_url) => format!(
            "show={} download={}",
            summarize_url(&show_url),
            summarize_url(&download_url)
        ),
        None => summarize_url(&show_url),
    }
}

fn summarize_url(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= 120 {
        return trimmed.to_string();
    }
    format!("{}...", &trimmed[..120])
}

fn movie_id_from_url(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()?
        .path_segments()?
        .filter(|segment| !segment.is_empty())
        .next_back()
        .map(str::trim)
        .filter(|segment| segment.chars().all(|ch| ch.is_ascii_digit()))
        .map(ToOwned::to_owned)
}

fn clean_inline_text(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("\\/", "/")
        .replace("  ", " ")
        .replace('\u{a0}', " ")
        .replace('�', "")
        .trim()
        .to_string()
}

fn clean_search_meta(value: &str) -> String {
    let cleaned = clean_inline_text(value);
    cleaned.trim().trim_end_matches(']').trim().to_string()
}

fn flatten_markdown_text(value: &str) -> String {
    let without_images = markdown_image_regex().replace_all(value, "");
    let without_links = markdown_link_regex()
        .replace_all(&without_images, "$label")
        .to_string();
    clean_inline_text(&without_links)
}

fn normalize_known_site_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix("http://www.6huo.com/") {
        return format!("https://www.6huo.com/{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://m.6huo.com/") {
        return format!("https://m.6huo.com/{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://www.maoyan.com/") {
        return format!("https://www.maoyan.com/{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://video.mtime.com/") {
        return format!("https://video.mtime.com/{rest}");
    }
    trimmed.to_string()
}

fn normalize_asset_url(raw: &str) -> String {
    normalize_known_site_url(raw)
}

fn normalize_detail_title(value: &str) -> String {
    let mut title = clean_inline_text(value);
    for marker in [
        "高清电影预告片下载",
        "高清电影预告片",
        "电影预告片下载",
        "电影预告片",
    ] {
        if let Some((head, _)) = title.split_once(marker) {
            title = clean_inline_text(head);
            break;
        }
    }
    title.trim_end_matches('-').trim().to_string()
}

fn extract_direct_media_url(body: &str) -> Option<String> {
    direct_media_url_regex()
        .captures_iter(&body.replace("\\/", "/"))
        .filter_map(|captures| {
            captures
                .name("url")
                .map(|value| normalize_known_site_url(value.as_str()))
        })
        .find(|url| is_direct_media_url(url))
}

fn maoyan_identifiers(source_url: &str) -> Option<(String, Option<String>)> {
    let parsed = url::Url::parse(source_url).ok()?;
    let mut segments = parsed
        .path_segments()?
        .filter(|segment| !segment.is_empty());
    let first = segments.next()?;
    if first != "films" {
        return None;
    }
    let movie_id = segments.next()?.trim().to_string();
    if movie_id.is_empty() {
        return None;
    }
    let video_id = parsed
        .query_pairs()
        .find(|(key, _)| key == "videoId")
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Some((movie_id, video_id))
}

fn extract_maoyan_video_url_from_page(body: &str, video_id: Option<&str>) -> Option<String> {
    let captures = maoyan_appdata_regex().captures(body)?;
    let raw = captures.name("json")?.as_str();
    let parsed: Value = serde_json::from_str(raw).ok()?;
    let related = parsed
        .pointer("/videoRelatedInfo/videoRelateds")
        .and_then(Value::as_array)?;

    if let Some(target_id) = video_id {
        if let Some(url) = related.iter().find_map(|item| {
            let id_matches = item
                .get("id")
                .and_then(Value::as_i64)
                .map(|value| value.to_string() == target_id)
                .unwrap_or(false);
            if !id_matches {
                return None;
            }
            item.pointer("/video/url")
                .and_then(super::stringify_json_value)
                .map(|value| normalize_known_site_url(&value))
        }) {
            return Some(url);
        }
    }

    related.iter().find_map(|item| {
        item.pointer("/video/url")
            .and_then(super::stringify_json_value)
            .map(|value| normalize_known_site_url(&value))
    })
}

fn extract_maoyan_video_url_from_detail(body: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(body).ok()?;
    parsed
        .pointer("/detailMovie/videourl")
        .and_then(super::stringify_json_value)
        .map(|value| normalize_known_site_url(&value))
}

fn table_item_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r#"\[!\[Image[^\]]*\]\((?P<pic>https?://[^\)]+)\)\]\((?P<movie>https?://www\.6huo\.com/movie/\d+)\)"#,
        )
        .expect("valid ygp table regex")
    });
    &REGEX
}

fn markdown_image_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"!\[[^\]]*\]\([^)]+\)"#).expect("valid markdown image regex")
    });
    &REGEX
}

fn markdown_link_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"\[(?P<label>[^\]]+)\]\([^)]+\)"#).expect("valid markdown link regex")
    });
    &REGEX
}

fn direct_media_url_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"(?P<url>https?://[^"'\\\s<>]+?\.(?:mp4|m3u8)(?:\?[^"'\\\s<>]*)?)"#)
            .expect("valid direct media url regex")
    });
    &REGEX
}

fn maoyan_appdata_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"(?s)window\.AppData=(?P<json>\{.*?\})\s*;\s*</script>"#)
            .expect("valid maoyan appdata regex")
    });
    &REGEX
}

fn search_item_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r#"^\*\s+\[!\[Image[^\]]*\]\((?P<pic>https?://[^\)]+)\)(?P<body>[^\]]*)\]\((?P<movie>https?://www\.6huo\.com/movie/\d+)(?:\s+"[^"]*")?\)"#,
        )
        .expect("valid ygp search regex")
    });
    &REGEX
}

fn search_meta_start_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"\s(?:(?:19|20)\d{2}-\d{2}-\d{2}|豆瓣\d+(?:\.\d+)?|豆瓣|上映|视频)"#)
            .expect("valid ygp search meta regex")
    });
    &REGEX
}

fn main_heading_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"(?m)^#\s+(?P<title>[^\n]+)$"#).expect("valid ygp heading regex")
    });
    &REGEX
}

fn detail_movie_heading_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"(?m)^#\s+(?P<title>[^\n]+)$"#).expect("valid ygp movie detail heading regex")
    });
    &REGEX
}

fn detail_poster_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r#"\[!\[Image[^\]]*\]\((?P<pic>https?://[^\)]+)\)\]\(https?://www\.6huo\.com/movie/\d+/poster#content-anchor"#,
        )
        .expect("valid ygp poster regex")
    });
    &REGEX
}

fn detail_episode_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r#"(?m)^\|\s*\[!\[Image[^\]]*\]\([^)]+\)\]\((?P<show>https?://www\.6huo\.com/show/\d+)\)\s*\|\s*\[(?P<title>[^\]]+)\]\([^)]+\)\d{2}:\d{2}\s*\|\s*\[下载\]\((?P<download>https?://www\.6huo\.com/download/\d+)"#,
        )
        .expect("valid ygp detail episode regex")
    });
    &REGEX
}

fn source_link_regex() -> &'static Regex {
    static REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r#"\|\[!\[Image[^\]]*视频来源[^\]]*\]\([^)]+\)\]\((?P<url>https?://[^)]+)\)"#)
            .expect("valid ygp source link regex")
    });
    &REGEX
}

#[cfg(test)]
mod tests {
    use super::{
        build_episode_token, extract_maoyan_video_url_from_page, mtime_video_id,
        normalize_known_site_url, normalize_tid, parse_catalog_items, parse_detail_payload,
        parse_search_items, split_episode_token,
    };

    #[test]
    fn parses_later_table_items() {
        let markdown = r#"
| [![Image 1: 蜂蜜的针](https://www.6huo.com/files/mpic/202603/p85646.jpg?4905)](https://www.6huo.com/movie/85646) | [蜂蜜的针](https://www.6huo.com/movie/85646) 中国大陆,爱情,悬疑,犯罪 | 2026-03-28 | [预告片](https://www.6huo.com/movie/85646) | 9888 |
"#;
        let items = parse_catalog_items(markdown);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["vod_id"], "https://www.6huo.com/movie/85646");
        assert_eq!(items[0]["vod_name"], "蜂蜜的针");
        assert_eq!(items[0]["vod_remarks"], "2026-03-28");
    }

    #[test]
    fn parses_search_items() {
        let markdown = r#"
*   [![Image 13: 蜂蜜的针](https://www.6huo.com/files/mpic/202603/p85646.jpg?4905)蜂蜜的针 2026-03-28上映 4视频](https://www.6huo.com/movie/85646)
"#;
        let items = parse_search_items(markdown);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["vod_name"], "蜂蜜的针");
    }

    #[test]
    fn parses_mixed_catalog_blocks_and_stops_before_footer() {
        let markdown = r#"
## 热搜榜
*   [![Image 1: 河狸变身计划](http://www.6huo.com/files/mpic/202507/p83401.jpg?3248)河狸变身计划 2026-03-20上映 16视频](http://www.6huo.com/movie/83401)

## 2026年03月上映电影 (共1部)
|  | 2026年03月上映电影 | 上映日期 | 素材 | 热度 |
| --- | --- | --- | --- | --- |
| [![Image 13: 蜂蜜的针](https://www.6huo.com/files/mpic/202603/p85646.jpg?4905)](https://www.6huo.com/movie/85646) | [蜂蜜的针](https://www.6huo.com/movie/85646) 中国大陆,爱情,悬疑,犯罪 | 2026-03-28 | [预告片](https://www.6huo.com/movie/85646) | 10255 |

### 正在热映
*   [![Image 32: 挽救计划](https://www.6huo.com/files/mpic/202401/p43236.jpg?5232)挽救计划](https://www.6huo.com/movie/43236 "挽救计划")
"#;
        let items = parse_catalog_items(markdown);
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0]["vod_pic"],
            "https://www.6huo.com/files/mpic/202507/p83401.jpg?3248"
        );
        assert_eq!(items[0]["vod_name"], "河狸变身计划");
        assert_eq!(items[1]["vod_name"], "蜂蜜的针");
        assert_eq!(items[1]["vod_remarks"], "2026-03-28");
    }

    #[test]
    fn parses_detail_with_play_routes() {
        let markdown = r#"
[![Image 13: 蜂蜜的针](https://www.6huo.com/files/mpic/202603/p85646.jpg?4905)](https://www.6huo.com/movie/85646/poster#content-anchor "蜂蜜的针电影海报")

# 蜂蜜的针

类型：[中国大陆](https://www.6huo.com/country/x) / [爱情](https://www.6huo.com/movietype/a)

上映：2026-03-28(中国大陆)

导演：[袁梅](https://www.6huo.com/?view=search&keyword=%E8%A2%81%E6%A2%85)主演：[袁泉](https://www.6huo.com/?view=search&keyword=%E8%A2%81%E6%B3%89)

剧情：性格孤僻的农科院研究员支宁。 [(详细)](https://www.6huo.com/movie/85646#content-summary "蜂蜜的针剧情介绍")

## 全部预告 (1)

| 预告片 |  | 下载 | 发布时间 | 来源 | 热度 |
| --- | --- | --- | --- | --- | --- |
| [![Image 19](https://img5.mtime.cn/mg/2026/03/25/111358.26825920_235X132X4.jpg)](https://www.6huo.com/show/195152) | [《蜂蜜的针》终极预告](https://www.6huo.com/show/195152)01:42 | [下载](https://www.6huo.com/download/160001 "查看下载链接") | 3月25日 11:28 | [![Image 15: 视频来源](https://static1.mtime.cn/favicon.ico) 预览](https://www.6huo.com/show/195152) | 336 |
"#;
        let detail = parse_detail_payload("https://www.6huo.com/movie/85646", markdown)
            .expect("detail payload");
        assert_eq!(detail["vod_id"], "85646");
        assert_eq!(detail["vod_name"], "蜂蜜的针");
        assert_eq!(
            detail["vod_pic"],
            "https://www.6huo.com/files/mpic/202603/p85646.jpg?4905"
        );
        assert_eq!(detail["vod_play_from"], "预告片");
        assert!(detail["vod_play_url"]
            .as_str()
            .expect("play url")
            .contains("https://www.6huo.com/show/195152@@https://www.6huo.com/download/160001"));
    }

    #[test]
    fn parses_mtime_video_id() {
        assert_eq!(
            mtime_video_id("https://video.mtime.com/89032/?mid=227553"),
            Some("89032".to_string())
        );
    }

    #[test]
    fn normalizes_default_tid() {
        assert_eq!(normalize_tid("movlist/"), "later");
        assert_eq!(normalize_tid(""), "later");
    }

    #[test]
    fn preserves_episode_download_token() {
        let token = build_episode_token(
            "https://www.6huo.com/show/195152",
            Some("https://www.6huo.com/download/160001"),
        );
        let (show_url, download_url) = split_episode_token(&token);
        assert_eq!(show_url, "https://www.6huo.com/show/195152");
        assert_eq!(
            download_url.as_deref(),
            Some("https://www.6huo.com/download/160001")
        );
    }

    #[test]
    fn extracts_maoyan_direct_video_from_mobile_appdata() {
        let body = r#"
<script>
window.AppData={"videoRelatedInfo":{"videoRelateds":[
  {"id":521902,"video":{"url":"https://vod.pipi.cn/example-second.mp4"}},
  {"id":522059,"video":{"url":"https://vod.pipi.cn/example-first.mp4"}}
]}}
;</script>
"#;
        let url = extract_maoyan_video_url_from_page(body, Some("522059"));
        assert_eq!(
            url.as_deref(),
            Some("https://vod.pipi.cn/example-first.mp4")
        );
    }

    #[test]
    fn normalizes_known_site_http_urls() {
        assert_eq!(
            normalize_known_site_url("http://www.6huo.com/movie/83401"),
            "https://www.6huo.com/movie/83401"
        );
        assert_eq!(
            normalize_known_site_url("http://video.mtime.com/89032"),
            "https://video.mtime.com/89032"
        );
    }
}
