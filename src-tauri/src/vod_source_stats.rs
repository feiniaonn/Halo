use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;

const VOD_DB_FILE: &str = "halo_vod.db";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodSiteRankingRecord {
    pub site_key: String,
    pub success_count: i64,
    pub last_success_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodCachedPayloadRecord {
    pub payload_json: String,
    pub updated_at: i64,
    pub expires_at: i64,
}

fn db_path() -> PathBuf {
    crate::settings::get_vod_data_dir().join(VOD_DB_FILE)
}

fn open_connection() -> Result<Connection, String> {
    let path = db_path();
    crate::settings::ensure_parent(&path)?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS vod_site_rankings (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            site_key TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            last_success_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(source_key, repo_url, site_key)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_site_rankings_order
            ON vod_site_rankings(source_key, repo_url, success_count DESC, last_success_at DESC);

        CREATE TABLE IF NOT EXISTS vod_aggregate_search_cache (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            keyword_key TEXT NOT NULL,
            site_set_key TEXT NOT NULL DEFAULT '',
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(source_key, repo_url, keyword_key, site_set_key)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_aggregate_search_cache_expire
            ON vod_aggregate_search_cache(expires_at);

        CREATE TABLE IF NOT EXISTS vod_detail_cache (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            site_key TEXT NOT NULL,
            vod_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(source_key, repo_url, site_key, vod_id)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_detail_cache_expire
            ON vod_detail_cache(expires_at);
        "#,
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

pub fn list_vod_site_rankings(
    source_key: &str,
    repo_url: Option<&str>,
    limit: i64,
) -> Result<Vec<VodSiteRankingRecord>, String> {
    let source_key = source_key.trim();
    if source_key.is_empty() {
        return Ok(Vec::new());
    }

    let normalized_repo_url = repo_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");

    let conn = open_connection()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT site_key, success_count, last_success_at
            FROM vod_site_rankings
            WHERE source_key = ?1 AND repo_url = ?2
            ORDER BY success_count DESC, last_success_at DESC, site_key ASC
            LIMIT ?3
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![source_key, normalized_repo_url, limit.max(1).min(100)], |row| {
            Ok(VodSiteRankingRecord {
                site_key: row.get(0)?,
                success_count: row.get(1)?,
                last_success_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn record_vod_site_success(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    if source_key.is_empty() || site_key.is_empty() {
        return Ok(());
    }

    let normalized_repo_url = repo_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_site_rankings (
            source_key, repo_url, site_key, success_count, last_success_at
        ) VALUES (?1, ?2, ?3, 1, ?4)
        ON CONFLICT(source_key, repo_url, site_key) DO UPDATE SET
            success_count = vod_site_rankings.success_count + 1,
            last_success_at = excluded.last_success_at
        "#,
        params![source_key, normalized_repo_url, site_key, now_ms],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn normalize_repo_url(repo_url: Option<&str>) -> &str {
    repo_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
}

pub fn load_vod_aggregate_search_cache(
    source_key: &str,
    repo_url: Option<&str>,
    keyword_key: &str,
    site_set_key: &str,
    now_ms: i64,
) -> Result<Option<VodCachedPayloadRecord>, String> {
    let source_key = source_key.trim();
    let keyword_key = keyword_key.trim();
    let site_set_key = site_set_key.trim();
    if source_key.is_empty() || keyword_key.is_empty() || site_set_key.is_empty() {
        return Ok(None);
    }

    let conn = open_connection()?;
    conn.execute(
        "DELETE FROM vod_aggregate_search_cache WHERE expires_at <= ?1",
        params![now_ms],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT payload_json, updated_at, expires_at
            FROM vod_aggregate_search_cache
            WHERE source_key = ?1 AND repo_url = ?2 AND keyword_key = ?3 AND site_set_key = ?4 AND expires_at > ?5
            "#,
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(
        params![
            source_key,
            normalize_repo_url(repo_url),
            keyword_key,
            site_set_key,
            now_ms
        ],
        |row| {
            Ok(VodCachedPayloadRecord {
                payload_json: row.get(0)?,
                updated_at: row.get(1)?,
                expires_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_vod_aggregate_search_cache(
    source_key: &str,
    repo_url: Option<&str>,
    keyword_key: &str,
    site_set_key: &str,
    payload_json: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let keyword_key = keyword_key.trim();
    let site_set_key = site_set_key.trim();
    if source_key.is_empty()
        || keyword_key.is_empty()
        || site_set_key.is_empty()
        || payload_json.trim().is_empty()
    {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_aggregate_search_cache (
            source_key, repo_url, keyword_key, site_set_key, payload_json, updated_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(source_key, repo_url, keyword_key, site_set_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            keyword_key,
            site_set_key,
            payload_json,
            now_ms,
            now_ms + ttl_ms.max(1)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_vod_detail_cache(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    vod_id: &str,
    now_ms: i64,
) -> Result<Option<VodCachedPayloadRecord>, String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    let vod_id = vod_id.trim();
    if source_key.is_empty() || site_key.is_empty() || vod_id.is_empty() {
        return Ok(None);
    }

    let conn = open_connection()?;
    conn.execute("DELETE FROM vod_detail_cache WHERE expires_at <= ?1", params![now_ms])
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT payload_json, updated_at, expires_at
            FROM vod_detail_cache
            WHERE source_key = ?1 AND repo_url = ?2 AND site_key = ?3 AND vod_id = ?4 AND expires_at > ?5
            "#,
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(
        params![
            source_key,
            normalize_repo_url(repo_url),
            site_key,
            vod_id,
            now_ms
        ],
        |row| {
            Ok(VodCachedPayloadRecord {
                payload_json: row.get(0)?,
                updated_at: row.get(1)?,
                expires_at: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn save_vod_detail_cache(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    vod_id: &str,
    payload_json: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    let vod_id = vod_id.trim();
    if source_key.is_empty()
        || site_key.is_empty()
        || vod_id.is_empty()
        || payload_json.trim().is_empty()
    {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_detail_cache (
            source_key, repo_url, site_key, vod_id, payload_json, updated_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(source_key, repo_url, site_key, vod_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            site_key,
            vod_id,
            payload_json,
            now_ms,
            now_ms + ttl_ms.max(1)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
