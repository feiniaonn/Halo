use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use tokio::process::Command;

use crate::compat_helper::fetch_last_trace;
use crate::spider_cmds_profile::profile_prepared_spider_site;
use crate::spider_cmds_runtime::{
    failure_report, store_execution_report, success_report, PreparedSpiderJar,
    SpiderExecutionTarget, SpiderSiteProfile,
};

struct BridgeExecutionResult {
    class_name: Option<String>,
    payload: String,
}

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn profile_class_name(site_profile: &Option<SpiderSiteProfile>) -> Option<String> {
    site_profile
        .as_ref()
        .map(|value| value.class_name.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn build_minimal_site_profile(
    prepared: &PreparedSpiderJar,
    app: &AppHandle,
    site_key: &str,
    api_class: &str,
    ext: &str,
    helper_ports: &[u16],
) -> SpiderSiteProfile {
    let compat_plan = crate::spider_compat::build_compat_plan(
        app,
        &prepared.artifact,
        site_key,
        api_class,
        ext,
        None,
        helper_ports,
    );

    SpiderSiteProfile {
        class_name: api_class.trim().to_string(),
        has_context_init: false,
        declares_context_init: false,
        has_non_context_init: false,
        has_native_init: false,
        has_native_content_method: false,
        native_methods: Vec::new(),
        init_signatures: Vec::new(),
        needs_context_shim: false,
        required_compat_packs: compat_plan.required_compat_packs,
        required_helper_ports: helper_ports.to_vec(),
        recommended_target: compat_plan.execution_target,
        routing_reason: Some("profile stage failed before a class was resolved".to_string()),
    }
}

async fn resolve_desktop_execution_context(
    app: &AppHandle,
    prepared: &PreparedSpiderJar,
    site_key: &str,
    api_class: &str,
    ext: &str,
) -> Result<(SpiderSiteProfile, Vec<PathBuf>), String> {
    let helper_ports = crate::spider_compat::detect_helper_ports(ext).await;
    let site_profile =
        match profile_prepared_spider_site(app, prepared, site_key, api_class, ext).await {
            Ok(profile) => profile,
            Err(err) => {
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderBridge] Spider site profile failed for {}: {}",
                    site_key, err
                ));
                build_minimal_site_profile(prepared, app, site_key, api_class, ext, &helper_ports)
            }
        };

    let (compat_jars, missing_compat_packs) =
        crate::spider_compat::prepare_compat_pack_jars(app, &site_profile.required_compat_packs)
            .await?;
    if !missing_compat_packs.is_empty() {
        return Err(format!(
            "Missing desktop compatibility pack(s): {}",
            missing_compat_packs.join(", ")
        ));
    }

    if !site_profile.required_helper_ports.is_empty() {
        crate::compat_helper::ensure_compat_helper_started(
            app,
            &site_profile.required_helper_ports,
        )
        .await
        .map_err(|err| format!("Compat helper unavailable: {err}"))?;
    }

    Ok((site_profile, compat_jars))
}

async fn append_helper_trace_if_needed(
    message: String,
    site_profile: Option<&SpiderSiteProfile>,
) -> String {
    let Some(profile) = site_profile else {
        return message;
    };
    if profile.recommended_target != SpiderExecutionTarget::DesktopHelper {
        return message;
    }

    match fetch_last_trace(&profile.required_helper_ports).await {
        Some(trace) => {
            let mut next = message;
            next.push_str(&format!(
                "\n\n======== Compat Helper Trace ========\nport={} method={} path={} query={} target={} status={} failure={}",
                trace.port,
                trace.method,
                trace.path,
                trace.query,
                trace.target_url.unwrap_or_else(|| "-".to_string()),
                trace
                    .response_status
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "-".to_string()),
                trace.failure.unwrap_or_else(|| "-".to_string())
            ));
            next
        }
        None => message,
    }
}

