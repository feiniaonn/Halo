use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;
use zip::ZipArchive;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::spider_cmds_runtime::{
    SpiderArtifactAnalysis, SpiderExecutionTarget, SpiderSiteProfile,
};

const KNOWN_HELPER_PORTS: [u16; 3] = [9966, 1072, 9999];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatPackDescriptor {
    pub id: String,
    pub label: String,
    pub jars: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CompatPlan {
    pub execution_target: SpiderExecutionTarget,
    pub required_compat_packs: Vec<String>,
    pub required_helper_ports: Vec<u16>,
}

#[derive(Debug, Clone)]
struct CompatPackDefinition {
    id: &'static str,
    label: &'static str,
    jars: &'static [&'static str],
}

const COMPAT_PACKS: &[CompatPackDefinition] = &[
    CompatPackDefinition {
        id: "legacy-core",
        label: "Legacy Spider Core",
        jars: &["base.jar", "spider.jar"],
    },
    CompatPackDefinition {
        id: "legacy-jsapi",
        label: "Legacy JS API",
        jars: &["custom_jsapi.jar", "remote_spider.jar"],
    },
    CompatPackDefinition {
        id: "legacy-custom-spider",
        label: "Legacy Custom Spider",
        jars: &["custom_spider.jar"],
    },
];

fn compat_pack_definition(pack_id: &str) -> Option<&'static CompatPackDefinition> {
    COMPAT_PACKS.iter().find(|item| item.id == pack_id)
}

pub fn compat_pack_descriptors() -> Vec<CompatPackDescriptor> {
    COMPAT_PACKS
        .iter()
        .map(|item| CompatPackDescriptor {
            id: item.id.to_string(),
            label: item.label.to_string(),
            jars: item.jars.iter().map(|jar| (*jar).to_string()).collect(),
        })
        .collect()
}

pub fn resolve_compat_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("resources").join("jar").join("compat"));
        dirs.push(resource_dir.join("jar").join("compat"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("jar")
                .join("compat"),
        );
        dirs.push(cwd.join("resources").join("jar").join("compat"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            dirs.push(exe_dir.join("resources").join("jar").join("compat"));
            dirs.push(exe_dir.join("jar").join("compat"));
        }
    }

    dirs
}

fn resolve_single_compat_jar(app: &AppHandle, jar_name: &str) -> Option<PathBuf> {
    resolve_compat_dirs(app)
        .into_iter()
        .map(|dir| dir.join(jar_name))
        .find(|candidate| candidate.is_file())
}

pub fn resolve_profile_compat_jars(app: &AppHandle) -> Vec<PathBuf> {
    let mut jars = Vec::new();
    for descriptor in COMPAT_PACKS {
        for jar_name in descriptor.jars {
            if let Some(path) = resolve_single_compat_jar(app, jar_name) {
                if !jars.contains(&path) {
                    jars.push(path);
                }
            }
        }
    }
    jars
}

fn runtime_compat_cache_dir() -> PathBuf {
    if let Some(dir) = dirs::cache_dir() {
        return dir.join("Halo").join("spider-compat");
    }
    std::env::temp_dir().join("Halo").join("spider-compat")
}

fn cache_compat_input_path(raw_jar: &Path) -> PathBuf {
    runtime_compat_cache_dir().join(
        raw_jar
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("compat.jar"),
    )
}

fn cached_jar_is_fresh(source: &Path, cached: &Path) -> bool {
    let source_meta = match std::fs::metadata(source) {
        Ok(meta) => meta,
        Err(_) => return false,
    };
    let cached_meta = match std::fs::metadata(cached) {
        Ok(meta) => meta,
        Err(_) => return false,
    };

    if source_meta.len() != cached_meta.len() {
        return false;
    }

    match (source_meta.modified(), cached_meta.modified()) {
        (Ok(source_modified), Ok(cached_modified)) => cached_modified >= source_modified,
        _ => false,
    }
}

fn ensure_cached_compat_input(raw_jar: &Path) -> Result<PathBuf, String> {
    let cached_jar = cache_compat_input_path(raw_jar);
    if cached_jar.is_file() && cached_jar_is_fresh(raw_jar, &cached_jar) {
        return Ok(cached_jar);
    }

    if let Some(parent) = cached_jar.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    std::fs::copy(raw_jar, &cached_jar).map_err(|err| {
        format!(
            "failed to cache compat jar {} -> {}: {}",
            raw_jar.display(),
            cached_jar.display(),
            err
        )
    })?;

    Ok(cached_jar)
}

