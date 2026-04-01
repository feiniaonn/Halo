use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::{hash_map::DefaultHasher, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[cfg(not(target_os = "windows"))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

const AI_DB_FILE: &str = "halo_ai.db";
const DEFAULT_BASE_URL: &str = "https://api.openai.com";
const DEFAULT_MODELS_PATH: &str = "v1/models";
const DEFAULT_CHAT_PATH: &str = "v1/chat/completions";
const CONNECT_TIMEOUT_MS: u64 = 10_000;
const MODEL_CACHE_TTL_MS: i64 = 90_000;
const EMPTY_REPLY_NOTE: &str = "接口已响应，但没有返回可读文本内容。";

static MODEL_DETECTION_CACHE: OnceLock<Mutex<Option<CachedModelDetection>>> = OnceLock::new();
const DEFAULT_LATENCY_PROMPT: &str = "请只回复“连接成功”四个字。";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiConnectionSettings {
    pub provider_name: String,
    pub base_url: String,
    pub api_key: String,
    pub auth_type: String,
    pub api_key_header_name: String,
    pub api_key_prefix: String,
    pub api_key_query_name: String,
    pub models_path: String,
    pub chat_path: String,
    pub model_name: String,
    pub request_timeout_ms: i64,
    pub temperature: f64,
    pub max_tokens: i64,
    pub latency_prompt: String,
    pub latency_rounds: i64,
    pub extra_headers: String,
    pub updated_at: Option<i64>,
}

impl Default for AiConnectionSettings {
    fn default() -> Self {
        Self {
            provider_name: "Halo AI".to_string(),
            base_url: DEFAULT_BASE_URL.to_string(),
            api_key: String::new(),
            auth_type: "bearer".to_string(),
            api_key_header_name: "Authorization".to_string(),
            api_key_prefix: "Bearer ".to_string(),
            api_key_query_name: "api_key".to_string(),
            models_path: DEFAULT_MODELS_PATH.to_string(),
            chat_path: DEFAULT_CHAT_PATH.to_string(),
            model_name: String::new(),
            request_timeout_ms: 120_000,
            temperature: 0.2,
            max_tokens: 256,
            latency_prompt: DEFAULT_LATENCY_PROMPT.to_string(),
            latency_rounds: 3,
            extra_headers: "{}".to_string(),
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiModelOption {
    pub id: String,
    pub label: String,
    pub owned_by: Option<String>,
    pub created: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiModelDetectionResponse {
    pub models: Vec<AiModelOption>,
    pub total: usize,
    pub source_status: u16,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiLatencyRound {
    pub round: i64,
    pub latency_ms: i64,
    pub ok: bool,
    pub status: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiLatencyResult {
    pub average_latency_ms: i64,
    pub min_latency_ms: i64,
    pub max_latency_ms: i64,
    pub successful_rounds: i64,
    pub failed_rounds: i64,
    pub rounds: Vec<AiLatencyRound>,
    pub response_sample: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiChatTestResult {
    pub ok: bool,
    pub latency_ms: i64,
    pub status: u16,
    pub reply: String,
    pub error: Option<String>,
    pub model_name: String,
    pub usage_json: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AiConnectionProbeResult {
    pub ok: bool,
    pub resolved_model: String,
    pub models: Vec<AiModelOption>,
    pub total_models: usize,
    pub models_status: Option<u16>,
    pub chat_status: Option<u16>,
    pub latency_ms: Option<i64>,
    pub reply: String,
    pub error: Option<String>,
    pub usage_json: Option<String>,
    pub cache_hit: bool,
}

#[derive(Debug, Clone)]
struct CachedModelDetection {
    key: u64,
    cached_at_ms: i64,
    response: AiModelDetectionResponse,
}

#[derive(Debug)]
struct JsonResponse {
    status: u16,
    payload: Value,
}

#[derive(Debug)]
struct ModelDetectionOutcome {
    response: Option<AiModelDetectionResponse>,
    status: Option<u16>,
    error: Option<String>,
    cache_hit: bool,
}

#[derive(Debug)]
struct ChatRequestOutcome {
    ok: bool,
    status: Option<u16>,
    latency_ms: Option<i64>,
    reply: String,
    error: Option<String>,
    usage_json: Option<String>,
}

fn model_detection_cache() -> &'static Mutex<Option<CachedModelDetection>> {
    MODEL_DETECTION_CACHE.get_or_init(|| Mutex::new(None))
}

fn clear_model_detection_cache() {
    if let Ok(mut guard) = model_detection_cache().lock() {
        *guard = None;
    }
}

fn db_path() -> std::path::PathBuf {
    crate::settings::get_ai_data_dir().join(AI_DB_FILE)
}

fn open_connection() -> Result<Connection, String> {
    let path = db_path();
    crate::settings::ensure_parent(&path)?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS ai_connection_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            provider_name TEXT NOT NULL,
            base_url TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            api_key_header_name TEXT NOT NULL,
            api_key_prefix TEXT NOT NULL,
            api_key_query_name TEXT NOT NULL,
            models_path TEXT NOT NULL,
            chat_path TEXT NOT NULL,
            model_name TEXT NOT NULL DEFAULT '',
            request_timeout_ms INTEGER NOT NULL DEFAULT 120000,
            temperature REAL NOT NULL DEFAULT 0.2,
            max_tokens INTEGER NOT NULL DEFAULT 256,
            latency_prompt TEXT NOT NULL,
            latency_rounds INTEGER NOT NULL DEFAULT 3,
            api_key_encrypted BLOB NOT NULL,
            extra_headers_encrypted BLOB NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn normalize_auth_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "header" => "header".to_string(),
        "query" => "query".to_string(),
        _ => "bearer".to_string(),
    }
}

fn normalize_path(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return trimmed.to_string();
    }
    trimmed.trim_start_matches('/').to_string()
}

fn normalize_key_prefix(value: &str, auth_type: &str) -> String {
    let trimmed = value.trim();
    if auth_type == "query" {
        return String::new();
    }
    if trimmed.is_empty() {
        return if auth_type == "bearer" {
            "Bearer ".to_string()
        } else {
            String::new()
        };
    }
    if trimmed.ends_with(' ') {
        trimmed.to_string()
    } else {
        format!("{trimmed} ")
    }
}

fn normalize_extra_headers_json(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok("{}".to_string());
    }

    let parsed: Value =
        serde_json::from_str(trimmed).map_err(|e| format!("额外请求头 JSON 无效：{e}"))?;
    let Some(map) = parsed.as_object() else {
        return Err("额外请求头必须是 JSON 对象".to_string());
    };

    let mut normalized = Map::new();
    for (key, value) in map {
        let header_name = key.trim();
        let Some(text) = value.as_str() else {
            continue;
        };
        let header_value = text.trim();
        if !header_name.is_empty() && !header_value.is_empty() {
            normalized.insert(
                header_name.to_string(),
                Value::String(header_value.to_string()),
            );
        }
    }

    serde_json::to_string_pretty(&Value::Object(normalized)).map_err(|e| e.to_string())
}

fn normalize_settings(mut input: AiConnectionSettings) -> AiConnectionSettings {
    let defaults = AiConnectionSettings::default();
    let auth_type = normalize_auth_type(&input.auth_type);

    input.provider_name = input.provider_name.trim().to_string();
    if input.provider_name.is_empty() {
        input.provider_name = defaults.provider_name;
    }

    input.base_url = input.base_url.trim().trim_end_matches('/').to_string();
    if input.base_url.is_empty() {
        input.base_url = defaults.base_url;
    }

    input.api_key = input.api_key.trim().to_string();
    input.auth_type = auth_type.clone();
    input.api_key_header_name = input.api_key_header_name.trim().to_string();
    if input.api_key_header_name.is_empty() {
        input.api_key_header_name = "Authorization".to_string();
    }

    input.api_key_prefix = normalize_key_prefix(&input.api_key_prefix, &auth_type);
    input.api_key_query_name = input.api_key_query_name.trim().to_string();
    if input.api_key_query_name.is_empty() {
        input.api_key_query_name = "api_key".to_string();
    }

    input.models_path = normalize_path(&input.models_path, DEFAULT_MODELS_PATH);
    input.chat_path = normalize_path(&input.chat_path, DEFAULT_CHAT_PATH);
    input.model_name = input.model_name.trim().to_string();
    input.request_timeout_ms = input.request_timeout_ms.clamp(3_000, 300_000);
    input.temperature = input.temperature.clamp(0.0, 2.0);
    input.max_tokens = input.max_tokens.clamp(0, 8_192);
    input.latency_prompt = input.latency_prompt.trim().to_string();
    if input.latency_prompt.is_empty() {
        input.latency_prompt = DEFAULT_LATENCY_PROMPT.to_string();
    }
    input.latency_rounds = input.latency_rounds.clamp(1, 5);
    input.extra_headers =
        normalize_extra_headers_json(&input.extra_headers).unwrap_or_else(|_| "{}".to_string());
    input.updated_at = input.updated_at.or(Some(now_ms()));
    input
}

#[cfg(target_os = "windows")]
fn encrypt_secret(value: &str) -> Result<Vec<u8>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if value.is_empty() {
        return Ok(Vec::new());
    }

    let bytes = value.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| e.to_string())?;

        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn decrypt_secret(bytes: &[u8]) -> Result<String, String> {
    use windows::Win32::Foundation::{HLOCAL, LocalFree};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if bytes.is_empty() {
        return Ok(String::new());
    }

    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|e| e.to_string())?;

        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut _)));
        String::from_utf8(decrypted).map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn encrypt_secret(value: &str) -> Result<Vec<u8>, String> {
    Ok(BASE64_STANDARD.encode(value.as_bytes()).into_bytes())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_secret(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() {
        return Ok(String::new());
    }
    let decoded = BASE64_STANDARD.decode(bytes).map_err(|e| e.to_string())?;
    String::from_utf8(decoded).map_err(|e| e.to_string())
}

fn load_saved_settings() -> Result<AiConnectionSettings, String> {
    let conn = open_connection()?;
    let row = conn
        .query_row(
            r#"
            SELECT provider_name, base_url, auth_type, api_key_header_name, api_key_prefix,
                   api_key_query_name, models_path, chat_path, model_name, request_timeout_ms,
                   temperature, max_tokens, latency_prompt, latency_rounds,
                   api_key_encrypted, extra_headers_encrypted, updated_at
            FROM ai_connection_settings
            WHERE id = 1
            "#,
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, f64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, i64>(13)?,
                    row.get::<_, Vec<u8>>(14)?,
                    row.get::<_, Vec<u8>>(15)?,
                    row.get::<_, i64>(16)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(row) = row else {
        return Ok(AiConnectionSettings::default());
    };

    Ok(normalize_settings(AiConnectionSettings {
        provider_name: row.0,
        base_url: row.1,
        auth_type: row.2,
        api_key_header_name: row.3,
        api_key_prefix: row.4,
        api_key_query_name: row.5,
        models_path: row.6,
        chat_path: row.7,
        model_name: row.8,
        request_timeout_ms: row.9,
        temperature: row.10,
        max_tokens: row.11,
        latency_prompt: row.12,
        latency_rounds: row.13,
        api_key: decrypt_secret(&row.14)?,
        extra_headers: decrypt_secret(&row.15)?,
        updated_at: Some(row.16),
    }))
}

fn save_settings(settings: AiConnectionSettings) -> Result<AiConnectionSettings, String> {
    let normalized = normalize_settings(settings);
    let conn = open_connection()?;
    let updated_at = now_ms();

    conn.execute(
        r#"
        INSERT INTO ai_connection_settings (
            id, provider_name, base_url, auth_type, api_key_header_name, api_key_prefix,
            api_key_query_name, models_path, chat_path, model_name, request_timeout_ms,
            temperature, max_tokens, latency_prompt, latency_rounds,
            api_key_encrypted, extra_headers_encrypted, updated_at
        ) VALUES (
            1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
        )
        ON CONFLICT(id) DO UPDATE SET
            provider_name = excluded.provider_name,
            base_url = excluded.base_url,
            auth_type = excluded.auth_type,
            api_key_header_name = excluded.api_key_header_name,
            api_key_prefix = excluded.api_key_prefix,
            api_key_query_name = excluded.api_key_query_name,
            models_path = excluded.models_path,
            chat_path = excluded.chat_path,
            model_name = excluded.model_name,
            request_timeout_ms = excluded.request_timeout_ms,
            temperature = excluded.temperature,
            max_tokens = excluded.max_tokens,
            latency_prompt = excluded.latency_prompt,
            latency_rounds = excluded.latency_rounds,
            api_key_encrypted = excluded.api_key_encrypted,
            extra_headers_encrypted = excluded.extra_headers_encrypted,
            updated_at = excluded.updated_at
        "#,
        params![
            normalized.provider_name,
            normalized.base_url,
            normalized.auth_type,
            normalized.api_key_header_name,
            normalized.api_key_prefix,
            normalized.api_key_query_name,
            normalized.models_path,
            normalized.chat_path,
            normalized.model_name,
            normalized.request_timeout_ms,
            normalized.temperature,
            normalized.max_tokens,
            normalized.latency_prompt,
            normalized.latency_rounds,
            encrypt_secret(&normalized.api_key)?,
            encrypt_secret(&normalized.extra_headers)?,
            updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    clear_model_detection_cache();

    Ok(AiConnectionSettings {
        updated_at: Some(updated_at),
        ..normalized
    })
}

fn build_provider_url(base_url: &str, request_path: &str) -> Result<reqwest::Url, String> {
    if request_path.starts_with("http://") || request_path.starts_with("https://") {
        return reqwest::Url::parse(request_path).map_err(|e| e.to_string());
    }

    let normalized_base = if base_url.ends_with('/') {
        base_url.to_string()
    } else {
        format!("{base_url}/")
    };
    let relative_path = request_path.trim().trim_start_matches('/');
    if relative_path.is_empty() {
        return Err("请求路径不能为空".to_string());
    }
    reqwest::Url::parse(&normalized_base)
        .and_then(|value| value.join(relative_path))
        .map_err(|e| e.to_string())
}

fn parse_extra_headers(value: &str) -> Result<Vec<(String, String)>, String> {
    let normalized = normalize_extra_headers_json(value)?;
    let parsed: Value = serde_json::from_str(&normalized).map_err(|e| e.to_string())?;
    let Some(map) = parsed.as_object() else {
        return Ok(Vec::new());
    };

    Ok(map
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string())))
        .collect())
}

fn build_headers(settings: &AiConnectionSettings, include_json: bool) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if include_json {
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }

    for (key, value) in parse_extra_headers(&settings.extra_headers)? {
        let header_name = HeaderName::from_bytes(key.as_bytes()).map_err(|e| e.to_string())?;
        let header_value = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
        headers.insert(header_name, header_value);
    }

    if matches!(settings.auth_type.as_str(), "bearer" | "header") && !settings.api_key.is_empty() {
        let header_name =
            HeaderName::from_bytes(settings.api_key_header_name.as_bytes()).map_err(|e| e.to_string())?;
        let value = format!("{}{}", settings.api_key_prefix, settings.api_key);
        let header_value = HeaderValue::from_str(value.trim()).map_err(|e| e.to_string())?;
        headers.insert(header_name, header_value);
    }

    Ok(headers)
}

fn apply_query_auth(url: &mut reqwest::Url, settings: &AiConnectionSettings) {
    if settings.auth_type == "query" && !settings.api_key.is_empty() {
        url.query_pairs_mut()
            .append_pair(&settings.api_key_query_name, &settings.api_key);
    }
}

fn build_client(settings: &AiConnectionSettings) -> Result<Client, String> {
    let timeout_ms = settings.request_timeout_ms as u64;
    Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .connect_timeout(Duration::from_millis(CONNECT_TIMEOUT_MS.min(timeout_ms)))
        .build()
        .map_err(|e| e.to_string())
}

fn parse_json_response(response: Response) -> Result<JsonResponse, String> {
    let status = response.status().as_u16();
    let text = response.text().map_err(|e| e.to_string())?;
    let payload = if text.trim().is_empty() {
        Value::Null
    } else {
        serde_json::from_str::<Value>(&text)
            .or_else(|_| parse_sse_payload(&text).ok_or(serde_json::Error::io(std::io::Error::other("not sse"))))
            .unwrap_or(Value::String(text))
    };
    Ok(JsonResponse { status, payload })
}

fn parse_sse_payload(text: &str) -> Option<Value> {
    let mut reply = String::new();
    let mut usage = None;
    let mut chunks = Vec::new();
    let mut last_payload = None;

    for block in text.split("\n\n").map(str::trim).filter(|block| !block.is_empty()) {
        let data_lines = block
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
            .filter(|line| !line.is_empty() && *line != "[DONE]")
            .collect::<Vec<_>>();

        if data_lines.is_empty() {
            continue;
        }

        let payload_text = data_lines.join("\n");
        let Ok(payload) = serde_json::from_str::<Value>(&payload_text) else {
            continue;
        };

        if let Some(delta_text) = payload
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"))
            .and_then(extract_text)
        {
            reply.push_str(&delta_text);
        }

        if let Some(next_usage) = extract_usage_value(&payload) {
            usage = Some(next_usage);
        }

        chunks.push(payload.clone());
        last_payload = Some(payload);
    }

    if chunks.is_empty() {
        return None;
    }

    Some(json!({
        "reply": reply,
        "usage": usage,
        "chunks": chunks,
        "last_payload": last_payload,
    }))
}

fn extract_models(payload: &Value) -> Vec<AiModelOption> {
    let Some(items) = payload
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| payload.get("models").and_then(Value::as_array))
        .or_else(|| payload.as_array())
    else {
        return Vec::new();
    };

    let mut seen = HashSet::new();
    let mut models = Vec::new();

    for item in items {
        let Some(object) = item.as_object() else {
            continue;
        };

        let Some(id) = object
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| object.get("name").and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };

        if !seen.insert(id.to_string()) {
            continue;
        }

        models.push(AiModelOption {
            label: id.to_string(),
            id: id.to_string(),
            owned_by: object
                .get("owned_by")
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            created: object.get("created").and_then(Value::as_i64),
        });
    }

    models
}

