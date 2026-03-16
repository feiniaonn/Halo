use serde::Serialize;

use crate::spider_cmds_runtime::{build_execution_envelope, SpiderExecutionReport};

pub const SPIDER_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSpiderMethodResponse {
    pub schema_version: u32,
    pub site_key: String,
    pub method: String,
    pub raw_payload: String,
    pub normalized_payload: serde_json::Value,
    pub report: SpiderExecutionReport,
    pub envelope: crate::spider_runtime_contract::SpiderExecutionEnvelope<serde_json::Value>,
}

pub fn build_normalized_method_response(
    site_key: &str,
    method: &str,
    raw_payload: String,
    report: SpiderExecutionReport,
) -> Result<NormalizedSpiderMethodResponse, String> {
    let normalized_payload = normalize_payload(method, &raw_payload)?;
    validate_normalized_payload(method, &normalized_payload)?;
    let envelope = build_execution_envelope(&report, Some(normalized_payload.clone()));
    Ok(NormalizedSpiderMethodResponse {
        schema_version: SPIDER_SCHEMA_VERSION,
        site_key: site_key.to_string(),
        method: method.to_string(),
        raw_payload,
        normalized_payload,
        report,
        envelope,
    })
}

pub fn normalize_payload(method: &str, payload: &str) -> Result<serde_json::Value, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(payload)
        .map_err(|err| format!("normalize {method} payload failed: {err}"))?;
    let value = unwrap_payload_value(&parsed);
    match method {
        "homeContent" => Ok(normalize_home_payload(&value)),
        "categoryContent" | "searchContent" => Ok(normalize_listing_payload(&value)),
        "detailContent" => Ok(normalize_detail_payload(&value)),
        "playerContent" => Ok(normalize_player_payload(&value)),
        _ => Ok(value),
    }
}

pub fn validate_normalized_payload(method: &str, value: &serde_json::Value) -> Result<(), String> {
    let object = value.as_object().ok_or_else(|| {
        format!("Invalid response structure: {method} returned non-object payload")
    })?;

    match method {
        "homeContent" => {
            let list = object
                .get("list")
                .and_then(|current| current.as_array())
                .map(|items| items.len())
                .unwrap_or(0);
            let class_len = object
                .get("class")
                .and_then(|current| current.as_array())
                .map(|items| items.len())
                .unwrap_or(0);
            if class_len == 0 && list == 0 {
                return Err(
                    "Invalid response structure: homeContent returned no canonical class or list"
                        .to_string(),
                );
            }
            if is_placeholder_array(object.get("class")) || is_placeholder_array(object.get("list"))
            {
                return Err(
                    "Invalid response structure: homeContent returned placeholder objects"
                        .to_string(),
                );
            }
        }
        "categoryContent" | "searchContent" => {
            if !object.contains_key("list") {
                return Err(format!(
                    "Invalid response structure: {method} missing canonical list"
                ));
            }
        }
        "detailContent" => {
            if !object.contains_key("list") {
                return Err(
                    "Invalid response structure: detailContent missing canonical list".to_string(),
                );
            }
        }
        "playerContent" => {}
        _ => {}
    }

    Ok(())
}

fn unwrap_payload_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(result) = object.get("result") {
                let normalized = unwrap_payload_value(result);
                if !normalized.is_null() {
                    return normalized;
                }
            }
            if let Some(data) = object.get("data") {
                let normalized = unwrap_payload_value(data);
                if !normalized.is_null() {
                    return normalized;
                }
            }
            value.clone()
        }
        serde_json::Value::Array(items) => {
            if let Some(first) = items.first() {
                return unwrap_payload_value(first);
            }
            serde_json::json!({})
        }
        _ => value.clone(),
    }
}

