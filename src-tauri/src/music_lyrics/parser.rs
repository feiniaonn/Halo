use regex::Regex;

pub fn parse_lrc(input: &str) -> Vec<(u64, String)> {
    let tag_re = match Regex::new(r"\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]") {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut out: Vec<(u64, String)> = Vec::new();
    for raw in input.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }

        let mut tags: Vec<u64> = Vec::new();
        for caps in tag_re.captures_iter(line) {
            let mm = caps
                .get(1)
                .and_then(|m| m.as_str().parse::<u64>().ok())
                .unwrap_or(0);
            let ss = caps
                .get(2)
                .and_then(|m| m.as_str().parse::<u64>().ok())
                .unwrap_or(0);
            let frac_raw = caps.get(3).map(|m| m.as_str()).unwrap_or("0");
            let frac_ms = match frac_raw.len() {
                0 => 0,
                1 => frac_raw.parse::<u64>().unwrap_or(0) * 100,
                2 => frac_raw.parse::<u64>().unwrap_or(0) * 10,
                _ => frac_raw[..3].parse::<u64>().unwrap_or(0),
            };
            let ts = mm
                .saturating_mul(60_000)
                .saturating_add(ss.saturating_mul(1000))
                .saturating_add(frac_ms);
            tags.push(ts);
        }
        if tags.is_empty() {
            continue;
        }

        let text = tag_re.replace_all(line, "").trim().to_string();
        if text.is_empty() {
            continue;
        }

        for ts in tags {
            out.push((ts, text.clone()));
        }
    }

    out.sort_by_key(|v| v.0);
    out.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    out
}