fn extract_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(array) = value.as_array() {
        let combined = array
            .iter()
            .filter_map(extract_text)
            .collect::<Vec<_>>()
            .join("\n");
        if !combined.is_empty() {
            return Some(combined);
        }
    }

    if let Some(object) = value.as_object() {
        for key in ["text", "content", "value"] {
            if let Some(text) = object.get(key).and_then(extract_text) {
                return Some(text);
            }
        }

        for key in ["message", "delta"] {
            if let Some(text) = object.get(key).and_then(extract_text) {
                return Some(text);
            }
        }
    }

    None
}

fn extract_reply_text(payload: &Value) -> Option<String> {
    if let Some(reply) = payload.get("reply").and_then(extract_text) {
        return Some(reply);
    }

    if let Some(output_text) = payload.get("output_text").and_then(extract_text) {
        return Some(output_text);
    }

    if let Some(choice) = payload
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    {
        if let Some(text) = choice
            .get("message")
            .and_then(extract_text)
            .or_else(|| extract_text(choice))
        {
            return Some(text);
        }
    }

    if let Some(output) = payload.get("output").and_then(extract_text) {
        return Some(output);
    }

    payload
        .get("message")
        .and_then(extract_text)
        .or_else(|| payload.get("content").and_then(extract_text))
}

