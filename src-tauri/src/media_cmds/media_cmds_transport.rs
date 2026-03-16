use std::collections::HashMap;
use std::time::Duration;

use base64::Engine;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::media_cmds_network::{build_transport_client, resolve_media_request};
use crate::spider_runtime_contract::SpiderTransportTarget;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransportOptions {
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(rename = "postType", default)]
    pub post_type: Option<String>,
    #[serde(default)]
    pub redirect: Option<i64>,
    #[serde(default)]
    pub timeout: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransportRequest {
    pub url: String,
    #[serde(default)]
    pub options: MediaTransportOptions,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTransportResponse {
    pub ok: bool,
    pub status: u16,
    pub code: u16,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body_base64: String,
    pub error: String,
    pub transport_target: SpiderTransportTarget,
    pub request_id: Option<String>,
    pub insecure_tls: bool,
}

pub async fn execute_media_transport_request(
    request: MediaTransportRequest,
) -> Result<MediaTransportResponse, String> {
    let follow_redirects = request.options.redirect.unwrap_or(1) != 0;
    let timeout_ms = request.options.timeout.unwrap_or(10_000).max(1);
    let resolved = resolve_media_request(
        &request.url,
        extract_header_string_map(request.options.headers.as_ref()),
    );
    let client = build_transport_client(
        &resolved,
        follow_redirects,
        Duration::from_millis(timeout_ms),
    )?;
    let reqwest_method = normalize_method(request.options.method.as_deref())?;
    let mut builder = client.request(reqwest_method.clone(), &resolved.url);
    let headers = build_headers_from_json(request.options.headers.as_ref())?;
    if !headers.is_empty() {
        builder = builder.headers(headers.clone());
    }
    if reqwest_method != Method::GET && reqwest_method != Method::HEAD {
        builder = attach_request_body(builder, &request.options, &headers)?;
    }

    let response = match builder.send().await {
        Ok(response) => response,
        Err(err) => {
            return Ok(MediaTransportResponse {
                ok: false,
                status: 0,
                code: 0,
                url: resolved.url,
                headers: HashMap::new(),
                body_base64: String::new(),
                error: err.to_string(),
                transport_target: SpiderTransportTarget::RustUnified,
                request_id: request.request_id,
                insecure_tls: resolved.insecure_tls,
            });
        }
    };

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let headers_map = flatten_response_headers(response.headers());
    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("read transport response body failed: {err}"))?;

    Ok(MediaTransportResponse {
        ok: (200..300).contains(&status),
        status,
        code: status,
        url: final_url,
        headers: headers_map,
        body_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        error: String::new(),
        transport_target: SpiderTransportTarget::RustUnified,
        request_id: request.request_id,
        insecure_tls: resolved.insecure_tls,
    })
}

fn normalize_method(method: Option<&str>) -> Result<Method, String> {
    let method = method.unwrap_or("GET").trim().to_ascii_uppercase();
    match method.as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "HEAD" => Ok(Method::HEAD),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        other => Method::from_bytes(other.as_bytes())
            .map_err(|err| format!("unsupported transport method `{other}`: {err}")),
    }
}

fn build_headers_from_json(
    raw_headers: Option<&serde_json::Value>,
) -> Result<ReqwestHeaderMap, String> {
    let mut headers = ReqwestHeaderMap::new();
    let Some(raw_headers) = raw_headers.and_then(|value| value.as_object()) else {
        return Ok(headers);
    };

    for (key, value) in raw_headers {
        let Some(value) = value.as_str() else {
            continue;
        };
        let header_name = HeaderName::from_bytes(key.as_bytes())
            .map_err(|err| format!("invalid header name `{key}`: {err}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|err| format!("invalid header value for `{key}`: {err}"))?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

fn attach_request_body(
    builder: reqwest::RequestBuilder,
    options: &MediaTransportOptions,
    headers: &ReqwestHeaderMap,
) -> Result<reqwest::RequestBuilder, String> {
    let post_type = options
        .post_type
        .as_deref()
        .map(|value| value.to_ascii_lowercase())
        .or_else(|| infer_post_type_from_headers(headers))
        .unwrap_or_else(|| "json".to_string());

    match post_type.as_str() {
        "form" => {
            if let Some(map) = json_value_to_string_map(options.data.as_ref()) {
                Ok(builder.form(&map))
            } else {
                Ok(builder.body(options.body.clone().unwrap_or_default()))
            }
        }
        "form-data" | "formdata" => {
            if let Some(map) = json_value_to_string_map(options.data.as_ref()) {
                let boundary = format!(
                    "----halo-transport-{}",
                    format!("{:x}", md5::compute(item_body_seed(options)))
                );
                let mut body = String::new();
                for (key, value) in map {
                    body.push_str(&format!(
                        "--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n"
                    ));
                }
                body.push_str(&format!("--{boundary}--\r\n"));
                Ok(builder
                    .header(
                        CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(body))
            } else {
                Ok(builder.body(options.body.clone().unwrap_or_default()))
            }
        }
        "raw" => {
            if let Some(body) = options.body.as_ref() {
                Ok(builder.body(body.clone()))
            } else if let Some(data) = options.data.as_ref() {
                Ok(builder.body(json_scalar_to_string(data)))
            } else {
                Ok(builder)
            }
        }
        _ => {
            if let Some(body) = options.body.as_ref() {
                Ok(builder.body(body.clone()))
            } else if let Some(data) = options.data.as_ref() {
                Ok(builder.json(data))
            } else {
                Ok(builder)
            }
        }
    }
}

fn infer_post_type_from_headers(headers: &ReqwestHeaderMap) -> Option<String> {
    let content_type = headers
        .get(CONTENT_TYPE)?
        .to_str()
        .ok()?
        .to_ascii_lowercase();
    if content_type.contains("multipart/form-data") {
        return Some("form-data".to_string());
    }
    if content_type.contains("application/x-www-form-urlencoded") {
        return Some("form".to_string());
    }
    if content_type.contains("application/json") {
        return Some("json".to_string());
    }
    Some("raw".to_string())
}

fn json_value_to_string_map(value: Option<&serde_json::Value>) -> Option<HashMap<String, String>> {
    let object = value?.as_object()?;
    let mut map = HashMap::new();
    for (key, value) in object {
        map.insert(key.clone(), json_scalar_to_string(value));
    }
    Some(map)
}

fn json_scalar_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(value) => value.clone(),
        _ => value.to_string(),
    }
}

fn extract_header_string_map(
    raw_headers: Option<&serde_json::Value>,
) -> Option<HashMap<String, String>> {
    json_value_to_string_map(raw_headers)
}

fn item_body_seed(options: &MediaTransportOptions) -> String {
    format!(
        "{}|{}|{}",
        options.body.clone().unwrap_or_default(),
        options
            .post_type
            .clone()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        options
            .data
            .as_ref()
            .map(|value| value.to_string())
            .unwrap_or_default()
    )
}

fn flatten_response_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for (key, value) in headers {
        if let Ok(value) = value.to_str() {
            values.insert(key.as_str().to_string(), value.to_string());
        }
    }
    values
}
