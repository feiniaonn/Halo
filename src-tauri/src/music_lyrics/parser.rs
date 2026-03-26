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

        let matches: Vec<_> = tag_re.find_iter(line).collect();
        if matches.is_empty() {
            continue;
        }

        let mut pending_tags: Vec<u64> = Vec::new();
        let mut previous_end = 0usize;

        for tag_match in matches {
            let text_segment = line[previous_end..tag_match.start()].trim();
            if !text_segment.is_empty() && !pending_tags.is_empty() {
                for ts in pending_tags.drain(..) {
                    out.push((ts, text_segment.to_string()));
                }
            }

            if let Some(ts) = parse_lrc_timestamp(&tag_re, tag_match.as_str()) {
                pending_tags.push(ts);
            }

            previous_end = tag_match.end();
        }

        let trailing_text = line[previous_end..].trim();
        if !trailing_text.is_empty() {
            for ts in pending_tags.drain(..) {
                out.push((ts, trailing_text.to_string()));
            }
        }
    }

    out.sort_by_key(|v| v.0);
    out.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    out
}

fn parse_lrc_timestamp(tag_re: &Regex, tag: &str) -> Option<u64> {
    let caps = tag_re.captures(tag)?;
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

    Some(
        mm.saturating_mul(60_000)
            .saturating_add(ss.saturating_mul(1000))
            .saturating_add(frac_ms),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_lrc;

    #[test]
    fn splits_interleaved_timestamp_segments_into_independent_lines() {
        let parsed =
            parse_lrc("[00:25.03]first line[00:28.28]second line[00:32.22]\n[00:33.58]third line");

        assert_eq!(
            parsed,
            vec![
                (25_030, "first line".to_string()),
                (28_280, "second line".to_string()),
                (33_580, "third line".to_string()),
            ]
        );
    }

    #[test]
    fn applies_shared_text_to_leading_timestamp_group() {
        let parsed = parse_lrc("[00:11.08][00:11.18]shared line");

        assert_eq!(
            parsed,
            vec![
                (11_080, "shared line".to_string()),
                (11_180, "shared line".to_string()),
            ]
        );
    }
}