fn extract_usage_value(payload: &Value) -> Option<Value> {
    if let Some(usage) = payload.get("usage") {
        return Some(usage.clone());
    }

    payload
        .get("last_payload")
        .and_then(|value| value.get("usage"))
        .cloned()
}

fn read_error_message(payload: &Value, fallback: &str) -> String {
    if let Some(text) = payload.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if let Some(error) = payload.get("error") {
        if let Some(text) = error.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }

        if let Some(text) = error.get("message").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }

    if let Some(text) = payload.get("message").and_then(Value::as_str) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    fallback.to_string()
}

fn build_chat_body(
    settings: &AiConnectionSettings,
    prompt: &str,
    max_tokens_override: Option<i64>,
) -> Value {
    let mut body = Map::new();
    body.insert("model".to_string(), Value::String(settings.model_name.clone()));
    body.insert(
        "messages".to_string(),
        json!([
            {
                "role": "user",
                "content": prompt,
            }
        ]),
    );
    body.insert("temperature".to_string(), json!(settings.temperature));
    body.insert("stream".to_string(), Value::Bool(false));

    let max_tokens = max_tokens_override.unwrap_or(settings.max_tokens);
    if max_tokens > 0 {
        body.insert("max_tokens".to_string(), json!(max_tokens));
    }

    Value::Object(body)
}

