use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use axum::extract::{Multipart, Path as AxumPath, Query};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_NONE_MATCH,
    RANGE,
};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use bytes::Bytes;
use chrono::{DateTime, Local};
use reqwest::Client;
use zip::ZipArchive;

const DEFAULT_ANDROID_RUNTIME_UA: &str =
    "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36";

pub(crate) fn register_routes<S>(router: Router<S>) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    router
        .route("/action", post(handle_action))
        .route("/device", get(handle_device))
        .route("/media", get(handle_media))
        .route("/m3u8", get(handle_m3u8))
        .route("/file", get(handle_file_root))
        .route("/file/{*path}", get(handle_file_path))
        .route("/upload", post(handle_upload))
        .route("/newFolder", post(handle_new_folder))
        .route("/delFolder", post(handle_delete_folder))
        .route("/delFile", post(handle_delete_file))
        .route("/", get(handle_static_root))
        .route("/{*path}", get(handle_static_asset))
}

async fn handle_action(
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let mut values = query;
    values.extend(extract_body_map(&headers, &body));
    let action = values.get("do").cloned().unwrap_or_default();
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService][action] do={} payload={}",
        action,
        serde_json::to_string(&values).unwrap_or_else(|_| "{}".to_string())
    ));
    (StatusCode::OK, "OK")
}

async fn handle_media() -> impl IntoResponse {
    let payload = serde_json::json!({
        "url": "",
        "state": -1,
        "speed": -1.0,
        "title": "",
        "artist": ""
    });
    (
        StatusCode::OK,
        [(CONTENT_TYPE, "application/json; charset=utf-8")],
        payload.to_string(),
    )
}

async fn handle_device() -> impl IntoResponse {
    let payload = serde_json::json!({
        "brand": "Google",
        "model": "Pixel 6",
        "product": "coral",
        "device": "coral",
        "manufacturer": "Google",
        "release": "11",
        "sdk": 30,
        "userAgent": DEFAULT_ANDROID_RUNTIME_UA,
        "platform": "android",
    });
    (
        StatusCode::OK,
        [(CONTENT_TYPE, "application/json; charset=utf-8")],
        payload.to_string(),
    )
}

async fn handle_m3u8(Query(params): Query<HashMap<String, String>>) -> Response {
    let Some(url) = params
        .get("url")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return (StatusCode::BAD_REQUEST, "missing m3u8 url").into_response();
    };

    let mut request = runtime_http_client().get(url);
    let referer = params
        .get("referer")
        .map(|value| value.trim())
        .unwrap_or("");
    if !referer.is_empty() {
        request = request.header("Referer", referer);
    }
    let user_agent = params.get("ua").map(|value| value.trim()).unwrap_or("");
    request = request.header(
        "User-Agent",
        if user_agent.is_empty() {
            DEFAULT_ANDROID_RUNTIME_UA
        } else {
            user_agent
        },
    );
    let cookie = params.get("cookie").map(|value| value.trim()).unwrap_or("");
    if !cookie.is_empty() {
        request = request.header("Cookie", cookie);
    }

    let upstream = match request.send().await {
        Ok(value) => value,
        Err(err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderLocalService][m3u8] fetch failed {} -> {}",
                url, err
            ));
            return (
                StatusCode::BAD_GATEWAY,
                format!("fetch desktop spider m3u8 failed: {err}"),
            )
                .into_response();
        }
    };

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let body = match upstream.bytes().await {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("read desktop spider m3u8 failed: {err}"),
            )
                .into_response();
        }
    };

    let mut response = (status, body).into_response();
    let headers = response.headers_mut();
    headers.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        HeaderValue::from_static("*"),
    );

    if let Some(content_type) = upstream_headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
    {
        if let Ok(value) = HeaderValue::from_str(content_type) {
            headers.insert(CONTENT_TYPE, value);
        }
    } else {
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/vnd.apple.mpegurl"),
        );
    }

    if let Some(cache_control) = upstream_headers
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty())
    {
        if let Ok(value) = HeaderValue::from_str(cache_control) {
            headers.insert(CACHE_CONTROL, value);
        }
    }

    response
}

