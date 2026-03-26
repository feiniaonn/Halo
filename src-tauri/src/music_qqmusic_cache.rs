use base64::Engine;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};

const QQMUSIC_COVER_RETRY_COOLDOWN_MS: i64 = 10_000;
const QQMUSIC_COVER_MATCH_WINDOW_MS: i128 = 20_000;
const QQMUSIC_COVER_CACHE_MAX: usize = 48;

pub fn find_cover_data_url(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
) -> Option<String> {
    let key = cache_key(artist, title, expected_duration_secs)?;

    if let Ok(cache) = positive_cover_cache().lock() {
        if let Some(value) = cache.get(&key) {
            return Some(value.clone());
        }
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    if let Ok(cache) = negative_probe_cache().lock() {
        if let Some(last_probe_at_ms) = cache.get(&key) {
            if now_ms.saturating_sub(*last_probe_at_ms) < QQMUSIC_COVER_RETRY_COOLDOWN_MS {
                return None;
            }
        }
    }

    let found = find_cover_data_url_uncached(artist, title, expected_duration_secs);
    if let Some(value) = found.clone() {
        if let Ok(mut cache) = positive_cover_cache().lock() {
            if cache.len() >= QQMUSIC_COVER_CACHE_MAX {
                cache.clear();
            }
            cache.insert(key.clone(), value);
        }
        if let Ok(mut cache) = negative_probe_cache().lock() {
            cache.remove(&key);
        }
    } else if let Ok(mut cache) = negative_probe_cache().lock() {
        if cache.len() >= QQMUSIC_COVER_CACHE_MAX {
            cache.clear();
        }
        cache.insert(key, now_ms);
    }

    found
}

fn find_cover_data_url_uncached(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
) -> Option<String> {
    let anchor_modified =
        find_best_matching_lyric_modified_at(artist, title, expected_duration_secs)?;
    let picture = find_nearest_picture(anchor_modified)?;
    image_file_to_data_url(&picture)
}

fn find_best_matching_lyric_modified_at(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
) -> Option<SystemTime> {
    let mut best: Option<(f64, SystemTime)> = None;

    for directory in qqmusic_lyric_cache_dirs() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let Some((cache_artist, cache_title, duration_secs)) =
                parse_primary_lyric_cache_file_name(&path)
            else {
                continue;
            };

            if !crate::music_lyrics::scoring::is_confident_candidate_match(
                artist,
                title,
                expected_duration_secs,
                &cache_artist,
                &cache_title,
                duration_secs.map(|value| value.saturating_mul(1000)),
            ) {
                continue;
            }

            let modified_at = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let score = crate::music_lyrics::scoring::score_candidate(
                artist,
                title,
                expected_duration_secs,
                &cache_artist,
                &cache_title,
                duration_secs.map(|value| value.saturating_mul(1000)),
            );

            match &best {
                Some((best_score, best_modified)) => {
                    if score > *best_score || (score == *best_score && modified_at > *best_modified)
                    {
                        best = Some((score, modified_at));
                    }
                }
                None => best = Some((score, modified_at)),
            }
        }
    }

    best.map(|(_, modified_at)| modified_at)
}

fn find_nearest_picture(anchor_modified: SystemTime) -> Option<PathBuf> {
    let mut best: Option<(i128, bool, PathBuf)> = None;

    for directory in qqmusic_picture_cache_dirs() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !is_supported_image(&path) {
                continue;
            }

            let modified_at = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            let delta_ms = system_time_delta_ms(modified_at, anchor_modified);
            if delta_ms > QQMUSIC_COVER_MATCH_WINDOW_MS {
                continue;
            }

            let is_large_cover = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.contains("R500x500"))
                .unwrap_or(false);

            match &best {
                Some((best_delta_ms, best_large_cover, _)) => {
                    if delta_ms < *best_delta_ms
                        || (delta_ms == *best_delta_ms && is_large_cover && !*best_large_cover)
                    {
                        best = Some((delta_ms, is_large_cover, path));
                    }
                }
                None => best = Some((delta_ms, is_large_cover, path)),
            }
        }
    }

    best.map(|(_, _, path)| path)
}