fn hash_model_cache_key(settings: &AiConnectionSettings) -> u64 {
    let mut hasher = DefaultHasher::new();
    settings.base_url.hash(&mut hasher);
    settings.auth_type.hash(&mut hasher);
    settings.api_key_header_name.hash(&mut hasher);
    settings.api_key_prefix.hash(&mut hasher);
    settings.api_key_query_name.hash(&mut hasher);
    settings.models_path.hash(&mut hasher);
    settings.api_key.hash(&mut hasher);
    settings.extra_headers.hash(&mut hasher);
    hasher.finish()
}

fn detect_models_with_client(
    settings: &AiConnectionSettings,
    client: &Client,
    allow_cache: bool,
) -> ModelDetectionOutcome {
    let cache_key = hash_model_cache_key(settings);
    let now = now_ms();

    if allow_cache {
        if let Ok(guard) = model_detection_cache().lock() {
            if let Some(cached) = guard.as_ref() {
                if cached.key == cache_key && now - cached.cached_at_ms <= MODEL_CACHE_TTL_MS {
                    return ModelDetectionOutcome {
                        response: Some(cached.response.clone()),
                        status: Some(cached.response.source_status),
                        error: None,
                        cache_hit: true,
                    };
                }
            }
        }
    }

    let mut url = match build_provider_url(&settings.base_url, &settings.models_path) {
        Ok(value) => value,
        Err(error) => {
            return ModelDetectionOutcome {
                response: None,
                status: None,
                error: Some(error),
                cache_hit: false,
            };
        }
    };
    apply_query_auth(&mut url, settings);

    let headers = match build_headers(settings, false) {
        Ok(value) => value,
        Err(error) => {
            return ModelDetectionOutcome {
                response: None,
                status: None,
                error: Some(error),
                cache_hit: false,
            };
        }
    };

    let response = match client.get(url).headers(headers).send() {
        Ok(value) => value,
        Err(error) => {
            return ModelDetectionOutcome {
                response: None,
                status: None,
                error: Some(error.to_string()),
                cache_hit: false,
            };
        }
    };

    let parsed = match parse_json_response(response) {
        Ok(value) => value,
        Err(error) => {
            return ModelDetectionOutcome {
                response: None,
                status: None,
                error: Some(error),
                cache_hit: false,
            };
        }
    };

    if parsed.status >= 400 {
        return ModelDetectionOutcome {
            response: None,
            status: Some(parsed.status),
            error: Some(read_error_message(
                &parsed.payload,
                &format!("模型探测失败，状态码 {}", parsed.status),
            )),
            cache_hit: false,
        };
    }

    let models = extract_models(&parsed.payload);
    let detected = AiModelDetectionResponse {
        total: models.len(),
        models,
        source_status: parsed.status,
    };

    if let Ok(mut guard) = model_detection_cache().lock() {
        *guard = Some(CachedModelDetection {
            key: cache_key,
            cached_at_ms: now,
            response: detected.clone(),
        });
    }

    ModelDetectionOutcome {
        response: Some(detected),
        status: Some(parsed.status),
        error: None,
        cache_hit: false,
    }
}