async fn handle_file_root(headers: HeaderMap) -> Response {
    handle_file_request(String::new(), headers).await
}

async fn handle_file_path(AxumPath(path): AxumPath<String>, headers: HeaderMap) -> Response {
    handle_file_request(path, headers).await
}

async fn handle_file_request(raw_path: String, headers: HeaderMap) -> Response {
    let Some(relative_path) = sanitize_relative_path(&raw_path) else {
        return (StatusCode::BAD_REQUEST, "invalid desktop spider file path").into_response();
    };

    let storage_root = ensure_storage_root();
    let storage_target = storage_root.join(&relative_path);
    if relative_path.as_os_str().is_empty() || storage_target.is_dir() {
        return (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/json; charset=utf-8")],
            directory_listing_response(&storage_root, &storage_target).to_string(),
        )
            .into_response();
    }

    if storage_target.is_file() {
        return serve_file_with_range(&storage_target, &headers).await;
    }

    for root in runtime_asset_roots() {
        let candidate = root.join(&relative_path);
        if candidate.is_file() {
            return serve_file_with_range(&candidate, &headers).await;
        }
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService][file] missing {}",
        relative_path.display()
    ));
    (
        StatusCode::NOT_FOUND,
        format!("desktop spider file not found: {}", relative_path.display()),
    )
        .into_response()
}

async fn handle_upload(mut multipart: Multipart) -> Response {
    let mut relative_root = PathBuf::new();
    let mut uploads = Vec::new();

    loop {
        let next = match multipart.next_field().await {
            Ok(value) => value,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("parse upload payload failed: {err}"),
                )
                    .into_response();
            }
        };
        let Some(field) = next else {
            break;
        };

        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "path" {
            let value = match field.text().await {
                Ok(value) => value,
                Err(err) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        format!("read upload path failed: {err}"),
                    )
                        .into_response();
                }
            };
            let Some(sanitized) = sanitize_relative_path(&value) else {
                return (StatusCode::BAD_REQUEST, "invalid upload target path").into_response();
            };
            relative_root = sanitized;
            continue;
        }

        let filename = field.file_name().unwrap_or("").trim().to_string();
        if filename.is_empty() {
            continue;
        }
        let bytes = match field.bytes().await {
            Ok(value) => value,
            Err(err) => {
                return (
                    StatusCode::BAD_REQUEST,
                    format!("read upload bytes failed: {err}"),
                )
                    .into_response();
            }
        };
        uploads.push((filename, bytes));
    }

    let target_root = ensure_storage_root().join(&relative_root);
    if let Err(err) = fs::create_dir_all(&target_root) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("create upload target failed: {err}"),
        )
            .into_response();
    }

    let upload_count = uploads.len();
    for (filename, bytes) in uploads {
        if filename.to_ascii_lowercase().ends_with(".zip") {
            if let Err(err) = extract_uploaded_zip(&target_root, &bytes) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("extract zip upload failed: {err}"),
                )
                    .into_response();
            }
            continue;
        }

        let Some(safe_name) = sanitize_single_filename(&filename) else {
            continue;
        };
        let destination = target_root.join(safe_name);
        if let Some(parent) = destination.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("prepare upload folder failed: {err}"),
                )
                    .into_response();
            }
        }
        if let Err(err) = fs::write(&destination, &bytes) {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("write upload file failed: {err}"),
            )
                .into_response();
        }
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService][upload] saved {} item(s) under {}",
        upload_count,
        target_root.display()
    ));
    (StatusCode::OK, "OK").into_response()
}

