use std::collections::HashMap;
use std::path::{Component, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Json, Path, Query, State};
use axum::http::{HeaderMap, HeaderValue as AxumHeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{serve, Router};
use base64::Engine;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::{Client, Method};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinSet;

const DEFAULT_PROXY_HOST: &str = "127.0.0.1";
const PREFERRED_PROXY_PORT: u16 = 9978;
const BATCH_FETCH_CONCURRENCY: usize = 16;
const DEFAULT_BATCH_FETCH_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_PARSE_HTML_TEMPLATE: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes">
  <title>Parse</title>
  <style>
    html, body, #container { margin: 0; width: 100%; min-height: 100%; background: #050816; }
    #container { display: flex; flex-direction: column; gap: 12px; padding: 12px; box-sizing: border-box; }
    iframe { width: 100%; min-height: 72vh; border: 0; border-radius: 12px; background: #111827; }
  </style>
</head>
<body>
  <div id="container"></div>
  <script>
    const jxs = "%s";
    const url = "%s";
    const list = (jxs || "").split(";").map(item => item.trim()).filter(Boolean);
    const container = document.getElementById("container");
    list.forEach(item => {
      const iframe = document.createElement("iframe");
      iframe.referrerPolicy = "no-referrer";
      iframe.allow = "fullscreen";
      iframe.sandbox = "allow-scripts allow-same-origin allow-forms";
      iframe.src = item + url;
      container.appendChild(iframe);
    });
  </script>
</body>
</html>
"#;

#[derive(Debug, Clone)]
struct SpiderLocalServiceHandle {
    base_url: String,
    state: SharedState,
}

#[derive(Debug, Default)]
struct SpiderLocalServiceState {
    cache: RwLock<HashMap<String, String>>,
}

type SharedState = Arc<SpiderLocalServiceState>;

static SPIDER_LOCAL_SERVICE: OnceLock<Mutex<Option<SpiderLocalServiceHandle>>> = OnceLock::new();
static SPIDER_PROXY_CONTEXT: OnceLock<
    RwLock<Option<crate::spider_proxy_bridge::SpiderProxyBridgeContext>>,
> = OnceLock::new();

#[derive(Debug, Clone, Default, Deserialize)]
struct BatchFetchRequestItem {
    url: String,
    #[serde(default)]
    options: BatchFetchOptions,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct BatchFetchOptions {
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Option<serde_json::Value>,
    #[serde(default)]
    data: Option<serde_json::Value>,
    #[serde(default)]
    body: Option<String>,
    #[serde(rename = "postType", default)]
    post_type: Option<String>,
    #[serde(default)]
    redirect: Option<i64>,
    #[serde(default)]
    timeout: Option<u64>,
    #[serde(default)]
    buffer: Option<i64>,
}

fn spider_local_service_lock() -> &'static Mutex<Option<SpiderLocalServiceHandle>> {
    SPIDER_LOCAL_SERVICE.get_or_init(|| Mutex::new(None))
}

fn spider_proxy_context_store(
) -> &'static RwLock<Option<crate::spider_proxy_bridge::SpiderProxyBridgeContext>> {
    SPIDER_PROXY_CONTEXT.get_or_init(|| RwLock::new(None))
}

pub(crate) async fn register_spider_proxy_context(
    context: crate::spider_proxy_bridge::SpiderProxyBridgeContext,
) {
    let store = spider_proxy_context_store();
    *store.write().await = Some(context);
}

pub(crate) async fn clear_spider_proxy_context() {
    let store = spider_proxy_context_store();
    *store.write().await = None;
}

pub(crate) async fn clear_spider_local_state() {
    clear_spider_proxy_context().await;

    let handle = {
        let lock = spider_local_service_lock();
        let guard = lock.lock().await;
        guard.clone()
    };
    if let Some(handle) = handle {
        handle.state.cache.write().await.clear();
    }
}

async fn current_spider_proxy_context(
) -> Option<crate::spider_proxy_bridge::SpiderProxyBridgeContext> {
    spider_proxy_context_store().read().await.clone()
}

pub(crate) async fn ensure_spider_local_service_started() -> Result<String, String> {
    let lock = spider_local_service_lock();
    let mut guard = lock.lock().await;
    if let Some(handle) = guard.as_ref() {
        return Ok(handle.base_url.clone());
    }

    let listener = match TcpListener::bind((DEFAULT_PROXY_HOST, PREFERRED_PROXY_PORT)).await {
        Ok(listener) => listener,
        Err(preferred_err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderLocalService] preferred port {} unavailable: {}. Falling back to random port.",
                PREFERRED_PROXY_PORT, preferred_err
            ));
            TcpListener::bind((DEFAULT_PROXY_HOST, 0))
                .await
                .map_err(|err| format!("bind spider local service failed: {err}"))?
        }
    };
    let addr = listener
        .local_addr()
        .map_err(|err| format!("read spider local service addr failed: {err}"))?;
    let base_url = format!("http://{addr}");
    let state = Arc::new(SpiderLocalServiceState::default());
    let app = build_router(state.clone());

    tokio::spawn(async move {
        if let Err(err) = serve(listener, app).await {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderLocalService] server stopped: {err}"
            ));
        }
    });

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService] started at {base_url}"
    ));
    *guard = Some(SpiderLocalServiceHandle {
        base_url: base_url.clone(),
        state,
    });
    Ok(base_url)
}

