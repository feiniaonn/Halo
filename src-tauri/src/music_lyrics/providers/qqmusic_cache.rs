use super::qqmusic_qrc::decrypt_local_qrc;
use crate::music_lyrics::{
    parser, scoring,
    types::{ProviderLyricsCandidate, ProviderTimedLine, ProviderTimedWord},
};
use regex::Regex;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

struct CacheBucket {
    artist: String,
    title: String,
    album: String,
    duration_secs: Option<u64>,
    modified_at: SystemTime,
    primary_path: Option<PathBuf>,
    translation_path: Option<PathBuf>,
    romanized_path: Option<PathBuf>,
}

impl Default for CacheBucket {
    fn default() -> Self {
        Self {
            artist: String::new(),
            title: String::new(),
            album: String::new(),
            duration_secs: None,
            modified_at: SystemTime::UNIX_EPOCH,
            primary_path: None,
            translation_path: None,
            romanized_path: None,
        }
    }
}

pub fn fetch(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
) -> Vec<ProviderLyricsCandidate> {
    let mut grouped: BTreeMap<String, CacheBucket> = BTreeMap::new();

    for directory in qqmusic_cache_dirs() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some((cache_artist, cache_title, duration_secs, album, kind)) =
                parse_cache_file_name(&path)
            else {
                continue;
            };
            if !scoring::is_confident_candidate_match(
                artist,
                title,
                expected_duration_secs,
                &cache_artist,
                &cache_title,
                duration_secs.map(|value| value.saturating_mul(1000)),
            ) {
                continue;
            }

            let key = format!(
                "{}::{}::{}",
                normalize_cache_text(&cache_artist),
                normalize_cache_text(&cache_title),
                duration_secs.unwrap_or_default(),
            );
            let modified_at = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            let bucket = grouped.entry(key).or_default();
            bucket.artist = cache_artist;
            bucket.title = cache_title;
            bucket.album = album;
            bucket.duration_secs = duration_secs;
            if modified_at >= bucket.modified_at {
                bucket.modified_at = modified_at;
            }

            match kind {
                CacheLyricKind::Primary => bucket.primary_path = Some(path),
                CacheLyricKind::Translation => bucket.translation_path = Some(path),
                CacheLyricKind::Romanized => bucket.romanized_path = Some(path),
            }
        }
    }

    let mut out = Vec::new();
    for bucket in grouped.into_values() {
        let Some(primary_path) = bucket.primary_path.as_ref() else {
            continue;
        };
        let Some(primary_raw) = read_qrc_text(primary_path) else {
            continue;
        };
        let Some(primary_lrc) = normalize_qrc_text(&primary_raw) else {
            continue;
        };
        let word_timed_primary = {
            let parsed = parse_qrc_word_timed_lines(&primary_raw);
            (!parsed.is_empty()).then_some(parsed)
        };
        let translation_lrc = bucket
            .translation_path
            .as_ref()
            .and_then(|path| read_qrc_as_lrc(path));
        let romanized_lrc = bucket
            .romanized_path
            .as_ref()
            .and_then(|path| read_qrc_as_lrc(path));

        out.push(ProviderLyricsCandidate {
            id: format!(
                "qqmusic_cache:{}:{}",
                normalize_cache_text(&bucket.artist),
                normalize_cache_text(&bucket.title)
            ),
            provider: "qqmusic_cache".to_string(),
            title: bucket.title,
            artist: bucket.artist,
            duration_ms: bucket.duration_secs.map(|value| value.saturating_mul(1000)),
            primary_lrc: primary_lrc.clone(),
            translation_lrc,
            romanized_lrc,
            plain_text: Some(primary_lrc),
            word_timed_primary,
        });
    }

    out.sort_by(|a, b| {
        scoring::score_candidate(
            artist,
            title,
            expected_duration_secs,
            &b.artist,
            &b.title,
            b.duration_ms,
        )
        .partial_cmp(&scoring::score_candidate(
            artist,
            title,
            expected_duration_secs,
            &a.artist,
            &a.title,
            a.duration_ms,
        ))
        .unwrap_or(std::cmp::Ordering::Equal)
    });

    out
}

