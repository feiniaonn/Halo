use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tokio::process::Command;

use crate::spider_cmds_runtime::{
    failure_report, store_execution_report, success_report, PreparedSpiderJar,
    SpiderExecutionReport, SpiderExecutionTarget, SpiderSiteProfile,
};

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn resolve_profile_classpath(app: &AppHandle, compat_jars: &[PathBuf]) -> Result<String, String> {
    let bridge_jar = crate::spider_cmds::resolve_bridge_jar(app)?;
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let mut classpath_parts = vec![clean_path(&bridge_jar)];

    let mut libs_root: Option<PathBuf> = None;
    for base_path in crate::spider_cmds::resolve_resource_jar_dirs(app) {
        let candidate = base_path.join("libs");
        if candidate.is_dir() {
            libs_root = Some(candidate);
            break;
        }
    }

    if let Some(libs_root) = libs_root {
        classpath_parts.push(clean_path(&libs_root.join("*")));
    } else {
        crate::spider_cmds::append_spider_debug_log(
            "[SpiderBridge] profile runner libs directory not found; continuing with bridge.jar only",
        );
    }

    for compat_jar in compat_jars {
        classpath_parts.push(clean_path(compat_jar));
    }

    Ok(classpath_parts.join(cp_separator))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JavaSpiderProfileResponse {
    ok: bool,
    class_name: Option<String>,
    has_context_init: Option<bool>,
    declares_context_init: Option<bool>,
    has_non_context_init: Option<bool>,
    has_native_init: Option<bool>,
    has_native_content_method: Option<bool>,
    worker_reason: Option<String>,
    native_methods: Option<Vec<String>>,
    init_signatures: Option<Vec<String>>,
    error: Option<String>,
}

fn parse_profile_payload(payload: &str) -> Result<SpiderSiteProfile, String> {
    let parsed: JavaSpiderProfileResponse =
        serde_json::from_str(payload).map_err(|err| err.to_string())?;
    if !parsed.ok {
        return Err(parsed
            .error
            .unwrap_or_else(|| "Spider profile runner returned unknown error".to_string()));
    }

    let class_name = parsed
        .class_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Spider profile runner returned empty className".to_string())?;

    Ok(SpiderSiteProfile {
        class_name,
        has_context_init: parsed.has_context_init.unwrap_or(false),
        declares_context_init: parsed.declares_context_init.unwrap_or(false),
        has_non_context_init: parsed.has_non_context_init.unwrap_or(false),
        has_native_init: parsed.has_native_init.unwrap_or(false),
        has_native_content_method: parsed.has_native_content_method.unwrap_or(false),
        native_methods: parsed.native_methods.unwrap_or_default(),
        init_signatures: parsed.init_signatures.unwrap_or_default(),
        needs_context_shim: false,
        required_compat_packs: Vec::new(),
        required_helper_ports: Vec::new(),
        recommended_target: SpiderExecutionTarget::DesktopDirect,
        routing_reason: parsed
            .worker_reason
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

pub(crate) async fn profile_prepared_spider_site(
    app: &AppHandle,
    prepared: &PreparedSpiderJar,
    site_key: &str,
    class_hint: &str,
    ext: &str,
) -> Result<SpiderSiteProfile, String> {
    let compat_jars = crate::spider_compat::prepare_profile_compat_jars(app).await;
    let classpath = resolve_profile_classpath(app, &compat_jars)?;
    let jar_path = clean_path(&prepared.prepared_jar_path);

    let mut cmd = Command::new("java");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(&classpath)
        .arg("com.halo.spider.SpiderProfileRunner")
        .env("HALO_JAR_PATH", &jar_path)
        .env("HALO_SITE_KEY", site_key)
        .env("HALO_CLASS_HINT", class_hint)
        .kill_on_drop(true);

    crate::spider_cmds::append_spider_debug_log(&format!(
        "[SpiderBridge Rust] profiling site={} hint={} jar={}",
        site_key, class_hint, jar_path
    ));

    let execution = tokio::time::timeout(Duration::from_secs(15), cmd.output());
    let output = match execution.await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => return Err(format!("Failed to spawn spider profile runner: {err}")),
        Err(_) => return Err("Spider profile runner timeout exceeded".to_string()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stderr.trim().is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge] Profile runner stderr:\n{}",
            stderr.trim_end()
        ));
    }

    if !output.status.success() {
        return Err(format!(
            "Spider profile runner failed (Exit {}). Stdout: {}\nStderr: {}",
            output.status.code().unwrap_or(-1),
            stdout,
            stderr
        ));
    }

    let start_tag = ">>HALO_PROFILE<<";
    let end_tag = ">>HALO_PROFILE<<";
    let (Some(start_idx), Some(end_idx)) = (stdout.find(start_tag), stdout.rfind(end_tag)) else {
        return Err(format!(
            "Spider profile runner returned no delimited payload. Stdout: {}",
            stdout.lines().take(5).collect::<Vec<_>>().join("\n")
        ));
    };

    if start_idx + start_tag.len() >= end_idx {
        return Err("Spider profile runner returned empty payload".to_string());
    }

    let parsed = parse_profile_payload(stdout[start_idx + start_tag.len()..end_idx].trim())?;
    let helper_ports = crate::spider_compat::detect_helper_ports(ext).await;
    let plan = crate::spider_compat::build_compat_plan(
        app,
        &prepared.artifact,
        site_key,
        class_hint,
        ext,
        Some(&parsed),
        &helper_ports,
    );
    Ok(crate::spider_compat::augment_site_profile(parsed, &plan))
}

#[tauri::command]
pub async fn profile_spider_site(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
) -> SpiderExecutionReport {
    let method = "profile";
    let prepared =
        match crate::spider_cmds::resolve_spider_jar_with_fallback(&app, &spider_url, method).await
        {
            Ok(prepared) => prepared,
            Err(err) => {
                let report = failure_report(&site_key, method, &err, None, None, None);
                store_execution_report(report.clone());
                return report;
            }
        };

    let helper_ports = crate::spider_compat::detect_helper_ports(&ext).await;

    match profile_prepared_spider_site(&app, &prepared, &site_key, &api_class, &ext).await {
        Ok(site_profile) => {
            let report = success_report(
                &site_key,
                method,
                Some(site_profile.class_name.clone()),
                Some(prepared.artifact),
                Some(site_profile),
            );
            store_execution_report(report.clone());
            report
        }
        Err(err) => {
            let plan = crate::spider_compat::build_compat_plan(
                &app,
                &prepared.artifact,
                &site_key,
                &api_class,
                &ext,
                None,
                &helper_ports,
            );
            let report = failure_report(
                &site_key,
                method,
                &err,
                Some(prepared.artifact),
                None,
                Some(SpiderSiteProfile {
                    class_name: api_class.clone(),
                    has_context_init: false,
                    declares_context_init: false,
                    has_non_context_init: false,
                    has_native_init: false,
                    has_native_content_method: false,
                    native_methods: Vec::new(),
                    init_signatures: Vec::new(),
                    needs_context_shim: false,
                    required_compat_packs: plan.required_compat_packs.clone(),
                    required_helper_ports: helper_ports,
                    recommended_target: plan.execution_target,
                    routing_reason: Some(
                        "profile stage failed before a class was resolved".to_string(),
                    ),
                }),
            );
            store_execution_report(report.clone());
            report
        }
    }
}

#[cfg(test)]
mod tests {
    use super::parse_profile_payload;
    use crate::spider_cmds_runtime::SpiderExecutionTarget;

    #[test]
    fn parses_success_profile_payload() {
        let profile = parse_profile_payload(
            r#"{
                "ok": true,
                "className": "com.github.catvod.spider.GuaZi",
                "hasContextInit": true,
                "declaresContextInit": false,
                "hasNonContextInit": true,
                "hasNativeInit": true,
                "hasNativeContentMethod": false,
                "workerReason": "native init method",
                "nativeMethods": ["init(android.content.Context, java.lang.String)"],
                "initSignatures": ["init(android.content.Context, java.lang.String)"],
                "error": ""
            }"#,
        )
        .unwrap();

        assert_eq!(profile.class_name, "com.github.catvod.spider.GuaZi");
        assert!(profile.has_native_init);
        assert_eq!(
            profile.routing_reason.as_deref(),
            Some("native init method")
        );
        assert_eq!(
            profile.recommended_target,
            SpiderExecutionTarget::DesktopDirect
        );
    }
}
