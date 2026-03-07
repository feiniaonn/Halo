mod parser;
mod providers;
mod scoring;
mod types;

use types::ProviderLyricsCandidate;

const LYRICS_CACHE_TTL_SECS: i64 = 7 * 24 * 3600;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicLyricsRequest {
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub duration_secs: Option<u64>,
    pub candidate_id: Option<String>,
    pub source_app_id: Option<String>,
    pub source_platform: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicLyricsLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub translation: Option<String>,
    pub romanized: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicLyricsCandidate {
    pub id: String,
    pub label: String,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicLyricsResponse {
    pub ok: bool,
    pub found: bool,
    pub provider: Option<String>,
    pub from_cache: bool,
    pub reason_message: Option<String>,
    pub candidate_id: Option<String>,
    pub candidates: Vec<MusicLyricsCandidate>,
    pub lines: Vec<MusicLyricsLine>,
    pub plain_text: Option<String>,
}

fn normalize_song_key(artist: &str, title: &str) -> String {
    let a = artist.trim().to_ascii_lowercase();
    let t = title.trim().to_ascii_lowercase();
    format!("{a}::{t}")
}

fn merge_lyrics(
    primary_lrc: &str,
    translation_lrc: Option<&str>,
    romanized_lrc: Option<&str>,
) -> Vec<MusicLyricsLine> {
    let primary_parsed = parser::parse_lrc(primary_lrc);
    if primary_parsed.is_empty() {
        return Vec::new();
    }

    let trans_parsed = translation_lrc.map(parser::parse_lrc).unwrap_or_default();
    let roma_parsed = romanized_lrc.map(parser::parse_lrc).unwrap_or_default();

    let mut out = Vec::with_capacity(primary_parsed.len());
    for (idx, (start_ms, text)) in primary_parsed.iter().enumerate() {
        let next_start = primary_parsed
            .get(idx + 1)
            .map(|v| v.0)
            .unwrap_or(start_ms.saturating_add(3000));
        let end_ms = next_start.max(start_ms.saturating_add(300));

        let translation = trans_parsed
            .iter()
            .find(|(t, _)| *t == *start_ms)
            .map(|(_, s)| s.clone());
        let romanized = roma_parsed
            .iter()
            .find(|(t, _)| *t == *start_ms)
            .map(|(_, s)| s.clone());

        out.push(MusicLyricsLine {
            start_ms: *start_ms,
            end_ms,
            text: text.clone(),
            translation,
            romanized,
        });
    }
    out
}

fn has_bilingual_lines(lines: &[MusicLyricsLine]) -> bool {
    lines.iter().any(|line| {
        line.translation
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false)
    })
}

fn candidate_has_bilingual_content(candidate: &ProviderLyricsCandidate) -> bool {
    let Some(translation_lrc) = candidate.translation_lrc.as_deref() else {
        return false;
    };
    if translation_lrc.trim().is_empty() {
        return false;
    }

    let primary = parser::parse_lrc(&candidate.primary_lrc);
    if primary.is_empty() {
        return false;
    }

    let translated = parser::parse_lrc(translation_lrc);
    if translated.is_empty() {
        return false;
    }

    let translation_timestamps: std::collections::HashSet<u64> =
        translated.into_iter().map(|(ts, _)| ts).collect();

    primary
        .iter()
        .any(|(ts, _)| translation_timestamps.contains(ts))
}

async fn fetch_with_timeout<F>(timeout_ms: u64, fut: F) -> Vec<ProviderLyricsCandidate>
where
    F: std::future::Future<Output = Vec<ProviderLyricsCandidate>>,
{
    tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), fut)
        .await
        .unwrap_or_default()
}

async fn fetch_provider(provider: &str, artist: &str, title: &str) -> Vec<ProviderLyricsCandidate> {
    match provider {
        "netease_api" => providers::netease::fetch(artist, title).await,
        "qqmusic_api" => providers::qqmusic::fetch(artist, title).await,
        "kugou_api" => providers::kugou::fetch(artist, title).await,
        "kuwo_api" => providers::kuwo::fetch(artist, title).await,
        "lrclib" => providers::lrclib::fetch(artist, title).await,
        _ => Vec::new(),
    }
}