async fn handle_new_folder(headers: HeaderMap, body: Bytes) -> Response {
    let values = extract_body_map(&headers, &body);
    let Some(parent_rel) = values
        .get("path")
        .and_then(|value| sanitize_relative_path(value))
    else {
        return (StatusCode::BAD_REQUEST, "invalid new folder parent path").into_response();
    };
    let folder_name = values.get("name").map(|value| value.trim()).unwrap_or("");
    let Some(folder_name) = sanitize_single_filename(folder_name) else {
        return (StatusCode::BAD_REQUEST, "invalid new folder name").into_response();
    };

    let target = ensure_storage_root().join(parent_rel).join(folder_name);
    match fs::create_dir_all(&target) {
        Ok(_) => (StatusCode::OK, "OK").into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("create new folder failed: {err}"),
        )
            .into_response(),
    }
}

async fn handle_delete_folder(headers: HeaderMap, body: Bytes) -> Response {
    delete_storage_path(headers, body, true).await
}

async fn handle_delete_file(headers: HeaderMap, body: Bytes) -> Response {
    delete_storage_path(headers, body, false).await
}

async fn delete_storage_path(headers: HeaderMap, body: Bytes, directory: bool) -> Response {
    let values = extract_body_map(&headers, &body);
    let Some(relative) = values
        .get("path")
        .and_then(|value| sanitize_relative_path(value))
    else {
        return (StatusCode::BAD_REQUEST, "invalid delete path").into_response();
    };
    let target = ensure_storage_root().join(relative);
    let result = if directory {
        fs::remove_dir_all(&target)
    } else if target.is_dir() {
        fs::remove_dir_all(&target)
    } else {
        fs::remove_file(&target)
    };

    match result {
        Ok(_) => (StatusCode::OK, "OK").into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("delete path failed: {err}"),
        )
            .into_response(),
    }
}

async fn handle_static_root() -> Response {
    serve_runtime_asset("index.html", &HeaderMap::new()).await
}

async fn handle_static_asset(AxumPath(path): AxumPath<String>, headers: HeaderMap) -> Response {
    serve_runtime_asset(&path, &headers).await
}

async fn serve_runtime_asset(path: &str, headers: &HeaderMap) -> Response {
    let normalized = if path.trim().is_empty() {
        "index.html"
    } else {
        path
    };
    let Some(relative) = sanitize_relative_path(normalized) else {
        return (StatusCode::BAD_REQUEST, "invalid spider runtime asset path").into_response();
    };

    for root in runtime_asset_roots() {
        let candidate = root.join(&relative);
        if candidate.is_file() {
            return serve_file_with_range(&candidate, headers).await;
        }
    }

    (
        StatusCode::NOT_FOUND,
        "desktop spider runtime asset not found",
    )
        .into_response()
}

fn ensure_storage_root() -> PathBuf {
    let root = std::env::var("HALO_SPIDER_STORAGE_ROOT")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .ok()
                .map(PathBuf::from)
                .map(|home| home.join(".halo").join("spider_data").join("files"))
        })
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".halo")
                .join("spider_data")
                .join("files")
        });
    let _ = fs::create_dir_all(&root);
    root
}

fn runtime_asset_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(explicit) = std::env::var("HALO_TVBOX_RUNTIME_ROOT") {
        roots.push(PathBuf::from(explicit));
    }

    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("src-tauri").join("TVBox"));
        roots.push(cwd.join("TVBox"));
        roots.push(cwd.join("src-tauri").join("resources").join("TVBox"));
        roots.push(cwd.join("apk").join("work").join("unpacked").join("assets"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            roots.push(exe_dir.join("TVBox"));
            roots.push(exe_dir.join("resources").join("TVBox"));
        }
    }

    roots
}

fn runtime_http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("desktop spider runtime client should build")
    })
}

fn sanitize_relative_path(raw: &str) -> Option<PathBuf> {
    let mut trimmed = raw.trim();
    if let Some(stripped) = trimmed.strip_prefix("file:/") {
        trimmed = stripped;
    }
    let trimmed = trimmed.trim_matches('/');
    if trimmed.is_empty() {
        return Some(PathBuf::new());
    }

    let mut result = PathBuf::new();
    for component in PathBuf::from(trimmed.replace('\\', "/")).components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }

    Some(result)
}