fn build_router(state: SharedState) -> Router {
    let router = Router::new()
        .route("/health", get(handle_health))
        .route("/log", get(handle_log_get).post(handle_log_post))
        .route("/postMsg", get(handle_post_message))
        .route("/parse", get(handle_parse))
        .route(
            "/vod-hls/manifest/{session_id}/index.m3u8",
            get(handle_vod_hls_manifest),
        )
        .route(
            "/vod-hls/segment/{session_id}/{token}",
            get(handle_vod_hls_segment),
        )
        .route(
            "/vod-hls/resource/{session_id}",
            get(handle_vod_hls_resource),
        )
        .route("/cache", get(handle_cache_get).post(handle_cache_post))
        .route("/bf", post(handle_batch_fetch))
        .route("/transport", post(handle_transport))
        .route("/proxy", get(handle_proxy).post(handle_proxy))
        .with_state(state);

    crate::spider_local_runtime_android::register_routes(router)
}

async fn handle_health() -> impl IntoResponse {
    (StatusCode::OK, "{\"ok\":true}")
}

async fn handle_log_get(Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let text = params
        .get("text")
        .cloned()
        .or_else(|| params.get("msg").cloned())
        .unwrap_or_default();
    log_spider_message("log", &text);
    (StatusCode::OK, "ok")
}

async fn handle_log_post(headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    let payload = extract_value_from_body(&headers, &body, "text")
        .or_else(|| extract_value_from_body(&headers, &body, "msg"))
        .unwrap_or_else(|| String::from_utf8_lossy(&body).trim().to_string());
    log_spider_message("log", &payload);
    (StatusCode::OK, "ok")
}

async fn handle_post_message(Query(params): Query<HashMap<String, String>>) -> impl IntoResponse {
    let text = params.get("msg").cloned().unwrap_or_default();
    log_spider_message("postMsg", &text);
    (StatusCode::OK, "ok")
}

