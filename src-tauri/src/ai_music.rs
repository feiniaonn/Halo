use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};

const AI_DB_FILE: &str = "halo_ai.db";
const CONNECT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_CHAT_PATH: &str = "v1/chat/completions";
const DEFAULT_MUSIC_AI_SYSTEM_PROMPT: &str =
    "你是专业的音乐偏好分析专家。请根据用户近期播放最频繁的前 10 首歌曲（可能受语言、流派、心情等影响）分析用户的当前音乐品味。基于此，精心挑选一首能与该偏好完美契合并适合此刻播放的补充单曲（尽量避免推荐榜单中已存在的原曲）。同时，给出一个精准的 2 到 4 个字的心情状态或者环境氛围形容词。不要输出任何解释，严格只返回规定的 JSON 结构。";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusicAiModuleSettings {
    pub enabled: bool,
    pub system_prompt: String,
    pub updated_at: Option<i64>,
}

impl Default for MusicAiModuleSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            system_prompt: DEFAULT_MUSIC_AI_SYSTEM_PROMPT.to_string(),
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusicAiRecommendation {
    pub enabled: bool,
    pub configured: bool,
    pub source: String,
    pub song_name: Option<String>,
    pub mood: Option<String>,
    pub raw_reply: Option<String>,
    pub error: Option<String>,
    pub updated_at: Option<i64>,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MusicAiProbeRequest {
    pub force_refresh: Option<bool>,
}

#[derive(Debug)]
struct JsonResponse {
    status: u16,
    payload: Value,
}

#[derive(Debug)]
struct ParsedRecommendation {
    song_name: String,
    mood: String,
}

#[derive(Debug)]
struct CachedRecommendation {
    ranking_hash: String,
    settings_hash: String,
    song_name: String,
    mood: String,
    raw_reply: String,
    updated_at: i64,
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

        CREATE TABLE IF NOT EXISTS music_ai_module_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 0,
            system_prompt TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS music_ai_recommendation_cache (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            ranking_hash TEXT NOT NULL,
            settings_hash TEXT NOT NULL,
            song_name TEXT NOT NULL,
            mood TEXT NOT NULL,
            raw_reply TEXT NOT NULL,
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

fn normalize_settings(mut input: MusicAiModuleSettings) -> MusicAiModuleSettings {
    input.system_prompt = input.system_prompt.trim().to_string();
    if input.system_prompt.is_empty() {
        input.system_prompt = DEFAULT_MUSIC_AI_SYSTEM_PROMPT.to_string();
    }
    if input.updated_at.is_none() {
        input.updated_at = Some(now_ms());
    }
    input
}

fn load_music_ai_settings() -> Result<MusicAiModuleSettings, String> {
    let conn = open_connection()?;
    let row = conn
        .query_row(
            r#"
            SELECT enabled, system_prompt, updated_at
            FROM music_ai_module_settings
            WHERE id = 1
            "#,
            [],
            |row| {
                Ok(MusicAiModuleSettings {
                    enabled: row.get::<_, i64>(0)? != 0,
                    system_prompt: row.get(1)?,
                    updated_at: Some(row.get(2)?),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(normalize_settings(row.unwrap_or_default()))
}

fn save_music_ai_settings(
    settings: MusicAiModuleSettings,
) -> Result<MusicAiModuleSettings, String> {
    let normalized = normalize_settings(settings);
    let updated_at = now_ms();
    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO music_ai_module_settings (id, enabled, system_prompt, updated_at)
        VALUES (1, ?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            system_prompt = excluded.system_prompt,
            updated_at = excluded.updated_at
        "#,
        params![
            if normalized.enabled { 1_i64 } else { 0_i64 },
            normalized.system_prompt,
            updated_at
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(MusicAiModuleSettings {
        updated_at: Some(updated_at),
        ..normalized
    })
}

fn load_cached_recommendation() -> Result<Option<CachedRecommendation>, String> {
    let conn = open_connection()?;
    conn.query_row(
        r#"
        SELECT ranking_hash, settings_hash, song_name, mood, raw_reply, updated_at
        FROM music_ai_recommendation_cache
        WHERE id = 1
        "#,
        [],
        |row| {
            Ok(CachedRecommendation {
                ranking_hash: row.get(0)?,
                settings_hash: row.get(1)?,
                song_name: row.get(2)?,
                mood: row.get(3)?,
                raw_reply: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn save_cached_recommendation(
    ranking_hash: &str,
    settings_hash: &str,
    parsed: &ParsedRecommendation,
    raw_reply: &str,
) -> Result<i64, String> {
    let updated_at = now_ms();
    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO music_ai_recommendation_cache (
            id, ranking_hash, settings_hash, song_name, mood, raw_reply, updated_at
        ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(id) DO UPDATE SET
            ranking_hash = excluded.ranking_hash,
            settings_hash = excluded.settings_hash,
            song_name = excluded.song_name,
            mood = excluded.mood,
            raw_reply = excluded.raw_reply,
            updated_at = excluded.updated_at
        "#,
        params![
            ranking_hash,
            settings_hash,
            parsed.song_name,
            parsed.mood,
            raw_reply,
            updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(updated_at)
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
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let parsed: Value = serde_json::from_str(trimmed).map_err(|e| e.to_string())?;
    let Some(map) = parsed.as_object() else {
        return Ok(Vec::new());
    };

    Ok(map
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_string())))
        .collect())
}

fn build_headers(
    settings: &crate::ai_management::AiConnectionSettings,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

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

fn apply_query_auth(
    url: &mut reqwest::Url,
    settings: &crate::ai_management::AiConnectionSettings,
) {
    if settings.auth_type == "query" && !settings.api_key.is_empty() {
        url.query_pairs_mut()
            .append_pair(&settings.api_key_query_name, &settings.api_key);
    }
}

fn build_client(timeout_ms: i64) -> Result<Client, String> {
    let timeout_ms = timeout_ms.clamp(3_000, 300_000) as u64;
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
    let mut chunks = Vec::new();
    let mut usage = None;

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

        if let Some(next_usage) = payload.get("usage") {
            usage = Some(next_usage.clone());
        }

        chunks.push(payload);
    }

    if chunks.is_empty() {
        return None;
    }

    Some(json!({
        "reply": reply,
        "chunks": chunks,
        "usage": usage,
    }))
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

    payload
        .get("output_text")
        .and_then(extract_text)
        .or_else(|| payload.get("message").and_then(extract_text))
        .or_else(|| payload.get("content").and_then(extract_text))
}

fn read_error_message(payload: &Value, fallback: &str) -> String {
    if let Some(error) = payload.get("error") {
        if let Some(text) = error.get("message").and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(text) = error.as_str() {
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

fn hash_text(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn build_top10_payload(records: &[crate::db::PlayRecord]) -> Value {
    Value::Array(
        records
            .iter()
            .enumerate()
            .map(|(index, record)| {
                json!({
                    "rank": index + 1,
                    "artist": record.artist,
                    "title": record.title,
                    "play_count": record.play_count,
                })
            })
            .collect(),
    )
}

fn build_ranking_hash(records: &[crate::db::PlayRecord]) -> String {
    let payload = build_top10_payload(records);
    hash_text(&payload.to_string())
}

fn build_settings_hash(
    connection: &crate::ai_management::AiConnectionSettings,
    module_settings: &MusicAiModuleSettings,
) -> String {
    hash_text(&format!(
        "{}\n{}\n{}\n{}",
        connection.base_url,
        connection.model_name,
        connection.chat_path,
        module_settings.system_prompt
    ))
}

fn build_music_ai_body(
    connection: &crate::ai_management::AiConnectionSettings,
    system_prompt: &str,
    top10: &[crate::db::PlayRecord],
) -> Value {
    let top10_payload = build_top10_payload(top10);
    json!({
        "model": connection.model_name,
        "stream": false,
        "temperature": 0.45,
        "max_tokens": 120,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": format!(
                    "这是用户最近频繁播放的 Top 10 榜单：{}\n\n请直接返回纯 JSON 格式数据，包含 song_name 和 mood 两个字段，示例：{{\"song_name\": \"歌曲名 - 歌手\", \"mood\": \"静谧思考\"}}\n绝不要包裹在 ```json 代码块中，绝不要附加任何解释。",
                    top10_payload
                ),
            }
        ],
    })
}

fn parse_recommendation(reply: &str) -> Option<ParsedRecommendation> {
    let trimmed = reply.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate_json = if trimmed.starts_with('{') && trimmed.ends_with('}') {
        Some(trimmed.to_string())
    } else {
        let start = trimmed.find('{')?;
        let end = trimmed.rfind('}')?;
        Some(trimmed[start..=end].to_string())
    };

    if let Some(candidate_json) = candidate_json {
        if let Ok(value) = serde_json::from_str::<Value>(&candidate_json) {
            let song_name = value
                .get("song_name")
                .and_then(Value::as_str)
                .or_else(|| value.get("song").and_then(Value::as_str))
                .or_else(|| value.get("title").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let mood = value
                .get("mood")
                .and_then(Value::as_str)
                .or_else(|| value.get("feeling").and_then(Value::as_str))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);

            if let (Some(song_name), Some(mood)) = (song_name, mood) {
                return Some(ParsedRecommendation {
                    song_name,
                    mood: mood.chars().take(5).collect(),
                });
            }
        }
    }

    let mut parts = trimmed
        .split(['|', '\n', '｜'])
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let song_name = parts.next()?.to_string();
    let mood = parts
        .next()
        .map(|value| value.chars().take(5).collect::<String>())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "此刻想听".chars().take(5).collect());

    Some(ParsedRecommendation { song_name, mood })
}

fn request_music_recommendation(
    connection: &crate::ai_management::AiConnectionSettings,
    module_settings: &MusicAiModuleSettings,
    top10: &[crate::db::PlayRecord],
) -> Result<(ParsedRecommendation, String), String> {
    let client = build_client(connection.request_timeout_ms)?;
    let chat_path = if connection.chat_path.trim().is_empty() {
        DEFAULT_CHAT_PATH
    } else {
        connection.chat_path.as_str()
    };

    let mut url = build_provider_url(&connection.base_url, chat_path)?;
    apply_query_auth(&mut url, connection);
    let headers = build_headers(connection)?;
    let body = build_music_ai_body(connection, &module_settings.system_prompt, top10);

    let started = Instant::now();
    let response = client
        .post(url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let latency_ms = started.elapsed().as_millis() as i64;
    let parsed = parse_json_response(response)?;

    if parsed.status >= 400 {
        return Err(read_error_message(
            &parsed.payload,
            &format!("音乐 AI 推荐请求失败，状态码 {}", parsed.status),
        ));
    }

    let reply = extract_reply_text(&parsed.payload)
        .unwrap_or_else(|| "接口已响应，但没有返回可读的推荐内容。".to_string());
    let recommendation = parse_recommendation(&reply)
        .ok_or_else(|| "AI 已响应，但返回内容无法解析成歌曲名和心情描述".to_string())?;
    let _ = latency_ms;
    Ok((recommendation, reply))
}

fn empty_recommendation(
    enabled: bool,
    configured: bool,
    source: &str,
    error: Option<String>,
    model_name: Option<String>,
) -> MusicAiRecommendation {
    MusicAiRecommendation {
        enabled,
        configured,
        source: source.to_string(),
        song_name: None,
        mood: None,
        raw_reply: None,
        error,
        updated_at: None,
        model_name,
    }
}

fn resolve_music_recommendation(force_refresh: bool) -> Result<MusicAiRecommendation, String> {
    let module_settings = load_music_ai_settings()?;
    let connection = crate::ai_management::ai_get_connection_settings()?;
    let configured = !connection.base_url.trim().is_empty()
        && !connection.api_key.trim().is_empty()
        && !connection.model_name.trim().is_empty();

    if !module_settings.enabled {
        return Ok(empty_recommendation(
            false,
            configured,
            "disabled",
            None,
            Some(connection.model_name),
        ));
    }

    if !configured {
        return Ok(empty_recommendation(
            true,
            false,
            "unconfigured",
            Some("请先在 AI 设置里补全请求地址、密钥和模型名称。".to_string()),
            Some(connection.model_name),
        ));
    }

    let top10 = crate::music::aggregated_top10()?;
    if top10.is_empty() {
        return Ok(empty_recommendation(
            true,
            true,
            "no-data",
            Some("当前播放记录不足，暂时还无法生成音乐推荐。".to_string()),
            Some(connection.model_name),
        ));
    }

    let ranking_hash = build_ranking_hash(&top10);
    let settings_hash = build_settings_hash(&connection, &module_settings);
    let current_now_ms = now_ms();
    if !force_refresh {
        if let Some(cached) = load_cached_recommendation()? {
            if cached.ranking_hash == ranking_hash
                && cached.settings_hash == settings_hash
                && current_now_ms - cached.updated_at <= MUSIC_AI_CACHE_TTL_MS
            {
                return Ok(MusicAiRecommendation {
                    enabled: true,
                    configured: true,
                    source: "cache".to_string(),
                    song_name: Some(cached.song_name),
                    mood: Some(cached.mood),
                    raw_reply: Some(cached.raw_reply),
                    error: None,
                    updated_at: Some(cached.updated_at),
                    model_name: Some(connection.model_name),
                });
            }
        }
    }

    match request_music_recommendation(&connection, &module_settings, &top10) {
        Ok((parsed, raw_reply)) => {
            let updated_at = save_cached_recommendation(&ranking_hash, &settings_hash, &parsed, &raw_reply)?;
            Ok(MusicAiRecommendation {
                enabled: true,
                configured: true,
                source: "live".to_string(),
                song_name: Some(parsed.song_name),
                mood: Some(parsed.mood),
                raw_reply: Some(raw_reply),
                error: None,
                updated_at: Some(updated_at),
                model_name: Some(connection.model_name),
            })
        }
        Err(error) => Ok(MusicAiRecommendation {
            error: Some(error),
            source: "error".to_string(),
            model_name: Some(connection.model_name.clone()),
            ..empty_recommendation(true, true, "error", None, Some(connection.model_name))
        }),
    }
}

#[tauri::command]
pub fn ai_music_get_settings() -> Result<MusicAiModuleSettings, String> {
    load_music_ai_settings()
}

#[tauri::command]
pub fn ai_music_save_settings(
    settings: MusicAiModuleSettings,
) -> Result<MusicAiModuleSettings, String> {
    save_music_ai_settings(settings)
}

#[tauri::command]
pub fn ai_music_get_recommendation(
    request: Option<MusicAiProbeRequest>,
) -> Result<MusicAiRecommendation, String> {
    resolve_music_recommendation(request.and_then(|value| value.force_refresh).unwrap_or(false))
}
