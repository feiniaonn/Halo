mod parser;
mod providers;
pub(crate) mod scoring;
mod types;

use types::{ProviderLyricsCandidate, ProviderTimedLine};

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
pub struct MusicLyricsWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct MusicLyricsLine {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub translation: Option<String>,
    pub romanized: Option<String>,
    #[serde(default)]
    pub words: Vec<MusicLyricsWord>,
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

fn persist_lyrics_response_to_cache(
    request: &MusicLyricsRequest,
    song_key: &str,
    response: &MusicLyricsResponse,
    now_ms: i64,
) {
    if let Ok(payload_json) = serde_json::to_string(response) {
        let candidate_id = response.candidate_id.as_deref().unwrap_or("unknown");
        let _ = crate::db::upsert_lyrics_cache(
            song_key,
            candidate_id,
            &request.artist,
            &request.title,
            request
                .source_platform
                .as_deref()
                .or(request.source_app_id.as_deref()),
            response.provider.as_deref().unwrap_or("unknown"),
            candidate_id,
            &payload_json,
            now_ms,
            LYRICS_CACHE_TTL_SECS,
        );
    }
}

fn merge_lyrics(
    primary_lrc: &str,
    translation_lrc: Option<&str>,
    romanized_lrc: Option<&str>,
    word_timed_primary: Option<&[ProviderTimedLine]>,
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

        let translation = find_aligned_subline(&trans_parsed, *start_ms);
        let romanized = find_aligned_subline(&roma_parsed, *start_ms);
        let words = find_aligned_word_line(word_timed_primary, *start_ms);

        out.push(MusicLyricsLine {
            start_ms: *start_ms,
            end_ms,
            text: text.clone(),
            translation,
            romanized,
            words,
        });
    }
    out
}

fn find_aligned_subline(lines: &[(u64, String)], target_start_ms: u64) -> Option<String> {
    const SUBLINE_MATCH_TOLERANCE_MS: u64 = 80;

    lines
        .iter()
        .filter_map(|(ts, text)| {
            let diff = ts.abs_diff(target_start_ms);
            (diff <= SUBLINE_MATCH_TOLERANCE_MS).then_some((diff, text))
        })
        .min_by_key(|(diff, _)| *diff)
        .and_then(|(_, text)| {
            let trimmed = text.trim();
            (!trimmed.is_empty() && trimmed != "//").then(|| trimmed.to_string())
        })
}