fn dedup_candidates(mut candidates: Vec<ProviderLyricsCandidate>) -> Vec<ProviderLyricsCandidate> {
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|c| seen.insert(format!("{}::{}", c.provider, c.id)));
    candidates
}

async fn fetch_all_candidates(
    artist: &str,
    title: &str,
    preferred_provider: Option<&str>,
) -> Vec<ProviderLyricsCandidate> {
    let fast_primary = preferred_provider.unwrap_or("netease_api");
    let fast_fetch_lrclib = !fast_primary.eq_ignore_ascii_case("lrclib");

    // Phase 1: fast path for first paint. Prioritize platform-matched provider and lrclib.
    let (fast_primary_candidates, fast_lrclib_candidates) = tokio::join!(
        fetch_with_timeout(1800, fetch_provider(fast_primary, artist, title)),
        fetch_with_timeout(1400, async {
            if fast_fetch_lrclib {
                fetch_provider("lrclib", artist, title).await
            } else {
                Vec::new()
            }
        }),
    );

    let mut fast = Vec::new();
    fast.extend(fast_primary_candidates);
    fast.extend(fast_lrclib_candidates);
    fast = dedup_candidates(fast);
    if fast.iter().any(candidate_has_bilingual_content) {
        return fast;
    }

    // Phase 2: complete candidate set only when phase 1 is insufficient.
    let fetch_netease = !fast_primary.eq_ignore_ascii_case("netease_api");
    let fetch_qq = !fast_primary.eq_ignore_ascii_case("qqmusic_api");
    let fetch_kugou = !fast_primary.eq_ignore_ascii_case("kugou_api");
    let fetch_kuwo = !fast_primary.eq_ignore_ascii_case("kuwo_api");
    let fetch_lrclib = !fast_fetch_lrclib;

    let (lrclib, netease, qqmusic, kugou, kuwo) = tokio::join!(
        fetch_with_timeout(2200, async {
            if fetch_lrclib {
                fetch_provider("lrclib", artist, title).await
            } else {
                Vec::new()
            }
        }),
        fetch_with_timeout(3000, async {
            if fetch_netease {
                fetch_provider("netease_api", artist, title).await
            } else {
                Vec::new()
            }
        }),
        fetch_with_timeout(3000, async {
            if fetch_qq {
                fetch_provider("qqmusic_api", artist, title).await
            } else {
                Vec::new()
            }
        }),
        fetch_with_timeout(1200, async {
            if fetch_kugou {
                fetch_provider("kugou_api", artist, title).await
            } else {
                Vec::new()
            }
        }),
        fetch_with_timeout(1200, async {
            if fetch_kuwo {
                fetch_provider("kuwo_api", artist, title).await
            } else {
                Vec::new()
            }
        }),
    );

    let mut all = fast;
    all.extend(lrclib);
    all.extend(netease);
    all.extend(qqmusic);
    all.extend(kugou);
    all.extend(kuwo);
    dedup_candidates(all)
}

