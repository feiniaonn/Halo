use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tokio::process::Command;
use zip::ZipArchive;

use crate::spider_cmds_runtime::{
    failure_report, store_execution_report, success_report, PreparedSpiderJar,
    SpiderExecutionReport, SpiderExecutionTarget, SpiderSiteProfile,
};

static SPIDER_SITE_PROFILE_CACHE: OnceLock<Mutex<HashMap<String, SpiderSiteProfile>>> =
    OnceLock::new();

fn spider_site_profile_cache() -> &'static Mutex<HashMap<String, SpiderSiteProfile>> {
    SPIDER_SITE_PROFILE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn jar_contains_entry(path: &Path, entry_name: &str) -> bool {
    let normalized_path = clean_path(path);
    let file = match std::fs::File::open(&normalized_path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(_) => return false,
    };
    let exists = archive.by_name(entry_name).is_ok();
    exists
}

fn hash_profile_ext(ext: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    ext.trim().hash(&mut hasher);
    hasher.finish()
}

fn profile_cache_key(
    prepared: &PreparedSpiderJar,
    site_key: &str,
    class_hint: &str,
    ext: &str,
) -> String {
    format!(
        "{}::{}::{}::{:016x}",
        clean_path(&prepared.prepared_jar_path),
        site_key.trim().to_ascii_lowercase(),
        class_hint.trim().to_ascii_lowercase(),
        hash_profile_ext(ext),
    )
}

fn cached_site_profile(cache_key: &str) -> Option<SpiderSiteProfile> {
    let guard = match spider_site_profile_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.get(cache_key).cloned()
}

fn store_site_profile(cache_key: &str, profile: &SpiderSiteProfile) {
    let mut guard = match spider_site_profile_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.insert(cache_key.to_string(), profile.clone());
}

pub(crate) fn clear_spider_site_profile_cache() {
    let mut guard = match spider_site_profile_cache().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.clear();
}

pub(crate) fn resolve_profile_runner_bridge_jar(app: &AppHandle) -> Result<PathBuf, String> {
    const PROFILE_RUNNER_CLASS: &str = "com/halo/spider/SpiderProfileRunner.class";

    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("spider-bridge")
                .join("bridge.new.jar"),
        );
        candidates.push(
            cwd.join("src-tauri")
                .join("spider-bridge")
                .join("bridge.jar"),
        );
    }

    if let Ok(resource_bridge) = crate::spider_cmds::resolve_bridge_jar(app) {
        candidates.push(resource_bridge);
    }

    for candidate in candidates {
        if candidate.is_file() && jar_contains_entry(&candidate, PROFILE_RUNNER_CLASS) {
            return Ok(candidate);
        }
    }

    Err("Profile runner bridge jar not found or missing SpiderProfileRunner".to_string())
}

fn resolve_profile_classpath(app: &AppHandle, compat_jars: &[PathBuf]) -> Result<String, String> {
    let bridge_jar = resolve_profile_runner_bridge_jar(app)?;
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let mut classpath_parts = vec![clean_path(&bridge_jar)];

    if let Ok(runtime_bridge_jar) = crate::spider_cmds::resolve_bridge_jar(app) {
        if runtime_bridge_jar != bridge_jar {
            classpath_parts.push(clean_path(&runtime_bridge_jar));
        }
    }

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
    let cache_key = profile_cache_key(prepared, site_key, class_hint, ext);
    if let Some(cached) = cached_site_profile(&cache_key) {
        let cache_log = format!(
            "[SpiderBridge] Reusing site profile from session cache for {} ({})",
            site_key, cached.class_name
        );
        println!("{}", cache_log);
        crate::spider_cmds::append_spider_debug_log(&cache_log);
        return Ok(cached);
    }

    let compat_jars = crate::spider_compat::prepare_profile_compat_jars(app).await;
    let classpath = resolve_profile_classpath(app, &compat_jars)?;
    let jar_path = clean_path(&prepared.prepared_jar_path);

    let java_bin = crate::java_runtime::resolve_java_binary(app)?;
    let java_home = crate::java_runtime::resolve_java_home(app)?;
    let mut cmd = Command::new(&java_bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg("-noverify")
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(&classpath)
        .arg("com.halo.spider.SpiderProfileRunner")
        .env("JAVA_HOME", java_home)
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
    let profile = crate::spider_compat::augment_site_profile(parsed, &plan);
    store_site_profile(&cache_key, &profile);
    Ok(profile)
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
    let prepared = match crate::spider_cmds::resolve_spider_jar_with_fallback(
        &app,
        &spider_url,
        method,
        Some(&api_class),
    )
    .await
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
    use super::{jar_contains_entry, parse_profile_payload};
    use crate::spider_cmds_runtime::SpiderExecutionTarget;
    use std::io::Write;
    use std::path::Path;

    fn build_test_jar(path: &Path, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

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

    #[test]
    fn detects_profile_runner_class_in_jar() {
        let mut jar_path = std::env::temp_dir();
        jar_path.push(format!(
            "halo-profile-runner-{}.jar",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        build_test_jar(
            &jar_path,
            &[("com/halo/spider/SpiderProfileRunner.class", b"classdata")],
        );

        assert!(jar_contains_entry(
            &jar_path,
            "com/halo/spider/SpiderProfileRunner.class"
        ));
        let _ = std::fs::remove_file(&jar_path);
    }
}