fn find_aligned_word_line(
    lines: Option<&[ProviderTimedLine]>,
    target_start_ms: u64,
) -> Vec<MusicLyricsWord> {
    const WORD_LINE_MATCH_TOLERANCE_MS: u64 = 120;

    let Some(lines) = lines else {
        return Vec::new();
    };

    lines
        .iter()
        .filter_map(|line| {
            let diff = line.start_ms.abs_diff(target_start_ms);
            (diff <= WORD_LINE_MATCH_TOLERANCE_MS).then_some((diff, line))
        })
        .min_by_key(|(diff, _)| *diff)
        .map(|(_, line)| {
            line.words
                .iter()
                .filter_map(|word| {
                    (!word.text.is_empty()).then(|| MusicLyricsWord {
                        start_ms: word.start_ms,
                        end_ms: word.end_ms.max(word.start_ms.saturating_add(1)),
                        text: word.text.clone(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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

fn split_candidate_label(label: &str) -> (&str, &str) {
    label
        .split_once(" - ")
        .map(|(title, artist)| (title.trim(), artist.trim()))
        .unwrap_or((label.trim(), ""))
}

fn cached_response_score(
    response: &MusicLyricsResponse,
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
    preferred_provider: Option<&str>,
) -> f64 {
    let selected_candidate = response
        .candidate_id
        .as_deref()
        .and_then(|target_id| {
            response
                .candidates
                .iter()
                .find(|candidate| candidate.id == target_id)
        })
        .or_else(|| response.candidates.first());

    let (candidate_title, candidate_artist) = selected_candidate
        .map(|candidate| split_candidate_label(&candidate.label))
        .unwrap_or((title, artist));

    let mut score = scoring::score_candidate(
        artist,
        title,
        expected_duration_secs,
        candidate_artist,
        candidate_title,
        None,
    );

    let provider = response
        .provider
        .as_deref()
        .or_else(|| selected_candidate.and_then(|candidate| candidate.provider.as_deref()));

    if let Some(preferred) = preferred_provider {
        if provider == Some(preferred)
            || (preferred == "qqmusic_api" && provider == Some("qqmusic_cache"))
        {
            score += 0.05;
        }
    }

    if has_bilingual_lines(&response.lines) {
        score += 0.04;
    }

    score
}

fn cached_response_is_confident_match(
    response: &MusicLyricsResponse,
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
) -> bool {
    if !response.ok || response.lines.is_empty() {
        return false;
    }

    let selected_candidate = response
        .candidate_id
        .as_deref()
        .and_then(|target_id| {
            response
                .candidates
                .iter()
                .find(|candidate| candidate.id == target_id)
        })
        .or_else(|| response.candidates.first());

    let (candidate_title, candidate_artist) = selected_candidate
        .map(|candidate| split_candidate_label(&candidate.label))
        .unwrap_or((title, artist));

    scoring::is_confident_candidate_match(
        artist,
        title,
        expected_duration_secs,
        candidate_artist,
        candidate_title,
        None,
    )
}

fn provider_matches_preferred_cache(
    provider: Option<&str>,
    preferred_provider: Option<&str>,
) -> bool {
    match preferred_provider {
        Some("qqmusic_api") => matches!(provider, Some("qqmusic_api" | "qqmusic_cache")),
        Some(preferred) => provider == Some(preferred),
        None => true,
    }
}

fn cached_response_matches_preferred_provider(
    response: &MusicLyricsResponse,
    preferred_provider: Option<&str>,
) -> bool {
    if preferred_provider.is_none() {
        return true;
    }

    let selected_candidate_provider = response.candidate_id.as_deref().and_then(|target_id| {
        response
            .candidates
            .iter()
            .find(|candidate| candidate.id == target_id)
            .and_then(|candidate| candidate.provider.as_deref())
    });

    provider_matches_preferred_cache(
        response.provider.as_deref().or(selected_candidate_provider),
        preferred_provider,
    )
}

fn cached_response_has_word_timed_lines(response: &MusicLyricsResponse) -> bool {
    response.lines.iter().any(|line| !line.words.is_empty())
}

fn cached_response_requires_refresh(
    response: &MusicLyricsResponse,
    preferred_provider: Option<&str>,
) -> bool {
    matches!(preferred_provider, Some("qqmusic_api"))
        && cached_response_matches_preferred_provider(response, preferred_provider)
        && !cached_response_has_word_timed_lines(response)
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
    expected_duration_secs: Option<u64>,
    preferred_provider: Option<&str>,
) -> Vec<ProviderLyricsCandidate> {
    let mut local_qqmusic_cache =
        providers::qqmusic_cache::fetch(artist, title, expected_duration_secs);

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
    fast.append(&mut local_qqmusic_cache);
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
            reason_message: Some("歌曲信息不完整，暂时无法获取歌词".to_string()),
            ..Default::default()
        });
    }

    let now_ms = chrono::Local::now().timestamp_millis();
    let song_key = normalize_song_key(artist, title);
    let _ = crate::db::prune_expired_lyrics_cache(now_ms);
    let preferred_provider = scoring::preferred_provider(
        request
            .source_platform
            .as_deref()
            .or(request.source_app_id.as_deref()),
    );

    // If candidate_id is provided, try cache first but with that specific id
    if let Some(target_id) = &request.candidate_id {
        let cached = crate::db::load_lyrics_cache(&song_key, now_ms)?;
        if let Some(found) = cached.iter().find(|c| c.candidate_id == *target_id) {
            if let Ok(mut response) =
                serde_json::from_str::<MusicLyricsResponse>(&found.payload_json)
            {
                if cached_response_requires_refresh(&response, preferred_provider) {
                    // Legacy QQ cache payloads did not preserve word-timed segments.
                    // Force a provider refresh so逐字 and corrected translations can rebuild.
                } else {
                    let _ = crate::db::touch_lyrics_cache(&song_key, &found.candidate_key, now_ms);
                    response.from_cache = true;
                    return Ok(response);
                }
            }
        }
    } else {
        // Normal flow: try any valid cache
        let cached = crate::db::load_lyrics_cache(&song_key, now_ms)?;
        let parsed_cached: Vec<(crate::db::LyricsCacheRecord, MusicLyricsResponse, f64)> = cached
            .into_iter()
            .filter_map(|record| {
                serde_json::from_str::<MusicLyricsResponse>(&record.payload_json)
                    .ok()
                    .map(|response| {
                        let score = cached_response_score(
                            &response,
                            artist,
                            title,
                            request.duration_secs,
                            preferred_provider,
                        );
                        (record, response, score)
                    })
            })
            .collect();

        if let Some((record, mut response, score)) = parsed_cached
            .into_iter()
            .filter(|(_, response, _)| {
                cached_response_is_confident_match(response, artist, title, request.duration_secs)
                    && cached_response_matches_preferred_provider(response, preferred_provider)
                    && !cached_response_requires_refresh(response, preferred_provider)
            })
            .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        {
            if score >= 0.72 {
                let _ = crate::db::touch_lyrics_cache(&song_key, &record.candidate_key, now_ms);
                response.from_cache = true;
                return Ok(response);
            }
        }
    }

    // Fetch from providers
    let candidates =
        fetch_all_candidates(artist, title, request.duration_secs, preferred_provider).await;
    if candidates.is_empty() {
        return Ok(MusicLyricsResponse {
            ok: false,
            found: false,
            reason_message: Some("当前来源没有找到可用歌词".to_string()),
            ..Default::default()
        });
    }

    // Rank candidates with exact title/artist match first. Bilingual content is only a bonus.

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
                if candidate.provider == preferred
                    || (preferred == "qqmusic_api" && candidate.provider == "qqmusic_cache")
                {
                    score += 0.08;
                }
            }
            let bilingual = candidate_has_bilingual_content(&candidate);
            if bilingual {
                score += 0.04;
            }
            RankedCandidate {
                candidate,
                score,
                bilingual,
            }
        })
        .collect();

    ranked_candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.bilingual.cmp(&a.bilingual))
    });

    // Pick best or targeted
    let selected_index = if let Some(target_id) = &request.candidate_id {
        ranked_candidates
            .iter()
            .position(|c| c.candidate.id == *target_id)
            .unwrap_or(0)
    } else {
        ranked_candidates
            .iter()
            .enumerate()
            .find_map(|(index, candidate)| {
                if !scoring::is_confident_candidate_match(
                    artist,
                    title,
                    request.duration_secs,
                    &candidate.candidate.artist,
                    &candidate.candidate.title,
                    candidate.candidate.duration_ms,
                ) {
                    return None;
                }

                let lines = merge_lyrics(
                    &candidate.candidate.primary_lrc,
                    candidate.candidate.translation_lrc.as_deref(),
                    candidate.candidate.romanized_lrc.as_deref(),
                    candidate.candidate.word_timed_primary.as_deref(),
                );
                if lines.is_empty() {
                    return None;
                }

                Some(index)
            })
            .or_else(|| {
                ranked_candidates.iter().position(|candidate| {
                    scoring::is_confident_candidate_match(
                        artist,
                        title,
                        request.duration_secs,
                        &candidate.candidate.artist,
                        &candidate.candidate.title,
                        candidate.candidate.duration_ms,
                    )
                })
            })
            .unwrap_or(0)
    };

    let selected = &ranked_candidates[selected_index].candidate;

    if request.candidate_id.is_none()
        && !scoring::is_confident_candidate_match(
            artist,
            title,
            request.duration_secs,
            &selected.artist,
            &selected.title,
            selected.duration_ms,
        )
    {
        return Ok(MusicLyricsResponse {
            ok: false,
            found: false,
            provider: Some(selected.provider.clone()),
            from_cache: false,
            reason_message: Some("没有找到足够匹配的歌词，请切换候选或稍后再试".to_string()),
            candidate_id: None,
            candidates: ranked_candidates
                .iter()
                .map(|c| MusicLyricsCandidate {
                    id: c.candidate.id.clone(),
                    label: format!("{} - {}", c.candidate.title, c.candidate.artist),
                    provider: Some(c.candidate.provider.clone()),
                })
                .collect(),
            lines: Vec::new(),
            plain_text: None,
        });
    }

    let lines = merge_lyrics(
        &selected.primary_lrc,
        selected.translation_lrc.as_deref(),
        selected.romanized_lrc.as_deref(),
        selected.word_timed_primary.as_deref(),
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
        response.reason_message = Some("已找到歌词源，但当前歌词格式暂时无法解析".to_string());
    }

    persist_lyrics_response_to_cache(&request, &song_key, &response, now_ms);

    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        cached_response_matches_preferred_provider, cached_response_requires_refresh,
        cached_response_score, merge_lyrics, MusicLyricsCandidate, MusicLyricsResponse,
        MusicLyricsWord,
    };

    #[test]
    fn cache_prefers_exact_title_candidate_over_wrong_bilingual_candidate() {
        let wrong = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("netease_api".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("wrong".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "wrong".to_string(),
                label: "新生的明天 L'Aurore Viendra - 战双帕弥什/M".to_string(),
                provider: Some("netease_api".to_string()),
            }],
            lines: Vec::new(),
            plain_text: None,
        };

        let correct = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("netease_api".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("correct".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "correct".to_string(),
                label: "TEARLESS NIGHTS 写夜无猜 - 战双帕弥什".to_string(),
                provider: Some("netease_api".to_string()),
            }],
            lines: Vec::new(),
            plain_text: None,
        };

        let wrong_score = cached_response_score(
            &wrong,
            "战双帕弥什",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            Some("netease_api"),
        );
        let correct_score = cached_response_score(
            &correct,
            "战双帕弥什",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            Some("netease_api"),
        );

        assert!(correct_score > wrong_score);
    }

    #[test]
    fn qqmusic_local_playback_should_not_reuse_netease_cache() {
        let response = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("netease_api".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("netease".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "netease".to_string(),
                label: "A Million Years - Mariette".to_string(),
                provider: Some("netease_api".to_string()),
            }],
            lines: vec![super::MusicLyricsLine {
                start_ms: 0,
                end_ms: 1000,
                text: "A Million Years".to_string(),
                translation: None,
                romanized: None,
                words: Vec::new(),
            }],
            plain_text: Some("[00:00.00]A Million Years".to_string()),
        };

        assert!(!cached_response_matches_preferred_provider(
            &response,
            Some("qqmusic_api")
        ));
    }

    #[test]
    fn qqmusic_local_playback_should_reuse_local_qq_cache() {
        let response = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("qqmusic_cache".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("qqmusic_cache:mariette:a million years".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "qqmusic_cache:mariette:a million years".to_string(),
                label: "A Million Years - Mariette".to_string(),
                provider: Some("qqmusic_cache".to_string()),
            }],
            lines: vec![super::MusicLyricsLine {
                start_ms: 0,
                end_ms: 1000,
                text: "A Million Years".to_string(),
                translation: None,
                romanized: None,
                words: Vec::new(),
            }],
            plain_text: Some("[00:00.00]A Million Years".to_string()),
        };

        assert!(cached_response_matches_preferred_provider(
            &response,
            Some("qqmusic_api")
        ));
    }

    #[test]
    fn qqmusic_local_cache_without_word_timing_should_refresh() {
        let response = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("qqmusic_cache".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("qqmusic_cache:mariette:a million years".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "qqmusic_cache:mariette:a million years".to_string(),
                label: "A Million Years - Mariette".to_string(),
                provider: Some("qqmusic_cache".to_string()),
            }],
            lines: vec![super::MusicLyricsLine {
                start_ms: 0,
                end_ms: 1000,
                text: "A Million Years".to_string(),
                translation: Some("因为爱你一百万年".to_string()),
                romanized: None,
                words: Vec::new(),
            }],
            plain_text: Some("[00:00.00]A Million Years".to_string()),
        };

        assert!(cached_response_requires_refresh(
            &response,
            Some("qqmusic_api")
        ));
    }

    #[test]
    fn qqmusic_local_cache_with_word_timing_can_be_reused() {
        let response = MusicLyricsResponse {
            ok: true,
            found: true,
            provider: Some("qqmusic_cache".to_string()),
            from_cache: false,
            reason_message: None,
            candidate_id: Some("qqmusic_cache:mariette:a million years".to_string()),
            candidates: vec![MusicLyricsCandidate {
                id: "qqmusic_cache:mariette:a million years".to_string(),
                label: "A Million Years - Mariette".to_string(),
                provider: Some("qqmusic_cache".to_string()),
            }],
            lines: vec![super::MusicLyricsLine {
                start_ms: 0,
                end_ms: 1000,
                text: "A Million Years".to_string(),
                translation: Some("因为爱你一百万年".to_string()),
                romanized: None,
                words: vec![MusicLyricsWord {
                    start_ms: 0,
                    end_ms: 300,
                    text: "A ".to_string(),
                }],
            }],
            plain_text: Some("[00:00.00]A Million Years".to_string()),
        };

        assert!(!cached_response_requires_refresh(
            &response,
            Some("qqmusic_api")
        ));
    }

    #[test]
    fn merge_lyrics_should_align_translation_with_small_timestamp_drift() {
        let lines = merge_lyrics(
            "[00:11.08]I'll never give up",
            Some("[00:11.07]我不会轻言放弃"),
            None,
            None,
        );

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].translation.as_deref(), Some("我不会轻言放弃"));
    }
}

#[tauri::command]
pub fn music_clear_lyrics_cache() -> Result<(), String> {
    crate::db::clear_lyrics_cache()
}
