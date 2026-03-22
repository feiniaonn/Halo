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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodParseRankingRecord {
    pub parse_url: String,
    pub success_count: i64,
    pub last_success_at: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodParseHealthRecord {
    pub parse_url: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub last_status: String,
    pub last_failure_kind: Option<String>,
    pub last_used_at: i64,
    pub last_duration_ms: i64,
    pub avg_duration_ms: i64,
    pub consecutive_hard_failures: i64,
    pub consecutive_soft_failures: i64,
    pub quarantine_until: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodDispatchBackendStatRecord {
    pub target_site_key: String,
    pub success_count: i64,
    pub failure_count: i64,
    pub last_status: String,
    pub last_failure_kind: Option<String>,
    pub last_used_at: i64,
    pub consecutive_hard_failures: i64,
    pub consecutive_upstream_failures: i64,
    pub quarantine_until: i64,
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

        CREATE TABLE IF NOT EXISTS vod_playback_resolution_cache (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            cache_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(source_key, repo_url, cache_key)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_playback_resolution_cache_expire
            ON vod_playback_resolution_cache(expires_at);

        CREATE TABLE IF NOT EXISTS vod_dispatch_cache (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            origin_site_key TEXT NOT NULL,
            keyword_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            PRIMARY KEY(source_key, repo_url, origin_site_key, keyword_key)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_dispatch_cache_expire
            ON vod_dispatch_cache(expires_at);

        CREATE TABLE IF NOT EXISTS vod_dispatch_backend_stats (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            origin_site_key TEXT NOT NULL,
            target_site_key TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_status TEXT NOT NULL DEFAULT '',
            last_failure_kind TEXT,
            last_used_at INTEGER NOT NULL DEFAULT 0,
            consecutive_hard_failures INTEGER NOT NULL DEFAULT 0,
            consecutive_upstream_failures INTEGER NOT NULL DEFAULT 0,
            quarantine_until INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(source_key, repo_url, origin_site_key, target_site_key)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_dispatch_backend_stats_order
            ON vod_dispatch_backend_stats(
                source_key,
                repo_url,
                origin_site_key,
                quarantine_until ASC,
                success_count DESC,
                last_used_at DESC
            );

        CREATE TABLE IF NOT EXISTS vod_parse_rankings (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            site_key TEXT NOT NULL,
            api_class TEXT NOT NULL DEFAULT '',
            route_name TEXT NOT NULL DEFAULT '',
            parse_url TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            last_success_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(source_key, repo_url, site_key, api_class, route_name, parse_url)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_parse_rankings_order
            ON vod_parse_rankings(
                source_key,
                repo_url,
                site_key,
                api_class,
                route_name,
                success_count DESC,
                last_success_at DESC,
                parse_url ASC
            );

        CREATE TABLE IF NOT EXISTS vod_parse_health_stats (
            source_key TEXT NOT NULL,
            repo_url TEXT NOT NULL DEFAULT '',
            site_key TEXT NOT NULL,
            api_class TEXT NOT NULL DEFAULT '',
            route_name TEXT NOT NULL DEFAULT '',
            parse_url TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_status TEXT NOT NULL DEFAULT '',
            last_failure_kind TEXT,
            last_used_at INTEGER NOT NULL DEFAULT 0,
            last_duration_ms INTEGER NOT NULL DEFAULT 0,
            avg_duration_ms INTEGER NOT NULL DEFAULT 0,
            consecutive_hard_failures INTEGER NOT NULL DEFAULT 0,
            consecutive_soft_failures INTEGER NOT NULL DEFAULT 0,
            quarantine_until INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(source_key, repo_url, site_key, api_class, route_name, parse_url)
        );

        CREATE INDEX IF NOT EXISTS idx_vod_parse_health_stats_order
            ON vod_parse_health_stats(
                source_key,
                repo_url,
                site_key,
                api_class,
                route_name,
                quarantine_until ASC,
                success_count DESC,
                avg_duration_ms ASC,
                last_used_at DESC,
                parse_url ASC
            );
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

pub fn list_vod_parse_rankings(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    api_class: &str,
    route_name: &str,
    limit: i64,
) -> Result<Vec<VodParseRankingRecord>, String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    if source_key.is_empty() || site_key.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_connection()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT parse_url, success_count, last_success_at
            FROM vod_parse_rankings
            WHERE source_key = ?1 AND repo_url = ?2 AND site_key = ?3 AND api_class = ?4 AND route_name = ?5
            ORDER BY success_count DESC, last_success_at DESC, parse_url ASC
            LIMIT ?6
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            params![
                source_key,
                normalize_repo_url(repo_url),
                site_key,
                api_class.trim(),
                route_name.trim(),
                limit.max(1).min(32)
            ],
            |row| {
                Ok(VodParseRankingRecord {
                    parse_url: row.get(0)?,
                    success_count: row.get(1)?,
                    last_success_at: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn record_vod_parse_success(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    api_class: &str,
    route_name: &str,
    parse_url: &str,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    let parse_url = parse_url.trim();
    if source_key.is_empty() || site_key.is_empty() || parse_url.is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_parse_rankings (
            source_key, repo_url, site_key, api_class, route_name, parse_url, success_count, last_success_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
        ON CONFLICT(source_key, repo_url, site_key, api_class, route_name, parse_url) DO UPDATE SET
            success_count = vod_parse_rankings.success_count + 1,
            last_success_at = excluded.last_success_at
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            site_key,
            api_class.trim(),
            route_name.trim(),
            parse_url,
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn list_vod_parse_health_records(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    api_class: &str,
    route_name: &str,
    limit: i64,
) -> Result<Vec<VodParseHealthRecord>, String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    if source_key.is_empty() || site_key.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_connection()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                parse_url,
                success_count,
                failure_count,
                last_status,
                last_failure_kind,
                last_used_at,
                last_duration_ms,
                avg_duration_ms,
                consecutive_hard_failures,
                consecutive_soft_failures,
                quarantine_until
            FROM vod_parse_health_stats
            WHERE source_key = ?1 AND repo_url = ?2 AND site_key = ?3 AND api_class = ?4 AND route_name = ?5
            ORDER BY quarantine_until ASC, success_count DESC, avg_duration_ms ASC, last_used_at DESC, parse_url ASC
            LIMIT ?6
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            params![
                source_key,
                normalize_repo_url(repo_url),
                site_key,
                api_class.trim(),
                route_name.trim(),
                limit.max(1).min(32)
            ],
            |row| {
                Ok(VodParseHealthRecord {
                    parse_url: row.get(0)?,
                    success_count: row.get(1)?,
                    failure_count: row.get(2)?,
                    last_status: row.get(3)?,
                    last_failure_kind: row.get(4)?,
                    last_used_at: row.get(5)?,
                    last_duration_ms: row.get(6)?,
                    avg_duration_ms: row.get(7)?,
                    consecutive_hard_failures: row.get(8)?,
                    consecutive_soft_failures: row.get(9)?,
                    quarantine_until: row.get(10)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn record_vod_parse_health_success(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    api_class: &str,
    route_name: &str,
    parse_url: &str,
    duration_ms: i64,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    let parse_url = parse_url.trim();
    if source_key.is_empty() || site_key.is_empty() || parse_url.is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_parse_health_stats (
            source_key,
            repo_url,
            site_key,
            api_class,
            route_name,
            parse_url,
            success_count,
            failure_count,
            last_status,
            last_failure_kind,
            last_used_at,
            last_duration_ms,
            avg_duration_ms,
            consecutive_hard_failures,
            consecutive_soft_failures,
            quarantine_until
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, 'success', NULL, ?7, ?8, ?8, 0, 0, 0)
        ON CONFLICT(source_key, repo_url, site_key, api_class, route_name, parse_url) DO UPDATE SET
            success_count = vod_parse_health_stats.success_count + 1,
            last_status = 'success',
            last_failure_kind = NULL,
            last_used_at = excluded.last_used_at,
            last_duration_ms = excluded.last_duration_ms,
            avg_duration_ms = CASE
                WHEN excluded.last_duration_ms > 0 THEN
                    ((vod_parse_health_stats.avg_duration_ms * (vod_parse_health_stats.success_count + vod_parse_health_stats.failure_count))
                        + excluded.last_duration_ms)
                    / (vod_parse_health_stats.success_count + vod_parse_health_stats.failure_count + 1)
                ELSE vod_parse_health_stats.avg_duration_ms
            END,
            consecutive_hard_failures = 0,
            consecutive_soft_failures = 0,
            quarantine_until = 0
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            site_key,
            api_class.trim(),
            route_name.trim(),
            parse_url,
            now_ms,
            duration_ms.max(0)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn record_vod_parse_health_failure(
    source_key: &str,
    repo_url: Option<&str>,
    site_key: &str,
    api_class: &str,
    route_name: &str,
    parse_url: &str,
    last_status: &str,
    last_failure_kind: Option<&str>,
    duration_ms: i64,
    hard_failure: bool,
    soft_failure: bool,
    quarantine_until_ms: i64,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let site_key = site_key.trim();
    let parse_url = parse_url.trim();
    let last_status = last_status.trim();
    if source_key.is_empty() || site_key.is_empty() || parse_url.is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_parse_health_stats (
            source_key,
            repo_url,
            site_key,
            api_class,
            route_name,
            parse_url,
            success_count,
            failure_count,
            last_status,
            last_failure_kind,
            last_used_at,
            last_duration_ms,
            avg_duration_ms,
            consecutive_hard_failures,
            consecutive_soft_failures,
            quarantine_until
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            ?5,
            ?6,
            0,
            1,
            ?7,
            ?8,
            ?9,
            ?10,
            ?10,
            CASE WHEN ?11 THEN 1 ELSE 0 END,
            CASE WHEN ?12 THEN 1 ELSE 0 END,
            ?13
        )
        ON CONFLICT(source_key, repo_url, site_key, api_class, route_name, parse_url) DO UPDATE SET
            failure_count = vod_parse_health_stats.failure_count + 1,
            last_status = excluded.last_status,
            last_failure_kind = excluded.last_failure_kind,
            last_used_at = excluded.last_used_at,
            last_duration_ms = excluded.last_duration_ms,
            avg_duration_ms = CASE
                WHEN excluded.last_duration_ms > 0 THEN
                    ((vod_parse_health_stats.avg_duration_ms * (vod_parse_health_stats.success_count + vod_parse_health_stats.failure_count))
                        + excluded.last_duration_ms)
                    / (vod_parse_health_stats.success_count + vod_parse_health_stats.failure_count + 1)
                ELSE vod_parse_health_stats.avg_duration_ms
            END,
            consecutive_hard_failures = CASE
                WHEN ?11 THEN vod_parse_health_stats.consecutive_hard_failures + 1
                ELSE 0
            END,
            consecutive_soft_failures = CASE
                WHEN ?12 THEN vod_parse_health_stats.consecutive_soft_failures + 1
                ELSE 0
            END,
            quarantine_until = CASE
                WHEN excluded.quarantine_until > vod_parse_health_stats.quarantine_until
                    THEN excluded.quarantine_until
                ELSE vod_parse_health_stats.quarantine_until
            END
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            site_key,
            api_class.trim(),
            route_name.trim(),
            parse_url,
            if last_status.is_empty() { "failed" } else { last_status },
            last_failure_kind,
            now_ms,
            duration_ms.max(0),
            hard_failure,
            soft_failure,
            quarantine_until_ms.max(0)
        ],
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

pub fn load_vod_playback_resolution_cache(
    source_key: &str,
    repo_url: Option<&str>,
    cache_key: &str,
    now_ms: i64,
) -> Result<Option<VodCachedPayloadRecord>, String> {
    let source_key = source_key.trim();
    let cache_key = cache_key.trim();
    if source_key.is_empty() || cache_key.is_empty() {
        return Ok(None);
    }

    let conn = open_connection()?;
    conn.execute(
        "DELETE FROM vod_playback_resolution_cache WHERE expires_at <= ?1",
        params![now_ms],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT payload_json, updated_at, expires_at
            FROM vod_playback_resolution_cache
            WHERE source_key = ?1 AND repo_url = ?2 AND cache_key = ?3 AND expires_at > ?4
            "#,
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(
        params![source_key, normalize_repo_url(repo_url), cache_key, now_ms],
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

pub fn save_vod_playback_resolution_cache(
    source_key: &str,
    repo_url: Option<&str>,
    cache_key: &str,
    payload_json: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let cache_key = cache_key.trim();
    if source_key.is_empty() || cache_key.is_empty() || payload_json.trim().is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_playback_resolution_cache (
            source_key, repo_url, cache_key, payload_json, updated_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(source_key, repo_url, cache_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            cache_key,
            payload_json,
            now_ms,
            now_ms + ttl_ms.max(1)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_vod_dispatch_cache(
    source_key: &str,
    repo_url: Option<&str>,
    origin_site_key: &str,
    keyword_key: &str,
    now_ms: i64,
) -> Result<Option<VodCachedPayloadRecord>, String> {
    let source_key = source_key.trim();
    let origin_site_key = origin_site_key.trim();
    let keyword_key = keyword_key.trim();
    if source_key.is_empty() || origin_site_key.is_empty() || keyword_key.is_empty() {
        return Ok(None);
    }

    let conn = open_connection()?;
    conn.execute(
        "DELETE FROM vod_dispatch_cache WHERE expires_at <= ?1",
        params![now_ms],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            r#"
            SELECT payload_json, updated_at, expires_at
            FROM vod_dispatch_cache
            WHERE source_key = ?1 AND repo_url = ?2 AND origin_site_key = ?3 AND keyword_key = ?4 AND expires_at > ?5
            "#,
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(
        params![
            source_key,
            normalize_repo_url(repo_url),
            origin_site_key,
            keyword_key,
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

pub fn save_vod_dispatch_cache(
    source_key: &str,
    repo_url: Option<&str>,
    origin_site_key: &str,
    keyword_key: &str,
    payload_json: &str,
    now_ms: i64,
    ttl_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let origin_site_key = origin_site_key.trim();
    let keyword_key = keyword_key.trim();
    if source_key.is_empty()
        || origin_site_key.is_empty()
        || keyword_key.is_empty()
        || payload_json.trim().is_empty()
    {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_dispatch_cache (
            source_key, repo_url, origin_site_key, keyword_key, payload_json, updated_at, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(source_key, repo_url, origin_site_key, keyword_key) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            origin_site_key,
            keyword_key,
            payload_json,
            now_ms,
            now_ms + ttl_ms.max(1)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_vod_dispatch_backend_stats(
    source_key: &str,
    repo_url: Option<&str>,
    origin_site_key: &str,
    limit: i64,
) -> Result<Vec<VodDispatchBackendStatRecord>, String> {
    let source_key = source_key.trim();
    let origin_site_key = origin_site_key.trim();
    if source_key.is_empty() || origin_site_key.is_empty() {
        return Ok(Vec::new());
    }

    let conn = open_connection()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                target_site_key,
                success_count,
                failure_count,
                last_status,
                last_failure_kind,
                last_used_at,
                consecutive_hard_failures,
                consecutive_upstream_failures,
                quarantine_until
            FROM vod_dispatch_backend_stats
            WHERE source_key = ?1 AND repo_url = ?2 AND origin_site_key = ?3
            ORDER BY quarantine_until ASC, success_count DESC, last_used_at DESC, target_site_key ASC
            LIMIT ?4
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(
            params![
                source_key,
                normalize_repo_url(repo_url),
                origin_site_key,
                limit.max(1).min(64)
            ],
            |row| {
                Ok(VodDispatchBackendStatRecord {
                    target_site_key: row.get(0)?,
                    success_count: row.get(1)?,
                    failure_count: row.get(2)?,
                    last_status: row.get(3)?,
                    last_failure_kind: row.get(4)?,
                    last_used_at: row.get(5)?,
                    consecutive_hard_failures: row.get(6)?,
                    consecutive_upstream_failures: row.get(7)?,
                    quarantine_until: row.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn record_vod_dispatch_backend_success(
    source_key: &str,
    repo_url: Option<&str>,
    origin_site_key: &str,
    target_site_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let origin_site_key = origin_site_key.trim();
    let target_site_key = target_site_key.trim();
    if source_key.is_empty() || origin_site_key.is_empty() || target_site_key.is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_dispatch_backend_stats (
            source_key,
            repo_url,
            origin_site_key,
            target_site_key,
            success_count,
            failure_count,
            last_status,
            last_failure_kind,
            last_used_at,
            consecutive_hard_failures,
            consecutive_upstream_failures,
            quarantine_until
        ) VALUES (?1, ?2, ?3, ?4, 1, 0, 'success', NULL, ?5, 0, 0, 0)
        ON CONFLICT(source_key, repo_url, origin_site_key, target_site_key) DO UPDATE SET
            success_count = vod_dispatch_backend_stats.success_count + 1,
            last_status = 'success',
            last_failure_kind = NULL,
            last_used_at = excluded.last_used_at,
            consecutive_hard_failures = 0,
            consecutive_upstream_failures = 0,
            quarantine_until = 0
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            origin_site_key,
            target_site_key,
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn record_vod_dispatch_backend_failure(
    source_key: &str,
    repo_url: Option<&str>,
    origin_site_key: &str,
    target_site_key: &str,
    last_status: &str,
    last_failure_kind: Option<&str>,
    hard_failure: bool,
    upstream_failure: bool,
    quarantine_until_ms: i64,
    now_ms: i64,
) -> Result<(), String> {
    let source_key = source_key.trim();
    let origin_site_key = origin_site_key.trim();
    let target_site_key = target_site_key.trim();
    let last_status = last_status.trim();
    if source_key.is_empty() || origin_site_key.is_empty() || target_site_key.is_empty() {
        return Ok(());
    }

    let conn = open_connection()?;
    conn.execute(
        r#"
        INSERT INTO vod_dispatch_backend_stats (
            source_key,
            repo_url,
            origin_site_key,
            target_site_key,
            success_count,
            failure_count,
            last_status,
            last_failure_kind,
            last_used_at,
            consecutive_hard_failures,
            consecutive_upstream_failures,
            quarantine_until
        ) VALUES (
            ?1,
            ?2,
            ?3,
            ?4,
            0,
            1,
            ?5,
            ?6,
            ?7,
            CASE WHEN ?8 THEN 1 ELSE 0 END,
            CASE WHEN ?9 THEN 1 ELSE 0 END,
            ?10
        )
        ON CONFLICT(source_key, repo_url, origin_site_key, target_site_key) DO UPDATE SET
            failure_count = vod_dispatch_backend_stats.failure_count + 1,
            last_status = excluded.last_status,
            last_failure_kind = excluded.last_failure_kind,
            last_used_at = excluded.last_used_at,
            consecutive_hard_failures = CASE
                WHEN ?8 THEN vod_dispatch_backend_stats.consecutive_hard_failures + 1
                ELSE 0
            END,
            consecutive_upstream_failures = CASE
                WHEN ?9 THEN vod_dispatch_backend_stats.consecutive_upstream_failures + 1
                ELSE 0
            END,
            quarantine_until = CASE
                WHEN excluded.quarantine_until > vod_dispatch_backend_stats.quarantine_until
                    THEN excluded.quarantine_until
                ELSE vod_dispatch_backend_stats.quarantine_until
            END
        "#,
        params![
            source_key,
            normalize_repo_url(repo_url),
            origin_site_key,
            target_site_key,
            if last_status.is_empty() {
                "failed"
            } else {
                last_status
            },
            last_failure_kind,
            now_ms,
            hard_failure,
            upstream_failure,
            quarantine_until_ms.max(0)
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