fn normalize_home_payload(value: &serde_json::Value) -> serde_json::Value {
    let object = value.as_object().cloned().unwrap_or_default();
    serde_json::json!({
        "class": normalize_class_items(object.get("class").or_else(|| object.get("a"))),
        "list": normalize_vod_items(object.get("list").or_else(|| object.get("b"))),
        "filters": object.get("filters").cloned().unwrap_or_else(|| serde_json::json!({})),
        "pagecount": pick_number(&object, &["pagecount", "pageCount", "totalpage", "page_total", "l", "m"]),
        "total": pick_number(&object, &["total", "totalCount", "recordcount", "recordCount", "n", "m"]),
    })
}

fn normalize_listing_payload(value: &serde_json::Value) -> serde_json::Value {
    let object = value.as_object().cloned().unwrap_or_default();
    serde_json::json!({
        "list": normalize_vod_items(object.get("list").or_else(|| object.get("b"))),
        "pagecount": pick_number(&object, &["pagecount", "pageCount", "totalpage", "page_total", "l", "m"]),
        "total": pick_number(&object, &["total", "totalCount", "recordcount", "recordCount", "n", "m"]),
    })
}

fn normalize_detail_payload(value: &serde_json::Value) -> serde_json::Value {
    let object = value.as_object().cloned().unwrap_or_default();
    let list = object
        .get("list")
        .and_then(|current| current.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(normalize_detail_item)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    serde_json::json!({ "list": list })
}

fn normalize_player_payload(value: &serde_json::Value) -> serde_json::Value {
    value
        .as_object()
        .cloned()
        .map(serde_json::Value::Object)
        .unwrap_or_else(|| serde_json::json!({}))
}

fn normalize_class_items(value: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    value
        .and_then(|current| current.as_array())
        .map(|items| items.iter().filter_map(normalize_class_item).collect())
        .unwrap_or_default()
}

fn normalize_vod_items(value: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    value
        .and_then(|current| current.as_array())
        .map(|items| items.iter().filter_map(normalize_vod_item).collect())
        .unwrap_or_default()
}

fn normalize_class_item(value: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(object) = value.as_object() {
        let type_id = pick_string(object, &["type_id", "typeId", "id"])?;
        let type_name = pick_string(object, &["type_name", "typeName", "name"])
            .unwrap_or_else(|| type_id.clone());
        return Some(serde_json::json!({
            "type_id": type_id,
            "type_name": type_name,
        }));
    }
    if let Some(items) = value.as_array() {
        let type_id = items.first().and_then(json_string)?;
        let type_name = items
            .get(1)
            .and_then(json_string)
            .unwrap_or_else(|| type_id.clone());
        return Some(serde_json::json!({
            "type_id": type_id,
            "type_name": type_name,
        }));
    }
    None
}

fn normalize_vod_item(value: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(object) = value.as_object() {
        let vod_id = pick_string(object, &["vod_id", "vodId", "id"])?;
        let vod_name = pick_string(object, &["vod_name", "vodName", "name"])?;
        let vod_pic =
            pick_string(object, &["vod_pic", "vodPic", "pic", "pic_url"]).unwrap_or_default();
        let vod_remarks =
            pick_string(object, &["vod_remarks", "vodRemarks", "remarks"]).unwrap_or_default();
        return Some(serde_json::json!({
            "vod_id": vod_id,
            "vod_name": vod_name,
            "vod_pic": vod_pic,
            "vod_remarks": vod_remarks,
        }));
    }
    if let Some(items) = value.as_array() {
        let vod_id = items.first().and_then(json_string)?;
        let vod_name = items.get(1).and_then(json_string)?;
        let vod_pic = items.get(2).and_then(json_string).unwrap_or_default();
        let vod_remarks = items.get(3).and_then(json_string).unwrap_or_default();
        return Some(serde_json::json!({
            "vod_id": vod_id,
            "vod_name": vod_name,
            "vod_pic": vod_pic,
            "vod_remarks": vod_remarks,
        }));
    }
    None
}

fn normalize_detail_item(value: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(object) = value.as_object() {
        let vod_id = pick_string(object, &["vod_id", "vodId", "id"]).unwrap_or_default();
        let vod_name = pick_string(object, &["vod_name", "vodName", "name"]).unwrap_or_default();
        return Some(serde_json::json!({
            "vod_id": vod_id,
            "vod_name": vod_name,
            "vod_pic": pick_string(object, &["vod_pic", "vodPic", "pic", "pic_url"]).unwrap_or_default(),
            "vod_year": pick_string(object, &["vod_year", "vodYear", "year"]),
            "vod_area": pick_string(object, &["vod_area", "vodArea", "area"]),
            "vod_actor": pick_string(object, &["vod_actor", "vodActor", "actor"]),
            "vod_director": pick_string(object, &["vod_director", "vodDirector", "director"]),
            "vod_content": pick_string(object, &["vod_content", "vodContent", "content"]),
            "vod_play_from": pick_string(object, &["vod_play_from", "vodPlayFrom", "playFrom"]),
            "vod_play_url": pick_string(object, &["vod_play_url", "vodPlayUrl", "playUrl"]),
        }));
    }
    None
}

fn pick_string(
    object: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(json_string))
}

