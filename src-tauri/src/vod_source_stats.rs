use rusqlite::{params, Connection};
use std::path::PathBuf;

const VOD_DB_FILE: &str = "halo_vod.db";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct VodSiteRankingRecord {
    pub site_key: String,
    pub success_count: i64,
    pub last_success_at: i64,
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