pub fn get_native_lib_dir(jar_path: &Path) -> PathBuf {
    let stem = jar_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("spider");
    runtime_compat_cache_dir().join(format!("{stem}-libs"))
}

fn extract_native_libs(jar_path: &Path, native_libs: &[String]) -> Result<PathBuf, String> {
    let lib_dir = get_native_lib_dir(jar_path);
    if !lib_dir.exists() {
        std::fs::create_dir_all(&lib_dir).map_err(|err| err.to_string())?;
    }

    let file = std::fs::File::open(jar_path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;

    for lib_name in native_libs {
        let mut entry = archive.by_name(lib_name).map_err(|err| err.to_string())?;
        let entry_file_name = Path::new(&lib_name)
            .file_name()
            .ok_or_else(|| format!("invalid lib path: {lib_name}"))?;
        let dest_path = lib_dir.join(entry_file_name);

        if !dest_path.exists()
            || std::fs::metadata(&dest_path)
                .map(|m| m.len())
                .unwrap_or(0)
                != entry.size()
        {
            let mut out = std::fs::File::create(&dest_path).map_err(|err| err.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|err| err.to_string())?;
        }
    }

    Ok(lib_dir)
}

async fn prepare_single_compat_jar(app: &AppHandle, raw_jar: &Path) -> Result<PathBuf, String> {
    let cached_input = ensure_cached_compat_input(raw_jar)?;
    let prepared_jar = crate::spider_cmds_dex::ensure_desktop_spider_jar(app, &cached_input).await?;

    // Analyze to find native libs
    let artifact = crate::spider_cmds_runtime::analyze_spider_artifact(raw_jar, &prepared_jar)?;
    if !artifact.native_libs.is_empty() {
        let _ = extract_native_libs(raw_jar, &artifact.native_libs)?;
    }

    Ok(prepared_jar)
}

pub async fn prepare_profile_compat_jars(app: &AppHandle) -> Vec<PathBuf> {
    let mut prepared = Vec::new();
    for raw_jar in resolve_profile_compat_jars(app) {
        match prepare_single_compat_jar(app, &raw_jar).await {
            Ok(path) => {
                if !prepared.contains(&path) {
                    prepared.push(path);
                }
            }
            Err(err) => {
                crate::spider_cmds::append_spider_debug_log(&format!(
                    "[SpiderCompat] failed to prepare profile compat jar {}: {}",
                    raw_jar.display(),
                    err
                ));
            }
        }
    }
    prepared
}

pub fn resolve_compat_pack_jars(
    app: &AppHandle,
    pack_ids: &[String],
) -> (Vec<PathBuf>, Vec<String>) {
    let mut found = Vec::new();
    let mut missing = Vec::new();

    for pack_id in pack_ids {
        let Some(definition) = compat_pack_definition(pack_id) else {
            missing.push(pack_id.clone());
            continue;
        };

        let mut pack_complete = true;
        for jar_name in definition.jars {
            match resolve_single_compat_jar(app, jar_name) {
                Some(path) => {
                    if !found.contains(&path) {
                        found.push(path);
                    }
                }
                None => pack_complete = false,
            }
        }

        if !pack_complete {
            missing.push(pack_id.clone());
        }
    }

    (found, missing)
}

pub async fn prepare_compat_pack_jars(
    app: &AppHandle,
    pack_ids: &[String],
) -> Result<(Vec<PathBuf>, Vec<String>), String> {
    let (raw_jars, missing) = resolve_compat_pack_jars(app, pack_ids);
    let mut prepared = Vec::new();

    for raw_jar in raw_jars {
        let prepared_jar = prepare_single_compat_jar(app, &raw_jar).await?;
        if !prepared.contains(&prepared_jar) {
            prepared.push(prepared_jar);
        }
    }

    Ok((prepared, missing))
}

fn collect_known_helper_ports(input: &str, ports: &mut BTreeSet<u16>) {
    let lowered = input.to_ascii_lowercase();
    for port in KNOWN_HELPER_PORTS {
        let numeric = port.to_string();
        let localhost = format!("localhost:{numeric}");
        let local_ip = format!("127.0.0.1:{numeric}");
        if lowered.contains(&localhost) || lowered.contains(&local_ip) {
            ports.insert(port);
        }
    }
}

async fn load_ext_or_common_config_text(ext: &str) -> Option<String> {
    let trimmed = ext.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let client = crate::media_cmds::build_client().ok()?;
        let response = client
            .get(trimmed)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .ok()?;
        return response.text().await.ok();
    }

    let parsed = serde_json::from_str::<serde_json::Value>(trimmed).ok()?;
    let common_config_url = parsed
        .get("commonConfig")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))?;

    let client = crate::media_cmds::build_client().ok()?;
    let response = client
        .get(common_config_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    response.text().await.ok()
}