fn pick_number(object: &serde_json::Map<String, serde_json::Value>, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        let value = object.get(*key)?;
        match value {
            serde_json::Value::Number(number) => number.as_u64(),
            serde_json::Value::String(text) => text.trim().parse::<u64>().ok(),
            _ => None,
        }
    })
}

fn json_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn is_placeholder_array(value: Option<&serde_json::Value>) -> bool {
    value
        .and_then(|current| current.as_array())
        .is_some_and(|items| {
            !items.is_empty()
                && items
                    .iter()
                    .all(|item| item.as_object().is_some_and(|object| object.is_empty()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success_report(method: &str) -> crate::spider_cmds_runtime::SpiderExecutionReport {
        crate::spider_cmds_runtime::success_report(
            "csp_Test",
            method,
            Some("csp_Test".to_string()),
            None,
            None,
        )
    }

    #[test]
    fn normalizes_nested_home_payload_into_canonical_shape() {
        let raw_payload = serde_json::json!({
            "data": {
                "class": [["1", "电影"]],
                "list": [["100", "片名", "https://img.test/pic.jpg", "更新至01"]],
                "m": "20",
                "n": "10"
            }
        })
        .to_string();

        let response = build_normalized_method_response(
            "csp_Test",
            "homeContent",
            raw_payload,
            success_report("homeContent"),
        )
        .expect("homeContent should normalize");

        assert_eq!(response.schema_version, SPIDER_SCHEMA_VERSION);
        assert_eq!(response.normalized_payload["class"][0]["type_id"], "1");
        assert_eq!(response.normalized_payload["list"][0]["vod_id"], "100");
        assert_eq!(response.normalized_payload["pagecount"], 20);
        assert_eq!(response.normalized_payload["total"], 10);
    }

    #[test]
    fn rejects_placeholder_home_payload() {
        let raw_payload = serde_json::json!({
            "class": [{}],
            "list": [{}]
        })
        .to_string();

        let error = build_normalized_method_response(
            "csp_Test",
            "homeContent",
            raw_payload,
            success_report("homeContent"),
        )
        .expect_err("placeholder payload must be rejected");

        assert!(
            error.contains("placeholder objects") || error.contains("no canonical class or list")
        );
    }

    #[test]
    fn normalizes_listing_payload_from_compact_keys() {
        let raw_payload = serde_json::json!({
            "result": {
                "b": [
                    ["200", "分类结果", "https://img.test/item.jpg", "HD"]
                ],
                "pageCount": "8",
                "totalCount": 99
            }
        })
        .to_string();

        let response = build_normalized_method_response(
            "csp_Test",
            "categoryContent",
            raw_payload,
            success_report("categoryContent"),
        )
        .expect("categoryContent should normalize");

        assert_eq!(
            response.normalized_payload["list"][0]["vod_name"],
            "分类结果"
        );
        assert_eq!(response.normalized_payload["pagecount"], 8);
        assert_eq!(response.normalized_payload["total"], 99);
    }
}