fn sanitize_single_filename(raw: &str) -> Option<String> {
    let path = sanitize_relative_path(raw)?;
    if path.components().count() != 1 {
        return None;
    }
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
}

fn directory_listing_response(root: &Path, directory: &Path) -> serde_json::Value {
    let parent = if same_path(directory, root) {
        ".".to_string()
    } else {
        directory
            .parent()
            .and_then(|parent| parent.strip_prefix(root).ok())
            .map(to_runtime_path)
            .unwrap_or_else(|| ".".to_string())
    };

    let mut nodes = fs::read_dir(directory)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .filter_map(|entry| {
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            Some(serde_json::json!({
                "name": entry.file_name().to_string_lossy().to_string(),
                "time": format_system_time(metadata.modified().ok()),
                "path": path.strip_prefix(root).ok().map(to_runtime_path).unwrap_or_default(),
                "dir": if metadata.is_dir() { 1 } else { 0 }
            }))
        })
        .collect::<Vec<_>>();

    nodes.sort_by(|left, right| {
        let left_dir = left
            .get("dir")
            .and_then(|value| value.as_i64())
            .unwrap_or_default();
        let right_dir = right
            .get("dir")
            .and_then(|value| value.as_i64())
            .unwrap_or_default();
        right_dir.cmp(&left_dir).then_with(|| {
            left.get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .cmp(
                    right
                        .get("name")
                        .and_then(|value| value.as_str())
                        .unwrap_or(""),
                )
        })
    });

    serde_json::json!({
        "parent": parent,
        "files": nodes
    })
}

fn same_path(left: &Path, right: &Path) -> bool {
    left.components().eq(right.components())
}

fn to_runtime_path(path: &Path) -> String {
    let rendered = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if rendered.is_empty() {
        String::new()
    } else {
        format!("/{rendered}")
    }
}

fn format_system_time(value: Option<SystemTime>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let date: DateTime<Local> = value.into();
    date.format("%Y/%m/%d %H:%M:%S").to_string()
}

async fn serve_file_with_range(path: &Path, headers: &HeaderMap) -> Response {
    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("read file metadata failed: {err}"),
            )
                .into_response();
        }
    };

    let length = metadata.len();
    let etag = format!(
        "{:x}",
        md5::compute(format!(
            "{}:{}:{}",
            path.display(),
            metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or_default(),
            length
        ))
    );

    if headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| value == "*" || value == etag)
        .unwrap_or(false)
    {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        attach_file_headers(&mut response, path, 0, length, Some((0, 0)), &etag, false);
        return response;
    }

    let mut file = match fs::File::open(path) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("open file failed: {err}"),
            )
                .into_response();
        }
    };

    if let Some((start, end)) = parse_range_header(headers, length) {
        let end = end.min(length.saturating_sub(1));
        if start >= length || end < start {
            let mut response = (StatusCode::RANGE_NOT_SATISFIABLE, "").into_response();
            if let Ok(value) = HeaderValue::from_str(&format!("bytes */{length}")) {
                response.headers_mut().insert(CONTENT_RANGE, value);
            }
            if let Ok(value) = HeaderValue::from_str(&etag) {
                response.headers_mut().insert(ETAG, value);
            }
            return response;
        }

        let slice_length = end - start + 1;
        let mut buffer = vec![0u8; slice_length as usize];
        if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buffer).is_err() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "read ranged file content failed",
            )
                .into_response();
        }

        let mut response = (
            StatusCode::PARTIAL_CONTENT,
            [(CONTENT_TYPE, infer_content_type(path))],
            buffer,
        )
            .into_response();
        attach_file_headers(
            &mut response,
            path,
            slice_length,
            length,
            Some((start, end)),
            &etag,
            true,
        );
        return response;
    }

    let body = match fs::read(path) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("read file content failed: {err}"),
            )
                .into_response();
        }
    };
    let mut response = (
        StatusCode::OK,
        [(CONTENT_TYPE, infer_content_type(path))],
        body,
    )
        .into_response();
    attach_file_headers(&mut response, path, length, length, None, &etag, false);
    response
}