async fn handle_parse(Query(params): Query<HashMap<String, String>>) -> Response {
    let jxs = params.get("jxs").cloned().unwrap_or_default();
    let url = params.get("url").cloned().unwrap_or_default();
    let template = load_spider_local_text_template("parse.html")
        .unwrap_or_else(|| DEFAULT_PARSE_HTML_TEMPLATE.to_string());
    let html = fill_parse_html_template(&template, &jxs, &url);
    (
        [(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8")],
        html,
    )
        .into_response()
}

async fn handle_vod_hls_manifest(Path(session_id): Path<String>) -> Response {
    match ensure_spider_local_service_started().await {
        Ok(base_url) => match crate::vod_hls_relay::serve_manifest(&session_id, &base_url).await {
            Ok(manifest) => (
                [(
                    axum::http::header::CONTENT_TYPE,
                    crate::vod_hls_relay::manifest_content_type(),
                )],
                manifest,
            )
                .into_response(),
            Err(err) => (StatusCode::BAD_GATEWAY, err).into_response(),
        },
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err).into_response(),
    }
}

async fn handle_vod_hls_segment(Path((session_id, token)): Path<(String, String)>) -> Response {
    match crate::vod_hls_relay::serve_segment(&session_id, &token).await {
        Ok(body) => (
            [(
                axum::http::header::CONTENT_TYPE,
                crate::vod_hls_relay::binary_content_type(body.content_type, "video/mp2t"),
            )],
            body.bytes,
        )
            .into_response(),
        Err(err) => (StatusCode::BAD_GATEWAY, err).into_response(),
    }
}

async fn handle_vod_hls_resource(
    Path(session_id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let resource_url = params
        .get("url")
        .map(|value| value.trim())
        .unwrap_or_default();
    if resource_url.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing resource url").into_response();
    }
    match crate::vod_hls_relay::serve_resource(&session_id, resource_url).await {
        Ok(body) => (
            [(
                axum::http::header::CONTENT_TYPE,
                crate::vod_hls_relay::binary_content_type(
                    body.content_type,
                    "application/octet-stream",
                ),
            )],
            body.bytes,
        )
            .into_response(),
        Err(err) => (StatusCode::BAD_GATEWAY, err).into_response(),
    }
}

async fn handle_transport(
    Json(request): Json<crate::media_cmds::MediaTransportRequest>,
) -> impl IntoResponse {
    match crate::media_cmds::execute_media_transport_request(request).await {
        Ok(response) => Json(response).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "ok": false,
                "error": err,
            })),
        )
            .into_response(),
    }
}

async fn handle_cache_get(
    State(state): State<SharedState>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let action = params.get("do").map(|value| value.trim()).unwrap_or("");
    let key = params
        .get("key")
        .map(|value| value.trim())
        .unwrap_or("")
        .to_string();

    match action {
        "get" => {
            let value = state
                .cache
                .read()
                .await
                .get(&key)
                .cloned()
                .unwrap_or_default();
            (StatusCode::OK, value)
        }
        "del" => {
            state.cache.write().await.remove(&key);
            (StatusCode::OK, "succeed".to_string())
        }
        _ => (
            StatusCode::BAD_REQUEST,
            format!("unsupported cache action: {action}"),
        ),
    }
}

async fn handle_cache_post(
    State(state): State<SharedState>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let action = params.get("do").map(|value| value.trim()).unwrap_or("");
    let key = params
        .get("key")
        .map(|value| value.trim())
        .unwrap_or("")
        .to_string();

    match action {
        "set" => {
            let value = extract_value_from_body(&headers, &body, "value")
                .unwrap_or_else(|| String::from_utf8_lossy(&body).to_string());
            state.cache.write().await.insert(key, value);
            (StatusCode::OK, "succeed".to_string())
        }
        _ => (
            StatusCode::BAD_REQUEST,
            format!("unsupported cache action: {action}"),
        ),
    }
}

async fn handle_proxy(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    body: Bytes,
) -> Response {
    let request_map = build_proxy_request_map(params, &headers, &body);

    if let Some(context) = current_spider_proxy_context().await {
        match crate::spider_proxy_bridge::execute_proxy_bridge(&context, &request_map).await {
            Ok(result) => {
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderLocalService][proxy] bridge served {} with status {}",
                    context.site_key, result.status
                ));
                return response_from_proxy_result(result);
            }
            Err(err) => {
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderLocalService][proxy] bridge fallback for {}: {}",
                    context.site_key, err
                ));
            }
        }
    }

    match execute_generic_proxy_passthrough(&request_map, &body).await {
        Ok(result) => response_from_proxy_result(result),
        Err(err) => (
            StatusCode::BAD_GATEWAY,
            format!("desktop spider local proxy failed: {err}"),
        )
            .into_response(),
    }
}