fn qqmusic_cache_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    dirs.push(PathBuf::from(r"F:\TempCache\QQMusicCache\QQMusicLyricNew"));

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

#[derive(Clone, Copy)]
enum CacheLyricKind {
    Primary,
    Translation,
    Romanized,
}

fn parse_cache_file_name(
    path: &Path,
) -> Option<(String, String, Option<u64>, String, CacheLyricKind)> {
    let file_name = path.file_name()?.to_string_lossy();
    let (kind, stem) = if let Some(value) = file_name.strip_suffix("_qm.qrc") {
        (CacheLyricKind::Primary, value)
    } else if let Some(value) = file_name.strip_suffix("_qmts.qrc") {
        (CacheLyricKind::Translation, value)
    } else if let Some(value) = file_name.strip_suffix("_qmRoma.qrc") {
        (CacheLyricKind::Romanized, value)
    } else {
        return None;
    };

    let parts: Vec<&str> = stem.split(" - ").collect();
    if parts.len() < 4 {
        return None;
    }

    let artist = cleanup_cache_label(parts.first()?.trim());
    let album = cleanup_cache_label(parts.last()?.trim());
    let duration_secs = parts
        .get(parts.len().saturating_sub(2))?
        .trim()
        .parse::<u64>()
        .ok();
    let title = cleanup_cache_label(&parts[1..parts.len() - 2].join(" - "));

    if artist.is_empty() || title.is_empty() {
        return None;
    }

    Some((artist, title, duration_secs, album, kind))
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

fn read_qrc_as_lrc(path: &Path) -> Option<String> {
    let decrypted = read_qrc_text(path)?;
    normalize_qrc_text(&decrypted)
}

fn read_qrc_text(path: &Path) -> Option<String> {
    let encrypted = fs::read(path).ok()?;
    decrypt_local_qrc(&encrypted).ok()
}

fn normalize_qrc_text(input: &str) -> Option<String> {
    let raw = extract_qrc_payload(input);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lrc_timestamp_re = Regex::new(r"\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]").ok()?;
    if lrc_timestamp_re.is_match(trimmed) {
        return canonicalize_lrc_text(trimmed);
    }

    let line_re = Regex::new(r"^\[(\d+),(\d+)\](.*)$").ok()?;
    let timing_re = Regex::new(r"\(\d+,\d+\)").ok()?;
    let mut output = String::new();

    for raw_line in trimmed.lines() {
        let line = raw_line.trim();
        let Some(caps) = line_re.captures(line) else {
            continue;
        };
        let start_ms = caps.get(1)?.as_str().parse::<u64>().ok()?;
        let text = timing_re.replace_all(caps.get(3)?.as_str(), "");
        let text = decode_qrc_entities(text.trim());
        if text.is_empty() {
            continue;
        }

        output.push('[');
        output.push_str(&format_lrc_timestamp(start_ms));
        output.push(']');
        output.push_str(&text);
        output.push('\n');
    }

    if output.trim().is_empty() {
        None
    } else {
        Some(output)
    }
}

fn canonicalize_lrc_text(input: &str) -> Option<String> {
    let parsed = parser::parse_lrc(input);
    if parsed.is_empty() {
        return None;
    }

    let mut output = String::new();
    for (start_ms, text) in parsed {
        output.push('[');
        output.push_str(&format_lrc_timestamp(start_ms));
        output.push(']');
        output.push_str(&text);
        output.push('\n');
    }

    Some(output)
}

fn parse_qrc_word_timed_lines(input: &str) -> Vec<ProviderTimedLine> {
    let raw = extract_qrc_payload(input);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let Ok(line_re) = Regex::new(r"^\[(\d+),(\d+)\](.*)$") else {
        return Vec::new();
    };
    let Ok(word_re) = Regex::new(r"([^()]*?)\((\d+),(\d+)\)") else {
        return Vec::new();
    };

    let mut lines = Vec::new();
    for raw_line in trimmed.lines() {
        let line = raw_line.trim();
        let Some(caps) = line_re.captures(line) else {
            continue;
        };
        let start_ms = caps
            .get(1)
            .and_then(|value| value.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        let _duration_ms = caps
            .get(2)
            .and_then(|value| value.as_str().parse::<u64>().ok())
            .unwrap_or(0);
        let Some(content) = caps.get(3).map(|value| value.as_str()) else {
            continue;
        };

        let mut words = Vec::new();
        for word_caps in word_re.captures_iter(content) {
            let text = decode_qrc_entities(
                word_caps
                    .get(1)
                    .map(|value| value.as_str())
                    .unwrap_or_default(),
            );
            if text.is_empty() {
                continue;
            }
            let word_start_ms = word_caps
                .get(2)
                .and_then(|value| value.as_str().parse::<u64>().ok())
                .unwrap_or(start_ms);
            let word_duration_ms = word_caps
                .get(3)
                .and_then(|value| value.as_str().parse::<u64>().ok())
                .unwrap_or(0);
            words.push(ProviderTimedWord {
                start_ms: word_start_ms,
                end_ms: word_start_ms.saturating_add(word_duration_ms.max(1)),
                text,
            });
        }

        if words.is_empty() {
            continue;
        }

        lines.push(ProviderTimedLine { start_ms, words });
    }

    lines
}

fn extract_qrc_payload(input: &str) -> String {
    let trimmed = input.trim();
    if !trimmed.starts_with("<?xml") {
        return trimmed.to_string();
    }

    let Ok(content_re) = Regex::new(r#"LyricContent="(.*?)"\s*/>"#) else {
        return trimmed.to_string();
    };
    let Some(caps) = content_re.captures(trimmed) else {
        return trimmed.to_string();
    };

    decode_qrc_entities(caps.get(1).map(|m| m.as_str()).unwrap_or_default())
}

fn decode_qrc_entities(input: &str) -> String {
    input
        .replace("&#10;", "\n")
        .replace("&#13;", "")
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn format_lrc_timestamp(ms: u64) -> String {
    let rounded = ((ms + 5) / 10) * 10;
    let minutes = rounded / 60_000;
    let seconds = (rounded / 1000) % 60;
    let centis = (rounded % 1000) / 10;
    format!("{minutes:02}:{seconds:02}.{centis:02}")
}

#[cfg(test)]
mod tests {
    use super::{decrypt_local_qrc, fetch, normalize_qrc_text, parse_cache_file_name};
    use std::{fs, path::Path};

    #[test]
    fn parses_qm_cache_file_name() {
        let parsed = parse_cache_file_name(Path::new(
            r"F:\TempCache\QQMusicCache\QQMusicLyricNew\一只白羊 - 我不怕 - 179 - 我不怕_qm.qrc",
        ))
        .expect("should parse qqmusic cache name");

        assert_eq!(parsed.0, "一只白羊");
        assert_eq!(parsed.1, "我不怕");
        assert_eq!(parsed.2, Some(179));
    }

    #[test]
    fn converts_qrc_line_tags_to_lrc() {
        let lrc = normalize_qrc_text(
            "[0,2000]Tell(0,500) me(500,500)\n[2100,1200]Hello(2100,300) world(2400,300)",
        )
        .expect("should convert qrc to lrc");

        assert!(lrc.contains("[00:00.00]Tell me"));
        assert!(lrc.contains("[00:02.10]Hello world"));
    }

    #[test]
    fn converts_xml_qrc_with_offset_header_to_lrc() {
        let lrc = normalize_qrc_text(
            r#"<?xml version="1.0" encoding="utf-8"?><QrcInfos><LyricInfo LyricContent="[offset:0]&#10;[0,1200]Stay(0,300) With(300,300) Me(600,300)&#10;[1500,1000]Hello(0,300)" /></QrcInfos>"#,
        )
        .expect("should convert xml-wrapped qrc to lrc");

        assert!(lrc.contains("[00:00.00]Stay With Me"));
        assert!(lrc.contains("[00:01.50]Hello"));
        assert!(!lrc.contains("[offset:0]"));
    }

    #[test]
    fn dumps_actual_qm_cache_parse_for_manual_review() {
        let input = Path::new(
            r"F:\TempCache\QQMusicCache\QQMusicLyricNew\一只白羊 - 我不怕 - 179 - 我不怕_qm.qrc",
        );
        if !input.exists() {
            return;
        }

        let encrypted = fs::read(input).expect("should read qqmusic qrc");
        let decrypted = decrypt_local_qrc(&encrypted).expect("should decrypt qqmusic qrc");
        let parsed = normalize_qrc_text(&decrypted).unwrap_or_default();

        let output_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("manual")
            .join("qqmusic_lyrics_debug");
        fs::create_dir_all(&output_dir).expect("should create debug output dir");
        fs::write(output_dir.join("一只白羊-我不怕.raw.txt"), &decrypted)
            .expect("should write raw lyric payload");
        fs::write(output_dir.join("一只白羊-我不怕.parsed.lrc"), &parsed)
            .expect("should write parsed lyric payload");

        assert!(
            !parsed.trim().is_empty(),
            "parsed lyric payload should not be empty"
        );
    }

    #[test]
    fn fetches_a_million_years_from_local_cache_when_available() {
        let input = Path::new(
            r"F:\TempCache\QQMusicCache\QQMusicLyricNew\Mariette - A Million Years - 185 - A Million Years_qm.qrc",
        );
        if !input.exists() {
            return;
        }

        let candidates = fetch("Mariette", "A Million Years", Some(185));
        let selected = candidates
            .iter()
            .find(|candidate| candidate.provider == "qqmusic_cache")
            .expect("should read qqmusic local cache for current song");

        assert_eq!(selected.title, "A Million Years");
        assert_eq!(selected.artist, "Mariette");
        assert!(
            !selected.primary_lrc.trim().is_empty(),
            "primary local lyric payload should not be empty"
        );
        assert!(
            selected
                .word_timed_primary
                .as_ref()
                .map(|lines| !lines.is_empty() && lines.iter().any(|line| !line.words.is_empty()))
                .unwrap_or(false),
            "qqmusic local cache should preserve word-timed segments"
        );
    }

    #[test]
    fn dumps_a_million_years_cache_parse_for_manual_review() {
        let output_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("tests")
            .join("manual")
            .join("qqmusic_lyrics_debug");
        fs::create_dir_all(&output_dir).expect("should create debug output dir");

        let cases = [
            (
                r"F:\TempCache\QQMusicCache\QQMusicLyricNew\Mariette - A Million Years - 185 - A Million Years_qm.qrc",
                "Mariette-A Million Years.primary.raw.txt",
                "Mariette-A Million Years.primary.parsed.lrc",
            ),
            (
                r"F:\TempCache\QQMusicCache\QQMusicLyricNew\Mariette - A Million Years - 185 - A Million Years_qmts.qrc",
                "Mariette-A Million Years.translation.raw.txt",
                "Mariette-A Million Years.translation.parsed.lrc",
            ),
        ];

        for (input_path, raw_name, parsed_name) in cases {
            let input = Path::new(input_path);
            if !input.exists() {
                continue;
            }

            let encrypted = fs::read(input).expect("should read qqmusic qrc");
            let decrypted = decrypt_local_qrc(&encrypted).expect("should decrypt qqmusic qrc");
            let parsed = normalize_qrc_text(&decrypted).unwrap_or_default();

            fs::write(output_dir.join(raw_name), &decrypted)
                .expect("should write raw lyric payload");
            fs::write(output_dir.join(parsed_name), &parsed)
                .expect("should write parsed lyric payload");
        }
    }
}
