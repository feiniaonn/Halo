fn is_non_empty_empty_object_array(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(|current| current.as_array())
        .is_some_and(|items| {
            !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.as_object().is_some_and(|object| object.is_empty()))
        })
}

fn is_filter_object_with_empty_items(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(|current| current.as_object())
        .is_some_and(|filters| {
            !filters.is_empty()
                && filters.values().all(|entry| {
                    entry.as_array().is_some_and(|items| {
                        !items.is_empty()
                            && items.iter().all(|item| {
                                item.as_object().is_some_and(|object| object.is_empty())
                            })
                    })
                })
        })
}

fn looks_like_stripped_payload(payload: &str) -> bool {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) else {
        return false;
    };
    let Some(object) = parsed.as_object() else {
        return false;
    };

    is_non_empty_empty_object_array(object.get("class"))
        || is_non_empty_empty_object_array(object.get("list"))
        || is_filter_object_with_empty_items(object.get("filters"))
}

fn extract_spider_debug_payload(stderr: &str) -> Option<String> {
    let mut lines = stderr.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed == "SPIDER_DEBUG: result" {
            let payload_line = lines.next()?.trim();
            if payload_line.starts_with('{') || payload_line.starts_with('[') {
                return Some(payload_line.to_string());
            }
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("SPIDER_DEBUG: result ") {
            let payload = payload.trim();
            if payload.starts_with('{') || payload.starts_with('[') {
                return Some(payload.to_string());
            }
        }
    }

    None
}

fn pick_string_field(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter().find_map(|key| {
        let value = object.get(*key)?;
        match value {
            serde_json::Value::String(current) => {
                let trimmed = current.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_owned())
                }
            }
            serde_json::Value::Number(current) => Some(current.to_string()),
            _ => None,
        }
    })
}

fn looks_like_app_category_item(value: &serde_json::Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };

    let has_type = pick_string_field(object, &["type_id", "typeId"]).is_some();
    let has_name = pick_string_field(object, &["type_name", "typeName", "name"]).is_some();
    let has_vod = pick_string_field(object, &["vod_id", "vodId", "vod_name", "vodName"]).is_some();

    has_type && has_name && !has_vod
}

fn normalize_app_category_payload(items: &[serde_json::Value]) -> Option<serde_json::Value> {
    if items.is_empty() || !items.iter().all(looks_like_app_category_item) {
        return None;
    }

    let class_items = items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let type_id = pick_string_field(object, &["type_id", "typeId"])?;
            let type_name = pick_string_field(object, &["type_name", "typeName", "name"])
                .unwrap_or_else(|| type_id.clone());
            Some(serde_json::json!({
                "type_id": type_id,
                "type_name": type_name,
            }))
        })
        .collect::<Vec<_>>();

    if class_items.is_empty() {
        return None;
    }

    Some(serde_json::json!({
        "class": class_items,
        "list": [],
        "filters": {},
    }))
}

fn normalize_payload_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(result) = object.get("result") {
                return normalize_payload_value(result);
            }

            if let Some(data) = object.get("data") {
                let normalized = normalize_payload_value(data);
                if !normalized.is_null() {
                    return normalized;
                }
            }

            if let Some(items) = object.get("list").and_then(|current| current.as_array()) {
                if let Some(normalized) = normalize_app_category_payload(items) {
                    return normalized;
                }
            }

            value.clone()
        }
        serde_json::Value::Array(items) => {
            if let Some(first) = items.first() {
                return normalize_payload_value(first);
            }
            serde_json::Value::Array(Vec::new())
        }
        _ => value.clone(),
    }
}

fn normalize_spider_debug_payload(payload: &str) -> Option<String> {
    let parsed = serde_json::from_str::<serde_json::Value>(payload).ok()?;
    Some(normalize_payload_value(&parsed).to_string())
}

pub(crate) fn recover_payload_from_stderr(stderr: &str, current_payload: &str) -> Option<String> {
    if !looks_like_stripped_payload(current_payload) {
        return None;
    }

    let raw_payload = extract_spider_debug_payload(stderr)?;
    normalize_spider_debug_payload(&raw_payload)
}

#[cfg(test)]
mod tests {
    use super::recover_payload_from_stderr;

    #[test]
    fn recovers_data_wrapper_from_spider_debug_payload() {
        let stderr = concat!(
            "SPIDER_DEBUG: result\n",
            "{\"msg\":\"\",\"code\":1,\"data\":{\"list\":[{\"vod_id\":1,\"vod_name\":\"热播\"}]}}\n",
            "DEBUG: invokeMethod result value: [{\"list\":[{}]}]\n"
        );

        let recovered = recover_payload_from_stderr(stderr, r#"{"list":[{}]}"#);
        assert_eq!(
            recovered.as_deref(),
            Some(r#"{"list":[{"vod_id":1,"vod_name":"热播"}]}"#)
        );
    }

    #[test]
    fn ignores_non_stripped_payloads() {
        let stderr = concat!(
            "SPIDER_DEBUG: result\n",
            "{\"msg\":\"\",\"code\":1,\"data\":{\"list\":[{\"vod_id\":1}]}}\n"
        );

        assert!(recover_payload_from_stderr(stderr, r#"{"list":[{"vod_id":"1"}]}"#).is_none());
    }

    #[test]
    fn recovers_app_home_categories_from_data_list() {
        let stderr = concat!(
            "SPIDER_DEBUG: result\n",
            "{\"msg\":\"\",\"code\":1,\"data\":{\"list\":[{\"type_id\":10,\"type_name\":\"内地\"},{\"type_id\":1,\"type_name\":\"电影\"}]}}\n",
            "DEBUG: invokeMethod result value: [{\"class\":[{},{}],\"list\":[],\"filters\":{\"10\":[{}]}}]\n"
        );

        let recovered = recover_payload_from_stderr(
            stderr,
            r#"{"class":[{},{}],"list":[],"filters":{"10":[{}]}}"#,
        );

        assert_eq!(
            recovered.as_deref(),
            Some(
                r#"{"class":[{"type_id":"10","type_name":"内地"},{"type_id":"1","type_name":"电影"}],"filters":{},"list":[]}"#
            )
        );
    }
}