async fn handle_batch_fetch(headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    let payload = extract_value_from_body(&headers, &body, "postData")
        .unwrap_or_else(|| String::from_utf8_lossy(&body).trim().to_string());
    let items = match parse_batch_fetch_payload(&payload) {
        Ok(items) => items,
        Err(err) => {
            return (StatusCode::BAD_REQUEST, err);
        }
    };

    match execute_batch_fetch(items).await {
        Ok(results) => match serde_json::to_string(&results) {
            Ok(json) => (StatusCode::OK, json),
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("serialize batch fetch result failed: {err}"),
            ),
        },
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, err),
    }
}

fn log_spider_message(kind: &str, message: &str) {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return;
    }
    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService][{}] {}",
        kind, trimmed
    ));
}

fn sanitize_virtual_file_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_start_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    let candidate = trimmed.replace('\\', "/");
    let mut result = PathBuf::new();
    for component in PathBuf::from(candidate).components() {
        match component {
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
        }
    }

    if result.as_os_str().is_empty() {
        None
    } else {
        Some(result)
    }
}

fn spider_local_file_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(user_home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        roots.push(
            PathBuf::from(user_home)
                .join(".halo")
                .join("spider_data")
                .join("files"),
        );
    }

    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.clone());
        roots.push(cwd.join("TVBox"));
        roots.push(cwd.join("resources").join("TVBox"));
        roots.push(cwd.join("src-tauri"));
        roots.push(cwd.join("src-tauri").join("TVBox"));
        roots.push(cwd.join("src-tauri").join("resources").join("TVBox"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            roots.push(exe_dir.join("TVBox"));
            roots.push(exe_dir.join("resources").join("TVBox"));
        }
    }

    roots
}

fn load_spider_local_text_template(relative_path: &str) -> Option<String> {
    let relative_path = sanitize_virtual_file_path(relative_path)?;
    for root in spider_local_file_roots() {
        let candidate = root.join(&relative_path);
        if !candidate.is_file() {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(&candidate) {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderLocalService][template] loaded {}",
                candidate.display()
            ));
            return Some(text);
        }
    }
    None
}

fn escape_js_template_arg(value: &str) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "\"\"".to_string())
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('&', "\\u0026")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .trim_matches('"')
        .to_string()
}

fn fill_parse_html_template(template: &str, jxs: &str, url: &str) -> String {
    template
        .replacen("%s", &escape_js_template_arg(jxs), 1)
        .replacen("%s", &escape_js_template_arg(url), 1)
}

fn extract_value_from_body(headers: &HeaderMap, body: &[u8], key: &str) -> Option<String> {
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body_text = String::from_utf8_lossy(body);

    if content_type.contains("application/x-www-form-urlencoded") {
        for (next_key, value) in url::form_urlencoded::parse(body_text.as_bytes()) {
            if next_key == key {
                return Some(value.into_owned());
            }
        }
    }

    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) {
        if let Some(value) = json.get(key).and_then(|value| value.as_str()) {
            return Some(value.to_string());
        }
    }

    None
}

fn extract_body_map(headers: &HeaderMap, body: &[u8]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    let body_text = String::from_utf8_lossy(body);

    if content_type.contains("application/x-www-form-urlencoded") {
        for (key, value) in url::form_urlencoded::parse(body_text.as_bytes()) {
            values.insert(key.into_owned(), value.into_owned());
        }
        return values;
    }

    if content_type.contains("application/json") {
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) {
            if let Some(object) = json.as_object() {
                for (key, value) in object {
                    match value {
                        serde_json::Value::Null => {}
                        serde_json::Value::String(text) => {
                            values.insert(key.clone(), text.clone());
                        }
                        _ => {
                            values.insert(key.clone(), value.to_string());
                        }
                    }
                }
            }
        }
    }

    values
}