fn attach_file_headers(
    response: &mut Response,
    path: &Path,
    content_length: u64,
    total_length: u64,
    range: Option<(u64, u64)>,
    etag: &str,
    partial: bool,
) {
    let headers = response.headers_mut();
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(value) = HeaderValue::from_str(etag) {
        headers.insert(ETAG, value);
    }
    if let Ok(value) = HeaderValue::from_str(&content_length.to_string()) {
        headers.insert(CONTENT_LENGTH, value);
    }
    if partial {
        if let Some((start, end)) = range {
            if let Ok(value) = HeaderValue::from_str(&format!("bytes {start}-{end}/{total_length}"))
            {
                headers.insert(CONTENT_RANGE, value);
            }
        }
    }
    if !headers.contains_key(CONTENT_TYPE) {
        if let Ok(value) = HeaderValue::from_str(infer_content_type(path)) {
            headers.insert(CONTENT_TYPE, value);
        }
    }
}

fn parse_range_header(headers: &HeaderMap, total_length: u64) -> Option<(u64, u64)> {
    let value = headers.get(RANGE)?.to_str().ok()?.trim();
    let raw = value.strip_prefix("bytes=")?;
    let (start_raw, end_raw) = raw.split_once('-')?;
    let start = start_raw.parse::<u64>().ok()?;
    let end = if end_raw.trim().is_empty() {
        total_length.saturating_sub(1)
    } else {
        end_raw.parse::<u64>().ok()?
    };
    Some((start, end))
}

fn infer_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("txt") | Some("log") | Some("xml") => "text/plain; charset=utf-8",
        Some("m3u8") => "application/vnd.apple.mpegurl",
        Some("ico") => "image/x-icon",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

