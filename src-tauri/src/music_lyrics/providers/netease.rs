use crate::music_lyrics::types::ProviderLyricsCandidate;

fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) HaloLyrics/1.0")
        .build()
        .ok()
}

fn normalize_lrc(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.contains('[') {
        return None;
    }
    Some(trimmed.to_string())
}

fn joined_artists(song: &serde_json::Value) -> String {
    let list = song
        .get("artists")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("name").and_then(|v| v.as_str()).map(str::trim))
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if list.is_empty() {
        String::new()
    } else {
        list.join("/")
    }
}

async fn search(client: &reqwest::Client, keyword: &str) -> Vec<serde_json::Value> {
    if keyword.trim().is_empty() {
        return Vec::new();
    }

    let resp = match client
        .get("https://music.163.com/api/search/get/web")
        .header("Referer", "https://music.163.com/")
        .query(&[
            ("type", "1"),
            ("s", keyword.trim()),
            ("limit", "8"),
            ("offset", "0"),
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
        .pointer("/result/songs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

async fn fetch_single_lyric(
    client: &reqwest::Client,
    song_id: u64,
) -> Option<(String, Option<String>, Option<String>)> {
    let resp = client
        .get("https://music.163.com/api/song/lyric")
        .header("Referer", "https://music.163.com/")
        .query(&[
            ("os", "pc"),
            ("id", &song_id.to_string()),
            ("lv", "-1"),
            ("kv", "-1"),
            ("tv", "-1"),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let payload = resp.json::<serde_json::Value>().await.ok()?;
    let yrc = payload
        .pointer("/yrc/lyric")
        .and_then(|v| v.as_str())
        .and_then(normalize_lrc);
    let lrc = payload
        .pointer("/lrc/lyric")
        .and_then(|v| v.as_str())
        .and_then(normalize_lrc);
    let primary = yrc.or(lrc)?;
    let translation = payload
        .pointer("/tlyric/lyric")
        .and_then(|v| v.as_str())
        .and_then(normalize_lrc);
    let romanized = payload
        .pointer("/romalrc/lyric")
        .and_then(|v| v.as_str())
        .and_then(normalize_lrc);

    Some((primary, translation, romanized))
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
        let song_id = song.get("id").and_then(|v| v.as_u64());
        let Some(song_id) = song_id else {
            continue;
        };

        let song_title = song
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .unwrap_or(title)
            .to_string();
        let song_artist = {
            let joined = joined_artists(&song);
            if joined.trim().is_empty() {
                artist.to_string()
            } else {
                joined
            }
        };
        let duration_ms = song.get("duration").and_then(|v| v.as_u64());

        let Some((primary_lrc, translation_lrc, romanized_lrc)) =
            fetch_single_lyric(&client, song_id).await
        else {
            continue;
        };

        out.push(ProviderLyricsCandidate {
            id: format!("netease_api:{song_id}:lrc"),
            provider: "netease_api".to_string(),
            title: song_title,
            artist: song_artist,
            duration_ms,
            primary_lrc: primary_lrc.clone(),
            translation_lrc,
            romanized_lrc,
            plain_text: Some(primary_lrc),
            word_timed_primary: None,
        });
    }

    out
}