fn image_file_to_data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    let mime = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("jpg") | Some("jpeg") | None => "image/jpeg",
        _ => "application/octet-stream",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

fn qqmusic_lyric_cache_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from(r"F:\TempCache\QQMusicCache\QQMusicLyricNew")];

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(
            PathBuf::from(&local_app_data)
                .join("Tencent")
                .join("QQMusic")
                .join("QQMusicLyricNew"),
        );
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        dirs.push(
            PathBuf::from(&app_data)
                .join("Tencent")
                .join("QQMusic")
                .join("QQMusicLyricNew"),
        );
    }

    dirs.into_iter().filter(|path| path.exists()).collect()
}

fn qqmusic_picture_cache_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![PathBuf::from(r"F:\TempCache\QQMusicCache\QQMusicPicture")];

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        dirs.push(
            PathBuf::from(&local_app_data)
                .join("Tencent")
                .join("QQMusic")
                .join("QQMusicPicture"),
        );
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        dirs.push(
            PathBuf::from(&app_data)
                .join("Tencent")
                .join("QQMusic")
                .join("QQMusicPicture"),
        );
    }

    dirs.into_iter().filter(|path| path.exists()).collect()
}

fn parse_primary_lyric_cache_file_name(path: &Path) -> Option<(String, String, Option<u64>)> {
    let file_name = path.file_name()?.to_string_lossy();
    let stem = file_name.strip_suffix("_qm.qrc")?;
    let parts: Vec<&str> = stem.split(" - ").collect();
    if parts.len() < 4 {
        return None;
    }

    let artist = cleanup_cache_label(parts.first()?.trim());
    let duration_secs = parts
        .get(parts.len().saturating_sub(2))?
        .trim()
        .parse::<u64>()
        .ok();
    let title = cleanup_cache_label(&parts[1..parts.len() - 2].join(" - "));
    if artist.is_empty() || title.is_empty() {
        return None;
    }
    Some((artist, title, duration_secs))
}

fn cleanup_cache_label(value: &str) -> String {
    value
        .replace('_', "/")
        .replace('\u{3000}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn normalize_cache_text(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace('_', " ")
        .replace('/', " ")
}

fn cache_key(artist: &str, title: &str, duration_secs: Option<u64>) -> Option<String> {
    let artist_key = normalize_cache_text(artist);
    let title_key = normalize_cache_text(title);
    if artist_key.is_empty() || title_key.is_empty() {
        return None;
    }
    Some(format!(
        "{artist_key}::{title_key}::{}",
        duration_secs.unwrap_or_default()
    ))
}

fn is_supported_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("jpg") | Some("jpeg") | Some("png") | Some("webp")
    )
}

fn system_time_delta_ms(lhs: SystemTime, rhs: SystemTime) -> i128 {
    let lhs_ms = lhs
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i128;
    let rhs_ms = rhs
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i128;
    (lhs_ms - rhs_ms).abs()
}

fn positive_cover_cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn negative_probe_cache() -> &'static Mutex<HashMap<String, i64>> {
    static CACHE: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
mod tests {
    use super::{cache_key, parse_primary_lyric_cache_file_name};
    use std::path::Path;

    #[test]
    fn parses_primary_qm_cache_file_name() {
        let parsed = parse_primary_lyric_cache_file_name(Path::new(
            r"F:\TempCache\QQMusicCache\QQMusicLyricNew\一只白羊 - 我不怕 - 179 - 我不怕_qm.qrc",
        ))
        .expect("should parse qqmusic lyric cache name");

        assert_eq!(parsed.0, "一只白羊");
        assert_eq!(parsed.1, "我不怕");
        assert_eq!(parsed.2, Some(179));
    }

    #[test]
    fn builds_cover_cache_key() {
        let key = cache_key("一只白羊", "我不怕", Some(179)).expect("should build cache key");
        assert_eq!(key, "一只白羊::我不怕::179");
    }
}