#[tauri::command]
pub async fn music_get_lyrics(request: MusicLyricsRequest) -> Result<MusicLyricsResponse, String> {
    let artist = request.artist.trim();
    let title = request.title.trim();
    if artist.is_empty() || title.is_empty() {
        return Ok(MusicLyricsResponse {
            ok: false,
            found: false,
            reason_message: Some("artist or title is empty".to_string()),
            ..Default::default()
        });
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    let song_key = normalize_song_key(artist, title);
    let _ = crate::db::prune_expired_lyrics_cache(now_ms);

    // If candidate_id is provided, try cache first but with that specific id
    if let Some(target_id) = &request.candidate_id {
        let cached = crate::db::load_lyrics_cache(&song_key, now_ms)?;
        if let Some(found) = cached.iter().find(|c| c.candidate_id == *target_id) {
            if let Ok(mut response) =
                serde_json::from_str::<MusicLyricsResponse>(&found.payload_json)
            {
                let _ = crate::db::touch_lyrics_cache(&song_key, &found.candidate_key, now_ms);
                response.from_cache = true;
                return Ok(response);
            }
        }
    } else {
        // Normal flow: try any valid cache
        let cached = crate::db::load_lyrics_cache(&song_key, now_ms)?;
        let parsed_cached: Vec<(crate::db::LyricsCacheRecord, MusicLyricsResponse)> = cached
            .into_iter()
            .filter_map(|record| {
                serde_json::from_str::<MusicLyricsResponse>(&record.payload_json)
                    .ok()
                    .map(|response| (record, response))
            })
            .collect();

        if let Some((record, mut response)) = parsed_cached
            .iter()
            .find(|(_, response)| has_bilingual_lines(&response.lines))
            .cloned()
            .or_else(|| parsed_cached.into_iter().next())
        {
            let _ = crate::db::touch_lyrics_cache(&song_key, &record.candidate_key, now_ms);
            response.from_cache = true;
            return Ok(response);
        }
    }

    let preferred_provider = scoring::preferred_provider(
        request
            .source_platform
            .as_deref()
            .or(request.source_app_id.as_deref()),
    );

    // Fetch from providers
    let candidates = fetch_all_candidates(artist, title, preferred_provider).await;
    if candidates.is_empty() {
        return Ok(MusicLyricsResponse {
            ok: false,
            found: false,
            reason_message: Some("no lyrics found from any providers".to_string()),
            ..Default::default()
        });
    }

    // Rank candidates (prefer bilingual entries when available).

    struct RankedCandidate {
        candidate: ProviderLyricsCandidate,
        score: f64,
        bilingual: bool,
    }

    let mut ranked_candidates: Vec<RankedCandidate> = candidates
        .into_iter()
        .map(|candidate| {
            let mut score = scoring::score_candidate(
                artist,
                title,
                request.duration_secs,
                &candidate.artist,
                &candidate.title,
                candidate.duration_ms,
            );
            if let Some(preferred) = preferred_provider {
                if candidate.provider == preferred {
                    score += 0.08;
                }
            }
            let bilingual = candidate_has_bilingual_content(&candidate);
            if bilingual {
                score += 0.12;
            }
            RankedCandidate {
                candidate,
                score,
                bilingual,
            }
        })
        .collect();

    ranked_candidates.sort_by(|a, b| {
        b.bilingual.cmp(&a.bilingual).then_with(|| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });

    // Pick best or targeted
    let selected_index = if let Some(target_id) = &request.candidate_id {
        ranked_candidates
            .iter()
            .position(|c| c.candidate.id == *target_id)
            .unwrap_or_else(|| {
                ranked_candidates
                    .iter()
                    .position(|c| c.bilingual)
                    .unwrap_or(0)
            })
    } else {
        ranked_candidates
            .iter()
            .position(|c| c.bilingual)
            .unwrap_or(0)
    };

    let selected = &ranked_candidates[selected_index].candidate;

    let lines = merge_lyrics(
        &selected.primary_lrc,
        selected.translation_lrc.as_deref(),
        selected.romanized_lrc.as_deref(),
    );

    let mut response = MusicLyricsResponse {
        ok: true,
        found: true,
        provider: Some(selected.provider.clone()),
        from_cache: false,
        reason_message: None,
        candidate_id: Some(selected.id.clone()),
        candidates: ranked_candidates
            .iter()
            .map(|c| MusicLyricsCandidate {
                id: c.candidate.id.clone(),
                label: format!("{} - {}", c.candidate.title, c.candidate.artist),
                provider: Some(c.candidate.provider.clone()),
            })
            .collect(),
        lines,
        plain_text: selected
            .plain_text
            .clone()
            .or(Some(selected.primary_lrc.clone())),
    };

    if response.lines.is_empty() {
        response.ok = false;
        response.reason_message = Some("parsed lyrics are empty".to_string());
    }

    if let Ok(payload_json) = serde_json::to_string(&response) {
        let c_id = response.candidate_id.as_deref().unwrap_or("unknown");
        let _ = crate::db::upsert_lyrics_cache(
            &song_key,
            c_id,
            artist,
            title,
            request
                .source_platform
                .as_deref()
                .or(request.source_app_id.as_deref()),
            response.provider.as_deref().unwrap_or("unknown"),
            c_id,
            &payload_json,
            now_ms,
            LYRICS_CACHE_TTL_SECS,
        );
    }

    Ok(response)
}

#[tauri::command]
pub fn music_clear_lyrics_cache() -> Result<(), String> {
    crate::db::clear_lyrics_cache()
}
