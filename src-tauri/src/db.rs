use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;

const MUSIC_DB_FILE: &str = "halo_music.db";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct PlayRecord {
    pub artist: String,
    pub title: String,
    pub cover_path: Option<String>,
    pub play_count: i64,
    pub last_played: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct LyricsCacheRecord {
    pub song_key: String,
    pub candidate_key: String,
    pub provider: String,
    pub candidate_id: String,
    pub payload_json: String,
    pub updated_at: i64,
    pub expires_at: i64,
}

fn db_path() -> PathBuf {
    crate::settings::get_music_data_dir().join(MUSIC_DB_FILE)
}

fn open_connection() -> Result<Connection, String> {
    let path = db_path();
    crate::settings::ensure_parent(&path)?;

    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS music_plays (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            cover_path TEXT,
            source_app_id TEXT,
            source_platform TEXT,
            play_count INTEGER NOT NULL DEFAULT 1,
            first_played INTEGER NOT NULL,
            last_played INTEGER NOT NULL,
            UNIQUE(artist, title)
        );

        CREATE INDEX IF NOT EXISTS idx_music_plays_count
            ON music_plays(play_count DESC);

        CREATE TABLE IF NOT EXISTS music_daily_stats (
            date_key TEXT NOT NULL,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            cover_path TEXT,
            play_count INTEGER NOT NULL DEFAULT 0,
            play_secs INTEGER NOT NULL DEFAULT 0,
            last_played INTEGER NOT NULL,
            PRIMARY KEY(date_key, artist, title)
        );

        CREATE INDEX IF NOT EXISTS idx_music_daily_stats_date_count
            ON music_daily_stats(date_key, play_count DESC, play_secs DESC, last_played DESC);

        CREATE TABLE IF NOT EXISTS music_maintenance_flags (
            flag_key TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS music_lyrics_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_key TEXT NOT NULL,
            candidate_key TEXT NOT NULL,
            artist TEXT NOT NULL,
            title TEXT NOT NULL,
            source_platform TEXT,
            provider TEXT NOT NULL,
            candidate_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            last_accessed INTEGER NOT NULL,
            UNIQUE(song_key, candidate_key)
        );

        CREATE INDEX IF NOT EXISTS idx_music_lyrics_cache_song_access
            ON music_lyrics_cache(song_key, last_accessed DESC);
        CREATE INDEX IF NOT EXISTS idx_music_lyrics_cache_expire
            ON music_lyrics_cache(expires_at);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn millis_to_rfc3339(ms: i64) -> Option<String> {
    chrono::DateTime::from_timestamp_millis(ms).map(|v| v.to_rfc3339())
}

fn today_date_key(now_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(now_ms)
        .map(|v| v.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "1970-01-01".to_string())
}

pub fn record_play_event(
    artist: &str,
    title: &str,
    cover_path: Option<&str>,
    source_app_id: Option<&str>,
    source_platform: Option<&str>,
    now_ms: i64,
    play_secs_delta: i64,
) -> Result<(), String> {
    let artist = artist.trim();
    let title = title.trim();
    if artist.is_empty() || title.is_empty() {
        return Ok(());
    }

    let cover_path = cover_path
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let source_app_id = source_app_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let source_platform = source_platform
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);

    let mut conn = open_connection()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        r#"
        INSERT INTO music_plays (
            artist, title, cover_path, source_app_id, source_platform, play_count, first_played, last_played
        ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
        ON CONFLICT(artist, title) DO UPDATE SET
            play_count = music_plays.play_count + 1,
            last_played = excluded.last_played,
            cover_path = COALESCE(NULLIF(excluded.cover_path, ''), music_plays.cover_path),
            source_app_id = COALESCE(NULLIF(excluded.source_app_id, ''), music_plays.source_app_id),
            source_platform = COALESCE(NULLIF(excluded.source_platform, ''), music_plays.source_platform)
        "#,
        params![
            artist,
            title,
            cover_path.clone(),
            source_app_id,
            source_platform,
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;

    let date_key = today_date_key(now_ms);
    tx.execute(
        r#"
        INSERT INTO music_daily_stats (
            date_key, artist, title, cover_path, play_count, play_secs, last_played
        ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)
        ON CONFLICT(date_key, artist, title) DO UPDATE SET
            play_count = music_daily_stats.play_count + 1,
            play_secs = music_daily_stats.play_secs + excluded.play_secs,
            last_played = excluded.last_played,
            cover_path = COALESCE(NULLIF(excluded.cover_path, ''), music_daily_stats.cover_path)
        "#,
        params![
            date_key,
            artist,
            title,
            cover_path,
            play_secs_delta.max(0),
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())
}

pub fn query_play_history(limit: i64) -> Result<Vec<PlayRecord>, String> {
    let conn = open_connection()?;
    let lim = if limit <= 0 { 100 } else { limit.min(1000) };
    let mut stmt = conn
        .prepare(
            r#"
            SELECT artist, title, cover_path, play_count, last_played
            FROM music_plays
            ORDER BY play_count DESC, last_played DESC
            LIMIT ?1
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![lim], |row| {
            let last_played_ms: i64 = row.get(4)?;
            Ok(PlayRecord {
                artist: row.get(0)?,
                title: row.get(1)?,
                cover_path: row.get(2)?,
                play_count: row.get(3)?,
                last_played: millis_to_rfc3339(last_played_ms),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn query_today_top10(now_ms: i64) -> Result<Vec<PlayRecord>, String> {
    let conn = open_connection()?;
    let date_key = today_date_key(now_ms);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT artist, title, cover_path, play_count, last_played
            FROM music_daily_stats
            WHERE date_key = ?1
            ORDER BY play_count DESC, play_secs DESC, last_played DESC
            LIMIT 10
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![date_key], |row| {
            let last_played_ms: i64 = row.get(4)?;
            Ok(PlayRecord {
                artist: row.get(0)?,
                title: row.get(1)?,
                cover_path: row.get(2)?,
                play_count: row.get(3)?,
                last_played: millis_to_rfc3339(last_played_ms),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn query_today_summary(now_ms: i64) -> Result<(u64, Option<PlayRecord>), String> {
    let conn = open_connection()?;
    let date_key = today_date_key(now_ms);
    let total_play_events: u64 = conn
        .query_row(
            r#"
            SELECT COALESCE(SUM(play_count), 0)
            FROM music_daily_stats
            WHERE date_key = ?1
            "#,
            params![date_key.clone()],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value.max(0) as u64)
        .map_err(|e| e.to_string())?;

    let top_song = conn
        .query_row(
            r#"
            SELECT artist, title, cover_path, play_count, last_played
            FROM music_daily_stats
            WHERE date_key = ?1
            ORDER BY play_count DESC, play_secs DESC, last_played DESC
            LIMIT 1
            "#,
            params![date_key],
            |row| {
                let last_played_ms: i64 = row.get(4)?;
                Ok(PlayRecord {
                    artist: row.get(0)?,
                    title: row.get(1)?,
                    cover_path: row.get(2)?,
                    play_count: row.get(3)?,
                    last_played: millis_to_rfc3339(last_played_ms),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok((total_play_events, top_song))
}

pub fn repair_today_daily_stats_once(flag_key: &str, now_ms: i64) -> Result<bool, String> {
    let normalized_flag = flag_key.trim();
    if normalized_flag.is_empty() {
        return Err("repair flag key cannot be empty".to_string());
    }

    let mut conn = open_connection()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let already_applied = tx
        .query_row(
            r#"
            SELECT applied_at
            FROM music_maintenance_flags
            WHERE flag_key = ?1
            "#,
            params![normalized_flag],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();

    if already_applied {
        return Ok(false);
    }

    tx.execute(
        "DELETE FROM music_daily_stats WHERE date_key = ?1",
        params![today_date_key(now_ms)],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        r#"
        INSERT INTO music_maintenance_flags (flag_key, applied_at)
        VALUES (?1, ?2)
        "#,
        params![normalized_flag, now_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn load_lyrics_cache(song_key: &str, now_ms: i64) -> Result<Vec<LyricsCacheRecord>, String> {
    let conn = open_connection()?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT song_key, candidate_key, provider, candidate_id, payload_json, updated_at, expires_at
            FROM music_lyrics_cache
            WHERE song_key = ?1 AND expires_at > ?2
            ORDER BY last_accessed DESC, updated_at DESC
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![song_key, now_ms], |row| {
            Ok(LyricsCacheRecord {
                song_key: row.get(0)?,
                candidate_key: row.get(1)?,
                provider: row.get(2)?,
                candidate_id: row.get(3)?,
                payload_json: row.get(4)?,
                updated_at: row.get(5)?,
                expires_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn touch_lyrics_cache(song_key: &str, candidate_key: &str, now_ms: i64) -> Result<(), String> {
    let conn = open_connection()?;
    conn.execute(
        "UPDATE music_lyrics_cache SET last_accessed = ?3 WHERE song_key = ?1 AND candidate_key = ?2",
        params![song_key, candidate_key, now_ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_lyrics_cache(
    song_key: &str,
    candidate_key: &str,
    artist: &str,
    title: &str,
    source_platform: Option<&str>,
    provider: &str,
    candidate_id: &str,
    payload_json: &str,
    now_ms: i64,
    ttl_secs: i64,
) -> Result<(), String> {
    let conn = open_connection()?;
    let expires_at = now_ms.saturating_add(ttl_secs.max(60) * 1000);
    conn.execute(
        r#"
        INSERT INTO music_lyrics_cache (
            song_key, candidate_key, artist, title, source_platform, provider, candidate_id,
            payload_json, created_at, updated_at, expires_at, last_accessed
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?9)
        ON CONFLICT(song_key, candidate_key) DO UPDATE SET
            artist = excluded.artist,
            title = excluded.title,
            source_platform = excluded.source_platform,
            provider = excluded.provider,
            candidate_id = excluded.candidate_id,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at,
            last_accessed = excluded.last_accessed
        "#,
        params![
            song_key,
            candidate_key,
            artist,
            title,
            source_platform,
            provider,
            candidate_id,
            payload_json,
            now_ms,
            expires_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_lyrics_cache() -> Result<(), String> {
    let conn = open_connection()?;
    conn.execute("DELETE FROM music_lyrics_cache", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn prune_expired_lyrics_cache(now_ms: i64) -> Result<usize, String> {
    let conn = open_connection()?;
    conn.execute(
        "DELETE FROM music_lyrics_cache WHERE expires_at <= ?1",
        params![now_ms],
    )
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn has_music_rows() -> Result<bool, String> {
    let conn = open_connection()?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM music_plays", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(0);
    Ok(count > 0)
}