fn build_proxy_request_map(
    mut params: HashMap<String, String>,
    headers: &HeaderMap,
    body: &[u8],
) -> HashMap<String, String> {
    for (key, value) in headers {
        if let Ok(value) = value.to_str() {
            params.insert(key.as_str().to_string(), value.to_string());
        }
    }

    for (key, value) in extract_body_map(headers, body) {
        params.insert(key, value);
    }

    if !body.is_empty() && !params.contains_key("body") {
        params.insert(
            "body".to_string(),
            String::from_utf8_lossy(body).to_string(),
        );
    }

    params
}

fn parse_header_json_map(raw: &str) -> HashMap<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return HashMap::new();
    }

    serde_json::from_str::<serde_json::Value>(trimmed)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|object| {
            object
                .into_iter()
                .filter_map(|(key, value)| match value {
                    serde_json::Value::Null => None,
                    serde_json::Value::String(text) => Some((key, text)),
                    other => Some((key, other.to_string())),
                })
                .collect::<HashMap<_, _>>()
        })
        .unwrap_or_default()
}

fn build_proxy_upstream_headers(
    params: &HashMap<String, String>,
) -> Result<ReqwestHeaderMap, String> {
    let mut headers = ReqwestHeaderMap::new();

    for field in ["header", "headers"] {
        if let Some(raw) = params.get(field) {
            for (key, value) in parse_header_json_map(raw) {
                let name = HeaderName::from_bytes(key.as_bytes())
                    .map_err(|err| format!("invalid proxy header name {key}: {err}"))?;
                let value = HeaderValue::from_str(&value)
                    .map_err(|err| format!("invalid proxy header value for {key}: {err}"))?;
                headers.insert(name, value);
            }
        }
    }

    for key in [
        "user-agent",
        "referer",
        "origin",
        "cookie",
        "authorization",
        "range",
        "accept",
        "accept-language",
        "content-type",
    ] {
        let Some(value) = params.get(key).filter(|value| !value.trim().is_empty()) else {
            continue;
        };
        let name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("invalid proxy header name {key}: {err}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|err| format!("invalid proxy header value for {key}: {err}"))?;
        headers.insert(name, value);
    }

    Ok(headers)
}

async fn execute_generic_proxy_passthrough(
    params: &HashMap<String, String>,
    body: &[u8],
) -> Result<crate::spider_proxy_bridge::SpiderProxyBridgeResponse, String> {
    let url = ["url", "src", "target"]
        .iter()
        .find_map(|key| params.get(*key))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "proxy request is missing upstream url".to_string())?;
    let method_text = params
        .get("method")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("GET");
    let method = Method::from_bytes(method_text.as_bytes())
        .map_err(|err| format!("unsupported proxy method {method_text}: {err}"))?;
    let headers = build_proxy_upstream_headers(params)?;
    let timeout_ms = params
        .get("timeout")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_BATCH_FETCH_TIMEOUT_MS);
    let redirect = if matches!(
        params.get("redirect").map(|value| value.as_str()),
        Some("0")
    ) {
        reqwest::redirect::Policy::none()
    } else {
        reqwest::redirect::Policy::limited(10)
    };

    let client = Client::builder()
        .redirect(redirect)
        .connect_timeout(Duration::from_millis(timeout_ms))
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|err| format!("build generic proxy client failed: {err}"))?;

    let mut request = client.request(method.clone(), url);
    if !headers.is_empty() {
        request = request.headers(headers.clone());
    }

    if !matches!(method, Method::GET | Method::HEAD) {
        let payload = params
            .get("body")
            .map(|value| value.as_bytes().to_vec())
            .unwrap_or_else(|| body.to_vec());
        if !payload.is_empty() {
            request = request.body(payload);
        }
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("generic proxy upstream request failed: {err}"))?;
    let status = response.status().as_u16();
    let mime = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            response_headers.insert(key.as_str().to_string(), value.to_string());
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("read generic proxy body failed: {err}"))?;

    Ok(crate::spider_proxy_bridge::SpiderProxyBridgeResponse {
        status,
        mime,
        body: bytes.to_vec(),
        headers: response_headers,
    })
}