fn validate_semantic_payload(method: &str, payload: &str) -> Result<(), String> {
    if !matches!(method, "homeContent" | "categoryContent" | "searchContent") {
        return Ok(());
    }

    let parsed = serde_json::from_str::<serde_json::Value>(payload).map_err(|err| {
        format!("Invalid response structure: failed to parse {method} payload: {err}")
    })?;
    let Some(obj) = parsed.as_object() else {
        return Err(format!(
            "Invalid response structure: {method} returned non-object payload"
        ));
    };

    let class_names = obj
        .get("class")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("type_name").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let list_len = obj
        .get("list")
        .and_then(|value| value.as_array())
        .map(|items| items.len())
        .unwrap_or(0);

    if method == "homeContent" {
        const DEFAULT_CLASS_NAMES: [&str; 6] = ["电影", "连续剧", "综艺", "动漫", "4K", "体育"];

        if class_names == DEFAULT_CLASS_NAMES && list_len == 0 {
            return Err(
                "Invalid response structure: spider returned fallback default categories without real content"
                    .to_string(),
            );
        }

        if !obj.contains_key("class") && !obj.contains_key("list") {
            return Err(
                "Invalid response structure: homeContent returned neither class nor list"
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn looks_like_compat_linkage_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("nosuchmethoderror")
        || normalized.contains("nosuchfielderror")
        || normalized.contains("incompatibleclasschangeerror")
        || normalized.contains("abstractmethoderror")
        || normalized.contains("linkageerror")
}

pub(crate) async fn execute_spider_method(
    app: &AppHandle,
    spider_url: &str,
    site_key: &str,
    api_class: &str,
    ext: &str,
    method: &str,
    args: Vec<(&str, String)>,
) -> Result<String, String> {
    let prepared =
        match crate::spider_cmds::resolve_spider_jar_with_fallback(app, spider_url, method).await {
            Ok(prepared) => prepared,
            Err(err) => {
                store_execution_report(failure_report(site_key, method, &err, None, None, None));
                return Err(err);
            }
        };

    let (site_profile, compat_jars) =
        match resolve_desktop_execution_context(app, &prepared, site_key, api_class, ext).await {
            Ok(context) => context,
            Err(err) => {
                let fallback_profile = build_minimal_site_profile(
                    &prepared,
                    app,
                    site_key,
                    api_class,
                    ext,
                    &crate::spider_compat::detect_helper_ports(ext).await,
                );
                store_execution_report(failure_report(
                    site_key,
                    method,
                    &err,
                    Some(prepared.artifact.clone()),
                    Some(fallback_profile.class_name.clone()),
                    Some(fallback_profile),
                ));
                return Err(err);
            }
        };
    let mut site_profile = Some(site_profile);

    let primary_args = args.clone();
    let execution_result = match execute_bridge(
        app,
        &prepared.prepared_jar_path,
        site_key,
        api_class,
        ext,
        method,
        primary_args,
        &compat_jars,
    )
    .await
    {
        Ok(output) => Ok(output),
        Err(err)
            if !compat_jars.is_empty()
                && site_profile
                    .as_ref()
                    .map(|profile| profile.required_helper_ports.is_empty())
                    .unwrap_or(true)
                && looks_like_compat_linkage_error(&err) =>
        {
            crate::spider_cmds::append_spider_debug_log(&format!(
                "[SpiderBridge] compat classpath conflict suspected for {}. Retrying without compat jars.",
                site_key
            ));

            match execute_bridge(
                app,
                &prepared.prepared_jar_path,
                site_key,
                api_class,
                ext,
                method,
                args,
                &[],
            )
            .await
            {
                Ok(output) => {
                    if let Some(profile) = site_profile.as_mut() {
                        profile.required_compat_packs.clear();
                        profile.recommended_target = SpiderExecutionTarget::DesktopDirect;
                        profile.routing_reason = Some(
                            "compat pack linkage conflict detected; fell back to clean desktop classpath"
                                .to_string(),
                        );
                    }
                    Ok(output)
                }
                Err(fallback_err) => {
                    crate::spider_cmds::append_spider_debug_log(&format!(
                        "[SpiderBridge] clean classpath retry failed for {}: {}",
                        site_key, fallback_err
                    ));
                    Err(fallback_err)
                }
            }
        }
        Err(err) => Err(err),
    };

    match execution_result {
        Ok(output) => {
            if let Err(err) = validate_semantic_payload(method, &output.payload) {
                store_execution_report(failure_report(
                    site_key,
                    method,
                    &err,
                    Some(prepared.artifact),
                    output
                        .class_name
                        .or_else(|| profile_class_name(&site_profile)),
                    site_profile,
                ));
                return Err(err);
            }

            store_execution_report(success_report(
                site_key,
                method,
                output.class_name.clone(),
                Some(prepared.artifact),
                site_profile,
            ));
            Ok(output.payload)
        }
        Err(err) => {
            let err = append_helper_trace_if_needed(err, site_profile.as_ref()).await;
            store_execution_report(failure_report(
                site_key,
                method,
                &err,
                Some(prepared.artifact),
                profile_class_name(&site_profile),
                site_profile.clone(),
            ));
            Err(err)
        }
    }
}

async fn execute_bridge(
    app: &AppHandle,
    spider_jar_path: &Path,
    site_key: &str,
    class_hint: &str,
    ext: &str,
    method: &str,
    args: Vec<(&str, String)>,
    compat_jars: &[PathBuf],
) -> Result<BridgeExecutionResult, String> {
    let candidate_paths = {
        let mut paths = Vec::new();

        if let Ok(resource_dir) = app.path().resource_dir() {
            paths.push(resource_dir.join("resources").join("jar"));
            paths.push(resource_dir.join("jar"));
        }

        if let Ok(cwd) = std::env::current_dir() {
            paths.push(cwd.join("src-tauri").join("resources").join("jar"));
            paths.push(cwd.join("resources").join("jar"));
        }

        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                paths.push(exe_dir.join("resources").join("jar"));
                paths.push(exe_dir.join("jar"));
            }
        }
        paths
    };

    let mut bridge_jar: Option<PathBuf> = None;
    let mut libs_root: Option<PathBuf> = None;

    for base_path in candidate_paths {
        let potential_bridge_jar = base_path.join("bridge.jar");
        let potential_libs_root = base_path.join("libs");

        if potential_bridge_jar.exists() {
            bridge_jar = Some(potential_bridge_jar);
            if potential_libs_root.exists() {
                libs_root = Some(potential_libs_root);
            }
            break;
        }
    }

    let bridge_jar =
        bridge_jar.ok_or_else(|| "bridge.jar not found in any candidate path".to_string())?;
    let bridge_jar_cleaned = clean_path(&bridge_jar);
    let spider_jar_cleaned = clean_path(spider_jar_path);
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let mut classpath_parts = vec![bridge_jar_cleaned.clone()];

    let class_hint_lower = class_hint.to_ascii_lowercase();
    let needs_anotherds_fallback =
        class_hint_lower.contains("apprj") || class_hint_lower.contains("hxq");
    if needs_anotherds_fallback {
        let mut fallback_candidates: Vec<PathBuf> = Vec::new();
        if let Some(jar_root) = libs_root.as_ref().and_then(|root| root.parent()) {
            fallback_candidates.push(jar_root.join("fallbacks").join("anotherds_spider.jar"));
        }
        if let Some(spider_parent) = spider_jar_path.parent() {
            fallback_candidates.push(spider_parent.join("fallbacks").join("anotherds_spider.jar"));
        }
        if let Some(found) = fallback_candidates.into_iter().find(|path| path.is_file()) {
            classpath_parts.push(clean_path(&found));
        }
    }

    for compat_jar in compat_jars {
        if compat_jar.is_file() {
            classpath_parts.push(clean_path(compat_jar));
        }
    }

    if let Some(libs_root) = libs_root.as_ref() {
        let preferred_lang3 = libs_root.join("commons-lang3.jar");
        if preferred_lang3.exists() {
            classpath_parts.push(clean_path(&preferred_lang3));
        }
        classpath_parts.push(clean_path(&libs_root.join("*")));
    } else {
        let log = "[SpiderBridge] libs directory not found; continuing with bridge.jar only";
        println!("{}", log);
        crate::spider_cmds::append_spider_debug_log(log);
    }
    let classpath = classpath_parts.join(cp_separator);

    let mut resolved_ext = ext.to_string();
    if ext.starts_with("http://") || ext.starts_with("https://") {
        if let Ok(client) = crate::media_cmds::build_client() {
            if let Ok(resp) = client.get(ext).send().await {
                if resp.status().is_success() {
                    if let Ok(bytes) = resp.bytes().await {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            resolved_ext = text;
                        } else {
                            resolved_ext = String::from_utf8_lossy(&bytes).into_owned();
                        }
                    }
                }
            }
        }
    } else if ext.starts_with("file://") {
        let mut path = ext.trim_start_matches("file:///").to_string();
        #[cfg(target_os = "windows")]
        {
            path = path.replace("/", "\\");
        }
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                resolved_ext = text;
            } else {
                resolved_ext = String::from_utf8_lossy(&bytes).into_owned();
            }
        }
    }

    let mut cmd = Command::new("java");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge Rust] method: {}, ext originally: '{}', resolved_ext: '{}'",
        method,
        ext.trim(),
        resolved_ext.trim()
    ));

    let lib_dir = crate::spider_compat::get_native_lib_dir(spider_jar_path);

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg(format!("-Dspider.lib.dir={}", clean_path(&lib_dir)))
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(&classpath)
        .arg("com.halo.spider.BridgeRunnerCompat")
        .env("HALO_JAR_PATH", &spider_jar_cleaned)
        .env("HALO_SITE_KEY", site_key)
        .env("HALO_CLASS_HINT", class_hint)
        .env("HALO_EXT", &resolved_ext)
        .env("HALO_METHOD", method)
        .env("HALO_ARG_COUNT", args.len().to_string());

    println!(
        "[SpiderBridge] Invoking {} -> {} (Site: {}, Hint: {})",
        method, class_hint, site_key, spider_jar_cleaned
    );

    for (index, (arg_type, arg_val)) in args.iter().enumerate() {
        cmd.env(format!("HALO_ARG_{}_TYPE", index), arg_type);
        cmd.env(format!("HALO_ARG_{}_VALUE", index), arg_val);
    }

    cmd.kill_on_drop(true);
    let timeout_secs = bridge_timeout_secs(method);
    let execution = tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output());

    match execution.await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            if !stderr.is_empty() {
                eprintln!("[SpiderBridge:Log]\n{}", stderr.trim_end());

                let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[{}] Spider: {} | Method: {}\n{}",
                    timestamp,
                    spider_jar_cleaned,
                    method,
                    stderr.trim_end()
                ));
            }

            if !output.status.success() {
                return Err(format!(
                    "Spider execution failed (Exit {}). Path: {:?}\nStdout: {}\nStderr: {}",
                    output.status.code().unwrap_or(-1),
                    bridge_jar.display(),
                    stdout,
                    stderr
                ));
            }

            let start_tag = ">>HALO_RESPONSE<<";
            let end_tag = ">>HALO_RESPONSE<<";

            if let (Some(start_idx), Some(end_idx)) =
                (stdout.find(start_tag), stdout.rfind(end_tag))
            {
                if start_idx + start_tag.len() < end_idx {
                    let json_payload = &stdout[start_idx + start_tag.len()..end_idx].trim();
                    match serde_json::from_str::<serde_json::Value>(json_payload) {
                        Ok(parsed) => {
                            if let Some(ok_flag) =
                                parsed.get("ok").and_then(|value| value.as_bool())
                            {
                                if ok_flag {
                                    let class_name = parsed
                                        .get("className")
                                        .and_then(|value| value.as_str())
                                        .map(str::trim)
                                        .filter(|value| !value.is_empty())
                                        .map(ToOwned::to_owned);
                                    if let Some(result_value) = parsed.get("result") {
                                        match result_value {
                                            serde_json::Value::Null => Ok(BridgeExecutionResult {
                                                class_name: class_name.clone(),
                                                payload: "{}".to_string(),
                                            }),
                                            serde_json::Value::String(result) => {
                                                if result.is_empty() {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: "{}".to_string(),
                                                    })
                                                } else {
                                                    match serde_json::from_str::<serde_json::Value>(
                                                        result,
                                                    ) {
                                                        Ok(result_val) => {
                                                            if let Some(arr) = result_val.as_array()
                                                            {
                                                                if let Some(first) = arr.first() {
                                                                    Ok(BridgeExecutionResult {
                                                                        class_name: class_name
                                                                            .clone(),
                                                                        payload: first.to_string(),
                                                                    })
                                                                } else {
                                                                    Ok(BridgeExecutionResult {
                                                                        class_name: class_name
                                                                            .clone(),
                                                                        payload: "{}".to_string(),
                                                                    })
                                                                }
                                                            } else {
                                                                Ok(BridgeExecutionResult {
                                                                    class_name: class_name.clone(),
                                                                    payload: result_val.to_string(),
                                                                })
                                                            }
                                                        }
                                                        Err(_) => Ok(BridgeExecutionResult {
                                                            class_name: class_name.clone(),
                                                            payload: result.to_string(),
                                                        }),
                                                    }
                                                }
                                            }
                                            serde_json::Value::Array(arr) => {
                                                if let Some(first) = arr.first() {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: first.to_string(),
                                                    })
                                                } else {
                                                    Ok(BridgeExecutionResult {
                                                        class_name: class_name.clone(),
                                                        payload: "{}".to_string(),
                                                    })
                                                }
                                            }
                                            other => Ok(BridgeExecutionResult {
                                                class_name: class_name.clone(),
                                                payload: other.to_string(),
                                            }),
                                        }
                                    } else {
                                        Ok(BridgeExecutionResult {
                                            class_name,
                                            payload: "{}".to_string(),
                                        })
                                    }
                                } else {
                                    let mut final_err = if let Some(error_msg) =
                                        parsed.get("error").and_then(|value| value.as_str())
                                    {
                                        format!("Spider Java execution failed: {}", error_msg)
                                    } else {
                                        "Bridge execution failed with unparseable JSON.".to_string()
                                    };
                                    if !stderr.trim().is_empty() {
                                        final_err.push_str(&format!(
                                            "\n\n======== Java stderr ========\n{}",
                                            stderr.trim_end()
                                        ));
                                    }
                                    Err(final_err)
                                }
                            } else {
                                let mut err_msg =
                                    format!("Invalid response structure: {}", json_payload);
                                if !stderr.trim().is_empty() {
                                    err_msg.push_str(&format!(
                                        "\n\n======== Java stderr ========\n{}",
                                        stderr.trim_end()
                                    ));
                                }
                                Err(err_msg)
                            }
                        }
                        Err(err) => {
                            Err(format!("Failed to parse spider response. Error: {}.", err))
                        }
                    }
                } else {
                    Err("Empty payload between response delimiters.".to_string())
                }
            } else {
                let first_lines = stdout.lines().take(5).collect::<Vec<_>>().join("\n");
                Err(format!(
                    "Spider bridge failed to return delimited response. Stdout snippet:\n{}\nStderr:\n{}",
                    first_lines,
                    stderr.lines().take(5).collect::<Vec<_>>().join("\n")
                ))
            }
        }
        Ok(Err(err)) => Err(format!("Failed to spawn java process: {}", err)),
        Err(_) => Err(format!(
            "Spider execution timeout exceeded after {timeout_secs}s for method {method}. Process was killed to prevent memory leak."
        )),
    }
}

fn bridge_timeout_secs(method: &str) -> u64 {
    match method {
        "homeContent" => 90,
        "categoryContent" => 120,
        "searchContent" => 120,
        "detailContent" => 75,
        "playerContent" => 60,
        _ => 30,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_semantic_payload;

    #[test]
    fn rejects_fallback_default_categories() {
        let payload = r#"{
            "class":[
                {"type_name":"电影"},
                {"type_name":"连续剧"},
                {"type_name":"综艺"},
                {"type_name":"动漫"},
                {"type_name":"4K"},
                {"type_name":"体育"}
            ],
            "list":[]
        }"#;
        assert!(validate_semantic_payload("homeContent", payload).is_err());
    }

    #[test]
    fn accepts_regular_home_payload() {
        let payload = r#"{
            "class":[{"type_name":"电影"}],
            "list":[{"vod_id":"1","vod_name":"demo"}]
        }"#;
        assert!(validate_semantic_payload("homeContent", payload).is_ok());
    }
}
