fn normalize(s: &str) -> String {
    s.trim().to_ascii_lowercase()
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
    (title_s * 0.62) + (artist_s * 0.26) + (dur_s * 0.12)
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