fn response_from_proxy_result(
    result: crate::spider_proxy_bridge::SpiderProxyBridgeResponse,
) -> Response {
    let mut response = (
        StatusCode::from_u16(result.status).unwrap_or(StatusCode::OK),
        result.body,
    )
        .into_response();

    if let Ok(value) = AxumHeaderValue::from_str(&result.mime) {
        response
            .headers_mut()
            .insert(axum::http::header::CONTENT_TYPE, value);
    }

    for (key, value) in result.headers {
        let name = match axum::http::header::HeaderName::from_bytes(key.as_bytes()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if matches!(
            name.as_str().to_ascii_lowercase().as_str(),
            "content-length" | "transfer-encoding" | "connection" | "content-type"
        ) {
            continue;
        }
        let Ok(value) = AxumHeaderValue::from_str(&value) else {
            continue;
        };
        response.headers_mut().insert(name, value);
    }

    response
}

fn parse_batch_fetch_payload(payload: &str) -> Result<Vec<BatchFetchRequestItem>, String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<BatchFetchRequestItem>>(trimmed)
        .map_err(|err| format!("parse batch fetch payload failed: {err}"))
}

async fn execute_batch_fetch(items: Vec<BatchFetchRequestItem>) -> Result<Vec<String>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = vec![String::new(); items.len()];
    let mut join_set = JoinSet::new();
    let mut next_index = 0usize;
    let concurrency = items.len().min(BATCH_FETCH_CONCURRENCY);

    for _ in 0..concurrency {
        join_set.spawn(run_batch_fetch_item(next_index, items[next_index].clone()));
        next_index += 1;
    }

    while let Some(result) = join_set.join_next().await {
        let (index, value) =
            result.map_err(|err| format!("join batch fetch task failed: {err}"))?;
        if let Some(slot) = results.get_mut(index) {
            *slot = value;
        }

        if next_index < items.len() {
            join_set.spawn(run_batch_fetch_item(next_index, items[next_index].clone()));
            next_index += 1;
        }
    }

    Ok(results)
}

async fn run_batch_fetch_item(index: usize, item: BatchFetchRequestItem) -> (usize, String) {
    let started = std::time::Instant::now();
    let value = match execute_single_batch_fetch(&item).await {
        Ok(value) => value,
        Err(err) => {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderLocalService][bf] fetch {} failed after {}ms: {}",
                item.url,
                started.elapsed().as_millis(),
                err
            ));
            String::new()
        }
    };

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderLocalService][bf] fetch {} finished in {}ms",
        item.url,
        started.elapsed().as_millis()
    ));
    (index, value)
}

