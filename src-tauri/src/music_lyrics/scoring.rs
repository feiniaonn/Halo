fn normalize(s: &str) -> String {
    s.trim().to_ascii_lowercase()
}

fn compact_normalized(s: &str) -> String {
    normalize(s)
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || is_cjk(*ch))
        .collect()
}

fn is_cjk(ch: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&ch)
}

fn tokens(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut ascii_buf = String::new();

    for ch in normalize(s).chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_buf.push(ch);
            continue;
        }
        if !ascii_buf.is_empty() {
            out.push(std::mem::take(&mut ascii_buf));
        }
        if is_cjk(ch) {
            out.push(ch.to_string());
        }
    }
    if !ascii_buf.is_empty() {
        out.push(ascii_buf);
    }
    out
}

fn token_overlap_score(query: &str, target: &str) -> f64 {
    let q = tokens(query);
    if q.is_empty() {
        return 0.0;
    }
    let hay = normalize(target);
    let hit = q.iter().filter(|t| hay.contains(t.as_str())).count();
    hit as f64 / q.len() as f64
}

fn duration_score(expected_secs: Option<u64>, candidate_ms: Option<u64>) -> f64 {
    let Some(exp_secs) = expected_secs else {
        return 0.45;
    };
    let Some(c_ms) = candidate_ms else {
        return 0.45;
    };

    let c_secs = c_ms / 1000;
    let diff = exp_secs.abs_diff(c_secs);
    if diff <= 2 {
        1.0
    } else if diff <= 5 {
        0.9
    } else if diff <= 10 {
        0.7
    } else if diff <= 20 {
        0.4
    } else {
        0.15
    }
}

fn exact_match_score(query: &str, target: &str) -> f64 {
    let q = compact_normalized(query);
    let t = compact_normalized(target);
    if q.is_empty() || t.is_empty() {
        return 0.0;
    }
    if q == t {
        1.0
    } else if t.contains(&q) || q.contains(&t) {
        0.72
    } else {
        0.0
    }
}

pub fn is_confident_candidate_match(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
    candidate_artist: &str,
    candidate_title: &str,
    candidate_duration_ms: Option<u64>,
) -> bool {
    let title_s = token_overlap_score(title, candidate_title);
    let artist_s = token_overlap_score(artist, candidate_artist);
    let title_exact_s = exact_match_score(title, candidate_title);
    let artist_exact_s = exact_match_score(artist, candidate_artist);
    let score = score_candidate(
        artist,
        title,
        expected_duration_secs,
        candidate_artist,
        candidate_title,
        candidate_duration_ms,
    );

    if title_exact_s >= 1.0 {
        return score >= 0.72;
    }

    if title_exact_s >= 0.72 {
        return artist_s >= 0.55 && artist_exact_s >= 0.72 && score >= 0.68;
    }

    title_s >= 0.55 && artist_s >= 0.34 && score >= 0.78
}

pub fn score_candidate(
    artist: &str,
    title: &str,
    expected_duration_secs: Option<u64>,
    candidate_artist: &str,
    candidate_title: &str,
    candidate_duration_ms: Option<u64>,
) -> f64 {
    let title_s = token_overlap_score(title, candidate_title);
    let artist_s = token_overlap_score(artist, candidate_artist);
    let dur_s = duration_score(expected_duration_secs, candidate_duration_ms);
    let title_exact_s = exact_match_score(title, candidate_title);
    let artist_exact_s = exact_match_score(artist, candidate_artist);

    let mut score = (title_s * 0.48)
        + (artist_s * 0.3)
        + (dur_s * 0.1)
        + (title_exact_s * 0.24)
        + (artist_exact_s * 0.14);

    if title_exact_s >= 1.0 && artist_exact_s >= 1.0 {
        score += 0.18;
    } else if title_exact_s >= 1.0 && artist_s >= 0.6 {
        score += 0.1;
    }

    if title_s < 0.35 {
        score -= 0.18;
    }
    if artist_s < 0.2 {
        score -= 0.12;
    }

    score
}

pub fn preferred_provider(source_platform: Option<&str>) -> Option<&'static str> {
    let normalized = source_platform
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if normalized.contains("qq") || normalized.contains("tencent") {
        return Some("qqmusic_api");
    }
    if normalized.contains("netease")
        || normalized.contains("163")
        || normalized.contains("cloudmusic")
    {
        return Some("netease_api");
    }
    if normalized.contains("kugou") {
        return Some("kugou_api");
    }
    if normalized.contains("kuwo") {
        return Some("kuwo_api");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{is_confident_candidate_match, score_candidate};

    #[test]
    fn exact_title_and_artist_should_beat_wrong_song_with_same_artist_family() {
        let correct = score_candidate(
            "战双帕弥什",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            "战双帕弥什",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126_000),
        );
        let wrong = score_candidate(
            "战双帕弥什",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            "战双帕弥什/M",
            "新生的明天 L'Aurore Viendra",
            Some(126_000),
        );

        assert!(correct > wrong, "correct={correct}, wrong={wrong}");
    }

    #[test]
    fn exact_title_match_should_beat_partial_title_overlap() {
        let exact = score_candidate(
            "Sawako碎花",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            "Sawako碎花",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126_000),
        );
        let partial = score_candidate(
            "Sawako碎花",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            "Sawako碎花",
            "TEARLESS NIGHTS",
            Some(126_000),
        );

        assert!(exact > partial, "exact={exact}, partial={partial}");
    }

    #[test]
    fn should_reject_other_song_from_same_artist() {
        assert!(!is_confident_candidate_match(
            "一只白羊",
            "我不怕",
            Some(210),
            "一只白羊",
            "赐我",
            Some(210_000),
        ));
    }

    #[test]
    fn should_accept_partial_title_when_exact_core_title_is_contained() {
        assert!(is_confident_candidate_match(
            "Sawako碎花",
            "TEARLESS NIGHTS 写夜无猜",
            Some(126),
            "Sawako碎花",
            "TEARLESS NIGHTS",
            Some(126_000),
        ));
    }
}