fn perform_chat_request_with_client(
    settings: &AiConnectionSettings,
    client: &Client,
    prompt: &str,
    max_tokens_override: Option<i64>,
) -> Result<(JsonResponse, i64), String> {
    if settings.model_name.trim().is_empty() {
        return Err("请先填写模型名称后再执行测试".to_string());
    }

    let mut url = build_provider_url(&settings.base_url, &settings.chat_path)?;
    apply_query_auth(&mut url, settings);
    let headers = build_headers(settings, true)?;
    let body = build_chat_body(settings, prompt, max_tokens_override);
    let started = Instant::now();
    let response = client
        .post(url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let latency_ms = started.elapsed().as_millis() as i64;
    Ok((parse_json_response(response)?, latency_ms))
}

fn probe_chat_with_client(
    settings: &AiConnectionSettings,
    client: &Client,
    prompt: &str,
    max_tokens_override: Option<i64>,
) -> ChatRequestOutcome {
    let (response, latency_ms) =
        match perform_chat_request_with_client(settings, client, prompt, max_tokens_override) {
            Ok(value) => value,
            Err(error) => {
                return ChatRequestOutcome {
                    ok: false,
                    status: None,
                    latency_ms: None,
                    reply: String::new(),
                    error: Some(error),
                    usage_json: None,
                };
            }
        };

    if response.status >= 400 {
        return ChatRequestOutcome {
            ok: false,
            status: Some(response.status),
            latency_ms: Some(latency_ms),
            reply: String::new(),
            error: Some(read_error_message(
                &response.payload,
                &format!("测活失败，状态码 {}", response.status),
            )),
            usage_json: usage_json(&response.payload),
        };
    }

    ChatRequestOutcome {
        ok: true,
        status: Some(response.status),
        latency_ms: Some(latency_ms),
        reply: extract_reply_text(&response.payload)
            .unwrap_or_else(|| EMPTY_REPLY_NOTE.to_string()),
        error: None,
        usage_json: usage_json(&response.payload),
    }
}

fn usage_json(payload: &Value) -> Option<String> {
    extract_usage_value(payload).map(|value| {
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
    })
}

#[tauri::command]
pub fn ai_get_connection_settings() -> Result<AiConnectionSettings, String> {
    load_saved_settings()
}

#[tauri::command]
pub fn ai_save_connection_settings(
    settings: AiConnectionSettings,
) -> Result<AiConnectionSettings, String> {
    save_settings(settings)
}

#[tauri::command]
pub fn ai_detect_models(settings: AiConnectionSettings) -> Result<AiModelDetectionResponse, String> {
    let settings = normalize_settings(settings);
    let client = build_client(&settings)?;
    let outcome = detect_models_with_client(&settings, &client, true);
    if let Some(response) = outcome.response {
        return Ok(response);
    }
    Err(outcome
        .error
        .unwrap_or_else(|| "模型探测失败，请稍后重试".to_string()))
}

#[tauri::command]
pub fn ai_probe_connection(settings: AiConnectionSettings) -> Result<AiConnectionProbeResult, String> {
    let mut settings = normalize_settings(settings);
    let client = build_client(&settings)?;
    let detection = detect_models_with_client(&settings, &client, true);

    let models = detection
        .response
        .as_ref()
        .map(|value| value.models.clone())
        .unwrap_or_default();
    let total_models = detection
        .response
        .as_ref()
        .map(|value| value.total)
        .unwrap_or(0);

    let resolved_model = if settings.model_name.trim().is_empty() {
        models.first().map(|item| item.id.clone()).unwrap_or_default()
    } else {
        settings.model_name.clone()
    };

    settings.model_name = resolved_model.clone();

    let chat = if resolved_model.is_empty() {
        ChatRequestOutcome {
            ok: false,
            status: None,
            latency_ms: None,
            reply: String::new(),
            error: Some("未探测到模型，也没有手动填写模型名称".to_string()),
            usage_json: None,
        }
    } else {
        probe_chat_with_client(&settings, &client, DEFAULT_LATENCY_PROMPT, Some(48))
    };

    let error = if chat.error.is_some() {
        chat.error.clone()
    } else {
        detection.error.clone()
    };

    Ok(AiConnectionProbeResult {
        ok: chat.ok,
        resolved_model,
        models,
        total_models,
        models_status: detection.status,
        chat_status: chat.status,
        latency_ms: chat.latency_ms,
        reply: chat.reply,
        error,
        usage_json: chat.usage_json,
        cache_hit: detection.cache_hit,
    })
}

#[tauri::command]
pub fn ai_test_latency(settings: AiConnectionSettings) -> Result<AiLatencyResult, String> {
    let settings = normalize_settings(settings);
    let client = build_client(&settings)?;
    let mut rounds = Vec::new();
    let mut response_sample = None;

    for round in 0..settings.latency_rounds {
        let outcome = probe_chat_with_client(&settings, &client, &settings.latency_prompt, Some(32));
        if outcome.ok && response_sample.is_none() && !outcome.reply.is_empty() {
            response_sample = Some(outcome.reply.clone());
        }

        rounds.push(AiLatencyRound {
            round: round + 1,
            latency_ms: outcome.latency_ms.unwrap_or(0),
            ok: outcome.ok,
            status: outcome.status,
            error: outcome.error,
        });
    }

    let successful_latencies = rounds
        .iter()
        .filter(|round| round.ok)
        .map(|round| round.latency_ms)
        .collect::<Vec<_>>();

    let successful_rounds = successful_latencies.len() as i64;
    let failed_rounds = rounds.len() as i64 - successful_rounds;
    let (average_latency_ms, min_latency_ms, max_latency_ms) = if successful_latencies.is_empty() {
        (0, 0, 0)
    } else {
        let total: i64 = successful_latencies.iter().sum();
        let min = *successful_latencies.iter().min().unwrap_or(&0);
        let max = *successful_latencies.iter().max().unwrap_or(&0);
        (total / successful_latencies.len() as i64, min, max)
    };

    Ok(AiLatencyResult {
        average_latency_ms,
        min_latency_ms,
        max_latency_ms,
        successful_rounds,
        failed_rounds,
        rounds,
        response_sample,
    })
}

#[tauri::command]
pub fn ai_test_chat(
    settings: AiConnectionSettings,
    prompt: Option<String>,
) -> Result<AiChatTestResult, String> {
    let settings = normalize_settings(settings);
    let prompt = prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_LATENCY_PROMPT.to_string());
    let client = build_client(&settings)?;
    let outcome = probe_chat_with_client(&settings, &client, &prompt, None);

    Ok(AiChatTestResult {
        ok: outcome.ok,
        latency_ms: outcome.latency_ms.unwrap_or(0),
        status: outcome.status.unwrap_or_default(),
        reply: outcome.reply,
        error: outcome.error,
        model_name: settings.model_name,
        usage_json: outcome.usage_json,
    })
}


