use crate::music_lyrics::types::ProviderLyricsCandidate;

fn string_or_default(value: Option<&str>, fallback: &str) -> String {
    value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

pub async fn fetch(artist: &str, title: &str) -> Vec<ProviderLyricsCandidate> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .user_agent("halo-desktop/lyrics")
        .build()
    {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let resp = match client
        .get("https://lrclib.net/api/get")
        .query(&[("artist_name", artist), ("track_name", title)])
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

    let synced = payload
        .get("syncedLyrics")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let plain = payload
        .get("plainLyrics")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);

    let primary = synced
        .clone()
        .or_else(|| plain.clone())
        .unwrap_or_default()
        .trim()
        .to_string();
    if primary.is_empty() {
        return Vec::new();
    }

    let id_hash = format!(
        "{:x}",
        md5::compute(format!("{artist}::{title}::{primary}"))
    );
    let duration_ms = payload
        .get("duration")
        .and_then(|v| v.as_f64())
        .map(|secs| (secs * 1000.0).round() as u64)
        .filter(|v| *v > 0);

    let candidate = ProviderLyricsCandidate {
        id: format!("lrclib:{id_hash}:synced"),
        provider: "lrclib".to_string(),
        title: string_or_default(payload.get("trackName").and_then(|v| v.as_str()), title),
        artist: string_or_default(payload.get("artistName").and_then(|v| v.as_str()), artist),
        duration_ms,
        primary_lrc: primary.clone(),
        translation_lrc: None,
        romanized_lrc: None,
        plain_text: Some(plain.unwrap_or(primary)),
        word_timed_primary: None,
    };

    vec![candidate]
}