pub async fn detect_helper_ports(ext: &str) -> Vec<u16> {
    let mut ports = BTreeSet::new();
    collect_known_helper_ports(ext, &mut ports);

    if let Some(extra_text) = load_ext_or_common_config_text(ext).await {
        collect_known_helper_ports(&extra_text, &mut ports);
    }

    ports.into_iter().collect()
}

fn derive_pack_ids_from_tokens(tokens: &[String], packs: &mut BTreeSet<String>) {
    let joined = tokens.join(" ").to_ascii_lowercase();
    if joined.contains("appysv2") || joined.contains("apprj") || joined.contains("hxq") {
        packs.insert("legacy-custom-spider".to_string());
        packs.insert("legacy-jsapi".to_string());
    }
}

pub fn build_compat_plan(
    app: &AppHandle,
    _artifact: &SpiderArtifactAnalysis,
    site_key: &str,
    api_class: &str,
    ext: &str,
    site_profile: Option<&SpiderSiteProfile>,
    helper_ports: &[u16],
) -> CompatPlan {
    let mut packs = BTreeSet::new();
    let mut tokens = vec![
        site_key.trim().to_string(),
        api_class.trim().to_string(),
        ext.trim().to_string(),
    ];

    if let Some(profile) = site_profile {
        tokens.push(profile.class_name.clone());
        tokens.extend(profile.native_methods.iter().cloned());
        if profile.needs_context_shim {
            packs.insert("legacy-core".to_string());
        }
    }

    if !helper_ports.is_empty() {
        packs.insert("legacy-jsapi".to_string());
        packs.insert("legacy-custom-spider".to_string());
    }

    if ext.to_ascii_lowercase().contains(".js")
        || ext.to_ascii_lowercase().contains("drpy")
        || ext.to_ascii_lowercase().contains("commonconfig")
    {
        packs.insert("legacy-jsapi".to_string());
    }

    derive_pack_ids_from_tokens(&tokens, &mut packs);

    let required_compat_packs: Vec<String> = packs.into_iter().collect();
    let _ = resolve_compat_pack_jars(app, &required_compat_packs);

    let execution_target = if !helper_ports.is_empty() {
        SpiderExecutionTarget::DesktopHelper
    } else if !required_compat_packs.is_empty()
        || site_profile
            .as_ref()
            .map(|profile| profile.needs_context_shim)
            .unwrap_or(false)
    {
        SpiderExecutionTarget::DesktopCompatPack
    } else {
        SpiderExecutionTarget::DesktopDirect
    };

    CompatPlan {
        execution_target,
        required_compat_packs,
        required_helper_ports: helper_ports.to_vec(),
    }
}

pub fn augment_site_profile(
    mut site_profile: SpiderSiteProfile,
    compat_plan: &CompatPlan,
) -> SpiderSiteProfile {
    site_profile.needs_context_shim =
        site_profile.has_context_init && !site_profile.has_non_context_init;
    site_profile.required_compat_packs = compat_plan.required_compat_packs.clone();
    site_profile.required_helper_ports = compat_plan.required_helper_ports.clone();
    site_profile.recommended_target = compat_plan.execution_target.clone();
    site_profile.routing_reason = Some(match compat_plan.execution_target {
        SpiderExecutionTarget::DesktopHelper => format!(
            "localhost helper detected on ports {}",
            compat_plan
                .required_helper_ports
                .iter()
                .map(u16::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        SpiderExecutionTarget::DesktopCompatPack => {
            if site_profile.needs_context_shim {
                "site declares Context-aware init and is routed through desktop compatibility packs"
                    .to_string()
            } else {
                "artifact or site profile requires desktop compatibility packs".to_string()
            }
        }
        SpiderExecutionTarget::DesktopDirect => {
            "artifact is ready for direct desktop execution".to_string()
        }
    });
    site_profile
}
