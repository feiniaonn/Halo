use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum SpiderArtifactKind {
    JvmJar,
    DexOnly,
    DexNative,
    Unknown,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SpiderExecutionTarget {
    DesktopDirect,
    DesktopCompatPack,
    DesktopHelper,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum SpiderFailureKind {
    FetchError,
    TransformError,
    MissingDependency,
    NeedsContextShim,
    NeedsCompatPack,
    NeedsLocalHelper,
    NativeMethodBlocked,
    ClassSelectionError,
    InitError,
    SiteRuntimeError,
    ResponseShapeError,
    Timeout,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderArtifactAnalysis {
    pub artifact_kind: SpiderArtifactKind,
    pub required_runtime: SpiderExecutionTarget,
    pub transformable: bool,
    pub original_jar_path: String,
    pub prepared_jar_path: String,
    pub class_inventory: Vec<String>,
    pub native_libs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderSiteProfile {
    pub class_name: String,
    pub has_context_init: bool,
    pub declares_context_init: bool,
    pub has_non_context_init: bool,
    pub has_native_init: bool,
    pub has_native_content_method: bool,
    pub native_methods: Vec<String>,
    pub init_signatures: Vec<String>,
    pub needs_context_shim: bool,
    pub required_compat_packs: Vec<String>,
    pub required_helper_ports: Vec<u16>,
    pub recommended_target: SpiderExecutionTarget,
    pub routing_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderExecutionReport {
    pub ok: bool,
    pub site_key: String,
    pub method: String,
    pub execution_target: SpiderExecutionTarget,
    pub class_name: Option<String>,
    pub failure_kind: Option<SpiderFailureKind>,
    pub failure_message: Option<String>,
    pub missing_dependency: Option<String>,
    pub checked_at_ms: u64,
    pub artifact: Option<SpiderArtifactAnalysis>,
    pub site_profile: Option<SpiderSiteProfile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderPrefetchResult {
    pub original_jar_path: String,
    pub prepared_jar_path: String,
    pub artifact: SpiderArtifactAnalysis,
}

#[derive(Debug, Clone)]
pub struct PreparedSpiderJar {
    pub original_jar_path: PathBuf,
    pub prepared_jar_path: PathBuf,
    pub artifact: SpiderArtifactAnalysis,
}

static SPIDER_REPORTS: OnceLock<Mutex<HashMap<String, SpiderExecutionReport>>> = OnceLock::new();

fn spider_report_store() -> &'static Mutex<HashMap<String, SpiderExecutionReport>> {
    SPIDER_REPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn normalize_jar_entry_to_class(name: &str) -> Option<String> {
    name.strip_suffix(".class")
        .map(|value| value.trim_start_matches('/').replace('/', "."))
}

fn collect_archive_entries(path: &Path) -> Result<(bool, bool, Vec<String>, Vec<String>), String> {
    let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
    let mut has_dex = false;
    let mut has_class = false;
    let mut spider_classes: Vec<String> = Vec::new();
    let mut other_classes: Vec<String> = Vec::new();
    let mut native_libs: Vec<String> = Vec::new();

    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let name = entry.name().trim().to_string();
        if name.ends_with(".dex") {
            has_dex = true;
            continue;
        }
        if name.ends_with(".so") {
            native_libs.push(name);
            continue;
        }
        if let Some(class_name) = normalize_jar_entry_to_class(&name) {
            has_class = true;
            if class_name.contains(".spider.") {
                if spider_classes.len() < 24 && !spider_classes.contains(&class_name) {
                    spider_classes.push(class_name);
                }
            } else if other_classes.len() < 24 && !other_classes.contains(&class_name) {
                other_classes.push(class_name);
            }
        }
    }

    if spider_classes.len() < 12 {
        for class_name in other_classes {
            if spider_classes.len() >= 12 {
                break;
            }
            if !spider_classes.contains(&class_name) {
                spider_classes.push(class_name);
            }
        }
    }

    native_libs.sort();
    native_libs.dedup();

    Ok((has_dex, has_class, spider_classes, native_libs))
}

pub(crate) fn analyze_spider_artifact(
    original_jar_path: &Path,
    prepared_jar_path: &Path,
) -> Result<SpiderArtifactAnalysis, String> {
    let (has_dex, has_class, _, native_libs) = collect_archive_entries(original_jar_path)?;
    let class_inventory = if prepared_jar_path == original_jar_path {
        let (_, _, classes, _) = collect_archive_entries(prepared_jar_path)?;
        classes
    } else {
        collect_archive_entries(prepared_jar_path)
            .map(|(_, _, classes, _)| classes)
            .unwrap_or_default()
    };

    let artifact_kind = if has_dex && !has_class {
        if native_libs.is_empty() {
            SpiderArtifactKind::DexOnly
        } else {
            SpiderArtifactKind::DexNative
        }
    } else if has_class {
        SpiderArtifactKind::JvmJar
    } else {
        SpiderArtifactKind::Unknown
    };

    let required_runtime = match artifact_kind {
        SpiderArtifactKind::JvmJar => SpiderExecutionTarget::DesktopDirect,
        SpiderArtifactKind::DexOnly if native_libs.is_empty() => {
            SpiderExecutionTarget::DesktopDirect
        }
        SpiderArtifactKind::DexNative | SpiderArtifactKind::Unknown => {
            SpiderExecutionTarget::DesktopCompatPack
        }
        SpiderArtifactKind::DexOnly => SpiderExecutionTarget::DesktopCompatPack,
    };

    Ok(SpiderArtifactAnalysis {
        artifact_kind,
        required_runtime,
        transformable: has_dex && !has_class && native_libs.is_empty(),
        original_jar_path: original_jar_path.to_string_lossy().to_string(),
        prepared_jar_path: prepared_jar_path.to_string_lossy().to_string(),
        class_inventory,
        native_libs,
    })
}

pub(crate) fn classify_spider_failure(
    message: &str,
) -> (SpiderFailureKind, SpiderExecutionTarget, Option<String>) {
    let normalized = message.to_ascii_lowercase();

    if normalized.contains("failed to download target spider jar")
        || normalized.contains("local spider file not found")
        || normalized.contains("not a valid jar")
        || normalized.contains("failed to prepare spider jar")
        || normalized.contains("http ")
    {
        return (
            SpiderFailureKind::FetchError,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("dex spider transform failed")
        || normalized.contains("dex spider transformation timed out")
        || normalized.contains("failed to spawn dex transformer")
    {
        return (
            SpiderFailureKind::TransformError,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("missing desktop compatibility pack")
        || normalized.contains("compat pack missing")
    {
        return (
            SpiderFailureKind::NeedsCompatPack,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("compat helper unavailable")
        || normalized.contains("localhost helper")
        || normalized.contains("needs local helper")
        || normalized.contains("helper failed health checks")
    {
        return (
            SpiderFailureKind::NeedsLocalHelper,
            SpiderExecutionTarget::DesktopHelper,
            None,
        );
    }

    if normalized.contains("noclassdeffounderror") || normalized.contains("classnotfoundexception")
    {
        return (
            SpiderFailureKind::MissingDependency,
            SpiderExecutionTarget::DesktopCompatPack,
            extract_missing_dependency(message),
        );
    }

    if normalized.contains("nosuchmethoderror")
        || normalized.contains("nosuchfielderror")
        || normalized.contains("incompatibleclasschangeerror")
        || normalized.contains("abstractmethoderror")
        || normalized.contains("linkageerror")
    {
        return (
            SpiderFailureKind::NeedsCompatPack,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("android context")
        || normalized.contains("context init")
        || normalized.contains("declares context init")
    {
        return (
            SpiderFailureKind::NeedsContextShim,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("unsatisfiedlinkerror")
        || normalized.contains("native method")
        || normalized.contains("jni")
        || normalized.contains(".so")
    {
        return (
            SpiderFailureKind::NativeMethodBlocked,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    if normalized.contains("no spider class matched key")
        || normalized.contains("explicit spider hint not found in jvm classpath")
        || normalized.contains("explicit spider hint not found in jar")
    {
        return (
            SpiderFailureKind::ClassSelectionError,
            SpiderExecutionTarget::DesktopDirect,
            None,
        );
    }

    if normalized.contains("nullpointerexception")
        || normalized.contains("illegalstateexception")
        || normalized.contains("illegalargumentexception")
        || normalized.contains("indexoutofboundsexception")
    {
        let failure_kind = if normalized.contains("homecontent")
            || normalized.contains("categorycontent")
            || normalized.contains("searchcontent")
            || normalized.contains("detailcontent")
            || normalized.contains("playercontent")
        {
            SpiderFailureKind::SiteRuntimeError
        } else {
            SpiderFailureKind::InitError
        };
        return (failure_kind, SpiderExecutionTarget::DesktopCompatPack, None);
    }

    if normalized.contains("failed to parse spider response")
        || normalized.contains("no json output from spider")
        || normalized.contains("invalid response structure")
        || normalized.contains("delimited response")
        || normalized.contains("empty payload between response delimiters")
    {
        return (
            SpiderFailureKind::ResponseShapeError,
            SpiderExecutionTarget::DesktopDirect,
            None,
        );
    }

    if normalized.contains("timeout") {
        return (
            SpiderFailureKind::Timeout,
            SpiderExecutionTarget::DesktopDirect,
            None,
        );
    }

    if normalized.contains("invoke method failed") {
        return (
            SpiderFailureKind::SiteRuntimeError,
            SpiderExecutionTarget::DesktopCompatPack,
            None,
        );
    }

    (
        SpiderFailureKind::Unknown,
        SpiderExecutionTarget::DesktopCompatPack,
        None,
    )
}

fn extract_missing_dependency(message: &str) -> Option<String> {
    const PATTERNS: [&str; 2] = ["NoClassDefFoundError:", "ClassNotFoundException:"];

    for pattern in PATTERNS {
        if let Some(index) = message.find(pattern) {
            let tail = message[index + pattern.len()..].trim_start();
            let candidate = tail
                .lines()
                .next()
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("")
                .trim_matches(|ch| ch == '\'' || ch == '"' || ch == ',' || ch == ';')
                .replace('/', ".");
            if !candidate.is_empty() {
                return Some(candidate);
            }
        }
    }

    None
}

fn preferred_execution_target(
    artifact: Option<&SpiderArtifactAnalysis>,
    site_profile: Option<&SpiderSiteProfile>,
    fallback: SpiderExecutionTarget,
) -> SpiderExecutionTarget {
    if let Some(profile) = site_profile {
        return profile.recommended_target.clone();
    }
    artifact
        .map(|value| value.required_runtime.clone())
        .unwrap_or(fallback)
}

pub(crate) fn success_report(
    site_key: &str,
    method: &str,
    class_name: Option<String>,
    artifact: Option<SpiderArtifactAnalysis>,
    site_profile: Option<SpiderSiteProfile>,
) -> SpiderExecutionReport {
    let execution_target = preferred_execution_target(
        artifact.as_ref(),
        site_profile.as_ref(),
        SpiderExecutionTarget::DesktopDirect,
    );

    SpiderExecutionReport {
        ok: true,
        site_key: site_key.to_string(),
        method: method.to_string(),
        execution_target,
        class_name,
        failure_kind: None,
        failure_message: None,
        missing_dependency: None,
        checked_at_ms: now_unix_ms(),
        artifact,
        site_profile,
    }
}

pub(crate) fn failure_report(
    site_key: &str,
    method: &str,
    message: &str,
    artifact: Option<SpiderArtifactAnalysis>,
    class_name: Option<String>,
    site_profile: Option<SpiderSiteProfile>,
) -> SpiderExecutionReport {
    let (failure_kind, fallback_target, missing_dependency) = classify_spider_failure(message);
    let execution_target =
        preferred_execution_target(artifact.as_ref(), site_profile.as_ref(), fallback_target);

    SpiderExecutionReport {
        ok: false,
        site_key: site_key.to_string(),
        method: method.to_string(),
        execution_target,
        class_name,
        failure_kind: Some(failure_kind),
        failure_message: Some(message.trim().to_string()),
        missing_dependency,
        checked_at_ms: now_unix_ms(),
        artifact,
        site_profile,
    }
}

pub(crate) fn store_execution_report(report: SpiderExecutionReport) {
    if report.site_key.trim().is_empty() {
        return;
    }

    let mut guard = match spider_report_store().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.insert(report.site_key.clone(), report);
}

#[tauri::command]
pub fn get_spider_execution_report(site_key: String) -> Option<SpiderExecutionReport> {
    let guard = match spider_report_store().lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.get(site_key.trim()).cloned()
}

pub(crate) fn build_prefetch_result(prepared: &PreparedSpiderJar) -> SpiderPrefetchResult {
    SpiderPrefetchResult {
        original_jar_path: prepared.original_jar_path.to_string_lossy().to_string(),
        prepared_jar_path: prepared.prepared_jar_path.to_string_lossy().to_string(),
        artifact: prepared.artifact.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        analyze_spider_artifact, classify_spider_failure, SpiderArtifactKind,
        SpiderExecutionTarget, SpiderFailureKind,
    };
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_jar_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("halo-spider-runtime-{name}-{nanos}.jar"));
        path
    }

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
    fn detects_jvm_jar() {
        let jar = temp_jar_path("jvm");
        build_test_jar(
            &jar,
            &[("com/github/catvod/spider/Test.class", b"classdata")],
        );
        let analysis = analyze_spider_artifact(&jar, &jar).unwrap();
        assert_eq!(analysis.artifact_kind, SpiderArtifactKind::JvmJar);
        assert_eq!(
            analysis.required_runtime,
            SpiderExecutionTarget::DesktopDirect
        );
    }

    #[test]
    fn detects_dex_native_jar() {
        let original = temp_jar_path("dex-native");
        let prepared = temp_jar_path("dex-native-prepared");
        build_test_jar(
            &original,
            &[
                ("classes.dex", b"dexdata"),
                ("lib/arm64-v8a/libdemo.so", b"native"),
            ],
        );
        build_test_jar(
            &prepared,
            &[("com/github/catvod/spider/Demo.class", b"classdata")],
        );
        let analysis = analyze_spider_artifact(&original, &prepared).unwrap();
        assert_eq!(analysis.artifact_kind, SpiderArtifactKind::DexNative);
        assert_eq!(
            analysis.required_runtime,
            SpiderExecutionTarget::DesktopCompatPack
        );
        assert_eq!(
            analysis.native_libs,
            vec!["lib/arm64-v8a/libdemo.so".to_string()]
        );
    }

    #[test]
    fn classifies_missing_dependency_failure() {
        let (kind, target, missing) = classify_spider_failure(
            "java.lang.NoClassDefFoundError: com/google/gson/reflect/TypeToken",
        );
        assert_eq!(kind, SpiderFailureKind::MissingDependency);
        assert_eq!(target, SpiderExecutionTarget::DesktopCompatPack);
        assert_eq!(
            missing.as_deref(),
            Some("com.google.gson.reflect.TypeToken")
        );
    }

    #[test]
    fn classifies_helper_failure() {
        let (kind, target, missing) = classify_spider_failure(
            "compat helper unavailable: localhost helper required for 127.0.0.1:9966",
        );
        assert_eq!(kind, SpiderFailureKind::NeedsLocalHelper);
        assert_eq!(target, SpiderExecutionTarget::DesktopHelper);
        assert!(missing.is_none());
    }

    #[test]
    fn classifies_native_method_failure() {
        let (kind, target, missing) = classify_spider_failure(
            "java.lang.UnsatisfiedLinkError: 'java.lang.String com.github.catvod.spider.TgYunDouBanPan.homeContent(boolean)'",
        );
        assert_eq!(kind, SpiderFailureKind::NativeMethodBlocked);
        assert_eq!(target, SpiderExecutionTarget::DesktopCompatPack);
        assert!(missing.is_none());
    }
}