fn extract_uploaded_zip(target_root: &Path, bytes: &[u8]) -> Result<(), String> {
    let cursor = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(cursor).map_err(|err| format!("open zip archive failed: {err}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("open zip entry failed: {err}"))?;
        let Some(relative) = sanitize_relative_path(entry.name()) else {
            continue;
        };
        let destination = target_root.join(relative);
        if entry.name().ends_with('/') || entry.is_dir() {
            fs::create_dir_all(&destination)
                .map_err(|err| format!("create extracted directory failed: {err}"))?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("create extracted parent failed: {err}"))?;
        }
        let mut output = fs::File::create(&destination)
            .map_err(|err| format!("create extracted file failed: {err}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|err| format!("write extracted file failed: {err}"))?;
    }
    Ok(())
}

fn extract_body_map(headers: &HeaderMap, body: &[u8]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body_text = String::from_utf8_lossy(body);

    if content_type.contains("application/x-www-form-urlencoded") {
        for (key, value) in url::form_urlencoded::parse(body_text.as_bytes()) {
            values.insert(key.into_owned(), value.into_owned());
        }
    } else if content_type.contains("application/json") {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) {
            if let Some(object) = json.as_object() {
                for (key, value) in object {
                    match value {
                        serde_json::Value::Null => {}
                        serde_json::Value::String(text) => {
                            values.insert(key.clone(), text.clone());
                        }
                        other => {
                            values.insert(key.clone(), other.to_string());
                        }
                    }
                }
            }
        }
    } else if !body_text.trim().is_empty() {
        values.insert("body".to_string(), body_text.trim().to_string());
    }

    values
}

#[cfg(test)]
mod tests {
    use super::register_routes;
    use axum::http::header::CONTENT_TYPE;
    use axum::response::IntoResponse;
    use axum::{routing::get, serve, Router};
    use reqwest::StatusCode;
    use std::fs;
    use tokio::net::TcpListener;

    fn temp_storage_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("halo-spider-storage-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp storage root should be created");
        root
    }

    async fn spawn_router() -> String {
        let app = register_routes(Router::new());
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("android runtime router should bind");
        let addr = listener
            .local_addr()
            .expect("router should have local addr");
        tokio::spawn(async move {
            serve(listener, app)
                .await
                .expect("android runtime router should run");
        });
        format!("http://{addr}")
    }

    async fn spawn_upstream_router() -> String {
        async fn upstream_playlist() -> impl IntoResponse {
            (
                [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nhttps://example.com/segment.ts\n",
            )
        }

        let app = Router::new().route("/playlist.m3u8", get(upstream_playlist));
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("upstream router should bind");
        let addr = listener
            .local_addr()
            .expect("upstream router should have local addr");
        tokio::spawn(async move {
            serve(listener, app)
                .await
                .expect("upstream router should run");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn android_runtime_file_route_lists_storage_root() {
        let storage = temp_storage_root();
        std::env::set_var("HALO_SPIDER_STORAGE_ROOT", &storage);
        fs::write(storage.join("a.txt"), "hello").expect("test file should exist");
        fs::create_dir_all(storage.join("folder")).expect("test directory should exist");

        let base_url = spawn_router().await;
        let response = reqwest::Client::new()
            .get(format!("{base_url}/file"))
            .send()
            .await
            .expect("file route should respond");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response
            .json::<serde_json::Value>()
            .await
            .expect("file payload should be json");
        assert_eq!(payload["parent"], ".");
        assert_eq!(
            payload["files"].as_array().map(|items| items.len()),
            Some(2)
        );
    }

    #[tokio::test]
    async fn android_runtime_action_route_returns_ok() {
        let base_url = spawn_router().await;
        let response = reqwest::Client::new()
            .post(format!("{base_url}/action"))
            .header("content-type", "application/x-www-form-urlencoded")
            .body("do=push&url=https%3A%2F%2Fexample.com%2Fplay")
            .send()
            .await
            .expect("action route should respond");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .text()
                .await
                .expect("action body should be readable"),
            "OK"
        );
    }

    #[tokio::test]
    async fn android_runtime_media_route_returns_default_payload() {
        let base_url = spawn_router().await;
        let response = reqwest::Client::new()
            .get(format!("{base_url}/media"))
            .send()
            .await
            .expect("media route should respond");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response
            .json::<serde_json::Value>()
            .await
            .expect("media payload should be json");
        assert_eq!(payload["state"], -1);
        assert_eq!(payload["url"], "");
    }

    #[tokio::test]
    async fn android_runtime_device_route_returns_android_stub() {
        let base_url = spawn_router().await;
        let response = reqwest::Client::new()
            .get(format!("{base_url}/device"))
            .send()
            .await
            .expect("device route should respond");
        assert_eq!(response.status(), StatusCode::OK);
        let payload = response
            .json::<serde_json::Value>()
            .await
            .expect("device payload should be json");
        assert_eq!(payload["platform"], "android");
        assert_eq!(payload["sdk"], 30);
    }

    #[tokio::test]
    async fn android_runtime_m3u8_route_proxies_playlist() {
        let upstream = spawn_upstream_router().await;
        let base_url = spawn_router().await;
        let upstream_url = format!("{upstream}/playlist.m3u8");
        let encoded =
            url::form_urlencoded::byte_serialize(upstream_url.as_bytes()).collect::<String>();
        let response = reqwest::Client::new()
            .get(format!("{base_url}/m3u8?url={encoded}"))
            .send()
            .await
            .expect("m3u8 route should respond");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("*")
        );
        let body = response
            .text()
            .await
            .expect("m3u8 payload should be readable");
        assert!(body.contains("#EXTM3U"));
        assert!(body.contains("segment.ts"));
    }
}
