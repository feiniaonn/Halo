use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::spider_cmds_runtime::SpiderExecutionReport;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderProbeSite {
    pub index: usize,
    pub key: String,
    pub name: String,
    pub api_class: String,
    pub spider_url: String,
    pub ext_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderProbeResult {
    pub source_url: String,
    pub selected_repo_url: Option<String>,
    pub method: String,
    pub args: Vec<(String, String)>,
    pub site: SpiderProbeSite,
    pub raw_payload: String,
    pub normalized_payload: Option<Value>,
    pub normalize_error: Option<String>,
    pub validate_error: Option<String>,
    pub execution_report: Option<SpiderExecutionReport>,
}

fn build_method_args(
    method: &str,
    keyword: Option<String>,
    tid: Option<String>,
    pg: Option<u32>,
    ids: Vec<String>,
    flag: Option<String>,
    id: Option<String>,
    vip_flags: Vec<String>,
    quick_search: bool,
) -> Result<Vec<(&'static str, String)>, String> {
    match method {
        "homeContent" => Ok(vec![("bool", "false".to_string())]),
        "categoryContent" => Ok(vec![
            (
                "string",
                tid.ok_or_else(|| "categoryContent requires --tid".to_string())?,
            ),
            ("string", pg.unwrap_or(1).to_string()),
            ("bool", "false".to_string()),
            ("map", String::new()),
        ]),
        "searchContent" => Ok(vec![
            (
                "string",
                keyword.ok_or_else(|| "searchContent requires --keyword".to_string())?,
            ),
            ("bool", quick_search.to_string()),
        ]),
        "detailContent" => {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            if ids.is_empty() {
                return Err("detailContent requires at least one --ids entry".to_string());
            }
            let encoded_ids = ids.into_iter().map(|value| STANDARD.encode(value));
            Ok(vec![("list", encoded_ids.collect::<Vec<_>>().join(","))])
        }
        "playerContent" => {
            use base64::{engine::general_purpose::STANDARD, Engine as _};
            let flag = flag.ok_or_else(|| "playerContent requires --flag".to_string())?;
            let id = id.ok_or_else(|| "playerContent requires --id".to_string())?;
            let encoded_vip_flags = vip_flags
                .into_iter()
                .map(|value| STANDARD.encode(value))
                .collect::<Vec<_>>()
                .join(",");
            Ok(vec![
                ("string", flag),
                ("string", id),
                ("list", encoded_vip_flags),
            ])
        }
        _ => Err(format!(
            "unsupported method: {method}. expected homeContent/categoryContent/searchContent/detailContent/playerContent"
        )),
    }
}

pub async fn probe_spider_site_method(
    app: &AppHandle,
    source_url: String,
    repo_selector: Option<String>,
    site_selector: String,
    method: String,
    keyword: Option<String>,
    tid: Option<String>,
    pg: Option<u32>,
    ids: Vec<String>,
    flag: Option<String>,
    id: Option<String>,
    vip_flags: Vec<String>,
) -> Result<SpiderProbeResult, String> {
    let diagnostic = crate::spider_diag::diagnose_spider_source(
        app,
        source_url.clone(),
        repo_selector.clone(),
        Some(site_selector.clone()),
    )
    .await?;
    let selected_site = diagnostic
        .selected_site
        .ok_or_else(|| format!("site selector not found: {site_selector}"))?;
    let ext_input = if selected_site.site.ext_kind == "empty" {
        String::new()
    } else {
        selected_site.site.ext_input.clone()
    };
    let args = build_method_args(
        method.as_str(),
        keyword,
        tid,
        pg,
        ids,
        flag,
        id,
        vip_flags,
        selected_site.site.quick_search,
    )?;
    let debug_args = args
        .iter()
        .map(|(kind, value)| (kind.to_string(), value.clone()))
        .collect::<Vec<_>>();

    let raw_payload = crate::spider_cmds_exec::execute_spider_method(
        app,
        &selected_site.site.spider_url,
        &selected_site.site.key,
        &selected_site.site.api_class,
        &ext_input,
        &method,
        args,
    )
    .await?;

    let normalized_payload =
        crate::spider_response_contract::normalize_payload(&method, &raw_payload).ok();
    let normalize_error = if normalized_payload.is_none() {
        crate::spider_response_contract::normalize_payload(&method, &raw_payload).err()
    } else {
        None
    };
    let validate_error = normalized_payload.as_ref().and_then(|payload| {
        crate::spider_response_contract::validate_normalized_payload(&method, payload).err()
    });
    let execution_report =
        crate::spider_cmds_runtime::get_method_execution_report(&selected_site.site.key, &method)
            .or_else(|| {
                crate::spider_cmds_runtime::get_spider_execution_report(
                    selected_site.site.key.clone(),
                )
            });

    Ok(SpiderProbeResult {
        source_url,
        selected_repo_url: diagnostic.selected_repo_url,
        method,
        args: debug_args,
        site: SpiderProbeSite {
            index: selected_site.site.index,
            key: selected_site.site.key,
            name: selected_site.site.name,
            api_class: selected_site.site.api_class,
            spider_url: selected_site.site.spider_url,
            ext_kind: selected_site.site.ext_kind,
        },
        raw_payload,
        normalized_payload,
        normalize_error,
        validate_error,
        execution_report,
    })
}
