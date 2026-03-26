use crate::music_lyrics::types::ProviderLyricsCandidate;
use base64::{engine::general_purpose::STANDARD, Engine};

fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) HaloLyrics/1.0")
        .build()
        .ok()
}

fn normalize_lyric(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.contains('[') && trimmed.contains(':') {
        return Some(trimmed.to_string());
    }

    if let Ok(bytes) = STANDARD.decode(trimmed) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            let decoded = decoded.trim();
            if !decoded.is_empty() && decoded.contains('[') {
                return Some(decoded.to_string());
            }
        }
    }
    None
}

fn candidate_artist(value: &serde_json::Value) -> String {
    let singers = value
        .get("singer")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("name").and_then(|v| v.as_str()).map(str::trim))
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if singers.is_empty() {
        String::new()
    } else {
        singers.join("/")
    }
}

async fn search(client: &reqwest::Client, keyword: &str) -> Vec<serde_json::Value> {
    if keyword.trim().is_empty() {
        return Vec::new();
    }

    let resp = match client
        .get("https://c.y.qq.com/soso/fcgi-bin/client_search_cp")
        .header("Referer", "https://y.qq.com/")
        .header("Origin", "https://y.qq.com")
        .query(&[
            ("p", "1"),
            ("n", "8"),
            ("w", keyword.trim()),
            ("format", "json"),
        ])
        .send()
        .await
    {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    if !resp.status().is_success() {
        return Vec::new();
    }

    let payload = match resp.json::<serde_json::Value>().await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    payload
        .pointer("/data/song/list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

async fn fetch_single_lyric(
    client: &reqwest::Client,
    songmid: &str,
) -> Option<(String, Option<String>)> {
    let resp = client
        .get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")
        .header("Referer", "https://y.qq.com/")
        .header("Origin", "https://y.qq.com")
        .query(&[("songmid", songmid), ("format", "json"), ("nobase64", "1")])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let payload = resp.json::<serde_json::Value>().await.ok()?;
    let primary_raw = payload.get("lyric").and_then(|v| v.as_str()).unwrap_or("");
    let primary_lrc = normalize_lyric(primary_raw)?;
    let trans_lrc = payload
        .get("trans")
        .and_then(|v| v.as_str())
        .and_then(normalize_lyric);

    Some((primary_lrc, trans_lrc))
}

pub async fn fetch(artist: &str, title: &str) -> Vec<ProviderLyricsCandidate> {
    let Some(client) = build_client() else {
        return Vec::new();
    };

    let keyword_primary = format!("{artist} {title}");
    let mut songs = search(&client, &keyword_primary).await;
    if songs.is_empty() {
        songs = search(&client, title).await;
    }
    if songs.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    for song in songs.into_iter().take(3) {
        let songmid = song
            .get("songmid")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty());
        let Some(songmid) = songmid else {
            continue;
        };

        let song_title = song
            .get("songname")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(title)
            .to_string();
        let song_artist = {
            let value = candidate_artist(&song);
            if value.trim().is_empty() {
                artist.to_string()
            } else {
                value
            }
        };
        let duration_ms = song
            .get("interval")
            .and_then(|v| v.as_u64())
            .filter(|v| *v > 0)
            .map(|v| v.saturating_mul(1000));

        let Some((primary_lrc, translation_lrc)) = fetch_single_lyric(&client, songmid).await
        else {
            continue;
        };

        out.push(ProviderLyricsCandidate {
            id: format!("qqmusic_api:{songmid}:legacy"),
            provider: "qqmusic_api".to_string(),
            title: song_title,
            artist: song_artist,
            duration_ms,
            primary_lrc: primary_lrc.clone(),
            translation_lrc,
            romanized_lrc: None,
            plain_text: Some(primary_lrc),
            word_timed_primary: None,
        });
    }

    out
}