async fn execute_single_batch_fetch(item: &BatchFetchRequestItem) -> Result<String, String> {
    let response = crate::media_cmds::execute_media_transport_request(
        crate::media_cmds::MediaTransportRequest {
            url: item.url.clone(),
            options: crate::media_cmds::MediaTransportOptions {
                method: item.options.method.clone(),
                headers: item.options.headers.clone(),
                data: item.options.data.clone(),
                body: item.options.body.clone(),
                post_type: item.options.post_type.clone(),
                redirect: item.options.redirect,
                timeout: item.options.timeout,
            },
            request_id: None,
            source: Some("spider-local-batch-fetch".to_string()),
        },
    )
    .await?;

    if !response.error.trim().is_empty() {
        return Err(response.error);
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(response.body_base64.as_bytes())
        .map_err(|err| format!("decode transport body failed: {err}"))?;

    Ok(render_batch_fetch_body(&item.options, &bytes))
}

fn render_batch_fetch_body(options: &BatchFetchOptions, bytes: &[u8]) -> String {
    match options.buffer.unwrap_or(0) {
        1 => {
            let signed_bytes = bytes
                .iter()
                .map(|value| (*value as i8) as i32)
                .collect::<Vec<_>>();
            serde_json::to_string(&signed_bytes).unwrap_or_default()
        }
        2 => base64::engine::general_purpose::STANDARD_NO_PAD.encode(bytes),
        _ => decode_batch_fetch_text(bytes, options),
    }
}

fn decode_batch_fetch_text(bytes: &[u8], options: &BatchFetchOptions) -> String {
    let charset = batch_fetch_charset(options).unwrap_or("utf-8");
    let encoding =
        encoding_rs::Encoding::for_label(charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

fn batch_fetch_charset(options: &BatchFetchOptions) -> Option<&str> {
    let headers = options.headers.as_ref()?.as_object()?;
    for key in ["Content-Type", "content-type"] {
        let Some(content_type) = headers.get(key).and_then(|value| value.as_str()) else {
            continue;
        };
        for segment in content_type.split(';') {
            let segment = segment.trim();
            let Some(charset) = segment.strip_prefix("charset=") else {
                continue;
            };
            return Some(charset.trim_matches('"'));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        build_router, clear_spider_proxy_context, ensure_spider_local_service_started,
        fill_parse_html_template, SpiderLocalServiceState,
    };
    use axum::body::Bytes;
    use axum::http::StatusCode;
    use axum::routing::{get, post};
    use axum::{serve, Router};
    use std::sync::Arc;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn spider_local_service_supports_cache_roundtrip() {
        let base_url = ensure_spider_local_service_started()
            .await
            .expect("local service should start");
        let client = reqwest::Client::new();

        let response = client
            .post(format!("{base_url}/cache?do=set&key=test-key"))
            .header("content-type", "application/x-www-form-urlencoded")
            .body("value=hello-world")
            .send()
            .await
            .expect("set cache should succeed");
        assert!(response.status().is_success());

        let value = client
            .get(format!("{base_url}/cache?do=get&key=test-key"))
            .send()
            .await
            .expect("get cache should succeed")
            .text()
            .await
            .expect("cache body should be readable");
        assert_eq!(value, "hello-world");

        let response = client
            .get(format!("{base_url}/cache?do=del&key=test-key"))
            .send()
            .await
            .expect("delete cache should succeed");
        assert!(response.status().is_success());

        let value = client
            .get(format!("{base_url}/cache?do=get&key=test-key"))
            .send()
            .await
            .expect("get cache after delete should succeed")
            .text()
            .await
            .expect("cache body should be readable");
        assert!(value.is_empty());
    }

    async fn spawn_test_http_server() -> String {
        let app = Router::new()
            .route(
                "/one",
                get(|| async { (StatusCode::OK, "one".to_string()) }),
            )
            .route(
                "/two",
                get(|| async { (StatusCode::OK, "two".to_string()) }),
            )
            .route(
                "/echo",
                post(|body: Bytes| async move { (StatusCode::OK, body) }),
            );
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("test server should bind");
        let addr = listener
            .local_addr()
            .expect("test server should have a local addr");
        tokio::spawn(async move {
            serve(listener, app).await.expect("test server should run");
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn spider_local_service_supports_batch_fetch_text() {
        let base_url = ensure_spider_local_service_started()
            .await
            .expect("local service should start");
        let upstream = spawn_test_http_server().await;
        let client = reqwest::Client::new();
        let payload = serde_json::json!([
            {"url": format!("{upstream}/one"), "options": {}},
            {"url": format!("{upstream}/two"), "options": {}}
        ]);

        let response = client
            .post(format!("{base_url}/bf"))
            .header("content-type", "application/json")
            .body(payload.to_string())
            .send()
            .await
            .expect("batch fetch should succeed");
        assert!(response.status().is_success());

        let body = response
            .text()
            .await
            .expect("batch fetch response should be readable");
        assert_eq!(body, "[\"one\",\"two\"]");
    }

    #[tokio::test]
    async fn spider_local_service_supports_parse_page() {
        let state = Arc::new(SpiderLocalServiceState::default());
        let app = build_router(state);
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("parse test listener should bind");
        let addr = listener
            .local_addr()
            .expect("parse test listener should have an addr");
        tokio::spawn(async move {
            serve(listener, app)
                .await
                .expect("parse test router should run");
        });

        let encoded_jxs = url::form_urlencoded::byte_serialize(
            b"https://jx1.example/?url=;https://jx2.example/?url=",
        )
        .collect::<String>();
        let encoded_url =
            url::form_urlencoded::byte_serialize(b"https://video.example/play?id=1&lang=zh-CN")
                .collect::<String>();
        let response = reqwest::Client::new()
            .get(format!(
                "http://{addr}/parse?jxs={encoded_jxs}&url={encoded_url}"
            ))
            .send()
            .await
            .expect("parse request should succeed");
        assert_eq!(response.status(), StatusCode::OK);
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("");
        assert!(content_type.starts_with("text/html"));
        let body = response
            .text()
            .await
            .expect("parse page should be readable");
        assert!(
            body.contains(r#"const jxs = "https://jx1.example/?url=;https://jx2.example/?url=";"#)
        );
        assert!(body.contains(r#"const url = "https://video.example/play?id=1\u0026lang=zh-CN";"#));
    }

    #[tokio::test]
    async fn spider_local_service_supports_generic_proxy_passthrough() {
        clear_spider_proxy_context().await;

        let state = Arc::new(SpiderLocalServiceState::default());
        let app = build_router(state);
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("proxy test listener should bind");
        let addr = listener
            .local_addr()
            .expect("proxy test listener should have an addr");
        tokio::spawn(async move {
            serve(listener, app)
                .await
                .expect("proxy test router should run");
        });

        let upstream = spawn_test_http_server().await;
        let response = reqwest::Client::new()
            .get(format!(
                "http://{addr}/proxy?url={}{}",
                url::form_urlencoded::byte_serialize(upstream.as_bytes()).collect::<String>(),
                "%2Fone"
            ))
            .send()
            .await
            .expect("proxy request should succeed");
        assert_eq!(response.status(), StatusCode::OK);
        let body = response
            .text()
            .await
            .expect("proxy body should be readable");
        assert_eq!(body, "one");
    }

    #[tokio::test]
    async fn spider_local_service_supports_batch_fetch_buffer_modes() {
        let state = Arc::new(SpiderLocalServiceState::default());
        let app = build_router(state);
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("local service test listener should bind");
        let addr = listener
            .local_addr()
            .expect("local service test listener should have an addr");
        tokio::spawn(async move {
            serve(listener, app)
                .await
                .expect("local service test router should run");
        });

        let upstream = spawn_test_http_server().await;
        let client = reqwest::Client::new();
        let payload = serde_json::json!([
            {"url": format!("{upstream}/echo"), "options": {"method": "post", "body": "abc", "buffer": 1}},
            {"url": format!("{upstream}/echo"), "options": {"method": "post", "body": "abc", "buffer": 2}}
        ]);

        let response = client
            .post(format!("http://{addr}/bf"))
            .header("content-type", "application/json")
            .body(payload.to_string())
            .send()
            .await
            .expect("batch fetch buffer modes should succeed");
        assert!(response.status().is_success());

        let body = response
            .text()
            .await
            .expect("batch fetch buffer response should be readable");
        assert_eq!(body, "[\"[97,98,99]\",\"YWJj\"]");
    }

    #[test]
    fn parse_template_escapes_script_breakout_sequences() {
        let html = fill_parse_html_template(
            r#"const jxs = "%s"; const url = "%s";"#,
            r#"https://jx.example/?url="#,
            r#"</script><script>alert(1)</script>"#,
        );

        assert!(html.contains(r#"https://jx.example/?url="#));
        assert!(
            html.contains(r#"\u003c/script\u003e\u003cscript\u003ealert(1)\u003c/script\u003e"#)
        );
    }
}
