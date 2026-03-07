use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::fs;

use sha2::{Digest, Sha256};

use crate::spider_cmds_runtime::{
    analyze_spider_artifact, build_prefetch_result, PreparedSpiderJar,
};

const SPIDER_LOG_DIR_NAME: &str = "logs";
const SPIDER_LOG_FILE_NAME: &str = "spider_debug.log";
const SPIDER_LOG_MAX_BYTES: u64 = 4 * 1024 * 1024;
const SPIDER_LOG_MAX_BACKUPS: usize = 5;
const SPIDER_LOG_RETENTION_DAYS: u64 = 14;
static SPIDER_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn looks_like_jar_bytes(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && bytes[0] == 0x50 && bytes[1] == 0x4B
}

fn parse_spider_url_and_md5(spider_url_raw: &str) -> (String, Option<String>) {
    let mut parts = spider_url_raw.split(';').map(str::trim);
    let url = parts.next().unwrap_or("").to_string();
    let mut expected_md5: Option<String> = None;
    while let Some(flag) = parts.next() {
        if flag.eq_ignore_ascii_case("md5") {
            if let Some(value) = parts.next() {
                let normalized = value.trim().to_ascii_lowercase();
                if normalized.len() == 32 && normalized.chars().all(|c| c.is_ascii_hexdigit()) {
                    expected_md5 = Some(normalized);
                }
            }
            break;
        }
    }
    (url, expected_md5)
}

fn build_spider_download_candidates(spider_url: &str) -> Vec<String> {
    let mut candidates = vec![spider_url.to_string()];

    if let Some(rest) = spider_url.strip_prefix("https://jihulab.com/yoursmile2/TVBox/-/raw/") {
        if let Some((branch, path)) = rest.split_once('/') {
            candidates.push(format!(
                "https://raw.githubusercontent.com/yoursmile66/TVBox/{}/{}",
                branch, path
            ));
            candidates.push(format!(
                "https://github.com/yoursmile66/TVBox/raw/{}/{}",
                branch, path
            ));

            if branch.eq_ignore_ascii_case("master") {
                candidates.push(format!(
                    "https://raw.githubusercontent.com/yoursmile66/TVBox/main/{}",
                    path
                ));
                candidates.push(format!(
                    "https://github.com/yoursmile66/TVBox/raw/main/{}",
                    path
                ));
            } else if branch.eq_ignore_ascii_case("main") {
                candidates.push(format!(
                    "https://raw.githubusercontent.com/yoursmile66/TVBox/master/{}",
                    path
                ));
            }
        }
    }

    let mut deduped = Vec::new();
    for candidate in candidates {
        if !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn matches_expected_md5(bytes: &[u8], expected_md5: Option<&str>) -> bool {
    match expected_md5 {
        Some(expected) => format!("{:x}", md5::compute(bytes)) == expected,
        None => true,
    }
}

fn should_fallback_after_prepare_failure(err: &str) -> bool {
    !err.contains("desktop bridge does not execute dex-only spiders yet")
        && !err.contains("Dex spider transform failed")
        && !err.contains("explicit spider hint not found in JVM classpath")
}

pub(crate) async fn resolve_spider_jar_with_fallback(
    app: &AppHandle,
    spider_url: &str,
    method: &str,
) -> Result<PreparedSpiderJar, String> {
    let resolved = match ensure_spider_jar(app, spider_url).await {
        Ok(original_jar_path) => {
            let prepared_jar_path =
                crate::spider_cmds_dex::ensure_desktop_spider_jar(app, &original_jar_path).await?;
            let artifact = analyze_spider_artifact(&original_jar_path, &prepared_jar_path)?;
            Ok(PreparedSpiderJar {
                original_jar_path,
                prepared_jar_path,
                artifact,
            })
        }
        Err(err) => Err(err),
    };

    match resolved {
        Ok(path) => Ok(path),
        Err(primary_err) => {
            let primary_log = format!(
                "[SpiderBridge] Primary spider jar prepare failed for {}: {}",
                method, primary_err
            );
            eprintln!("{}", primary_log);
            append_spider_debug_log(&primary_log);
            if should_fallback_after_prepare_failure(&primary_err) {
                if let Some(fallback_jar) = resolve_halo_spider_jar(app) {
                    println!(
                        "[SpiderBridge] Spider jar prepare failed: {}. Fallback to bundled halo_spider.jar for {}",
                        primary_err, method
                    );
                    append_spider_debug_log(&format!(
                        "[SpiderBridge] Spider jar prepare failed: {}. Fallback to bundled halo_spider.jar for {}",
                        primary_err, method
                    ));
                    let artifact = analyze_spider_artifact(&fallback_jar, &fallback_jar)?;
                    return Ok(PreparedSpiderJar {
                        original_jar_path: fallback_jar.clone(),
                        prepared_jar_path: fallback_jar,
                        artifact,
                    });
                }
            }
            Err(format!(
                "Failed to prepare spider jar: {}. Bundled fallback not used or not found.",
                primary_err
            ))
        }
    }
}

pub(crate) fn resolve_resource_jar_dirs(app: &AppHandle) -> Vec<PathBuf> {
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
}

pub(crate) fn resolve_bridge_jar(app: &AppHandle) -> Result<PathBuf, String> {
    for base_path in resolve_resource_jar_dirs(app) {
        let candidate = base_path.join("bridge.jar");
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("bridge.jar not found in any candidate path".to_string())
}

fn spider_log_lock() -> &'static Mutex<()> {
    SPIDER_LOG_LOCK.get_or_init(|| Mutex::new(()))
}

fn spider_log_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|v| v.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join(SPIDER_LOG_DIR_NAME)
}

fn spider_log_backup_path(log_path: &Path, index: usize) -> PathBuf {
    log_path.with_file_name(format!("{SPIDER_LOG_FILE_NAME}.{index}"))
}

fn rotate_spider_log_if_needed(log_path: &Path) {
    let meta = match std::fs::metadata(log_path) {
        Ok(v) => v,
        Err(_) => return,
    };
    if meta.len() < SPIDER_LOG_MAX_BYTES {
        return;
    }

    let oldest = spider_log_backup_path(log_path, SPIDER_LOG_MAX_BACKUPS);
    let _ = std::fs::remove_file(&oldest);

    for idx in (1..SPIDER_LOG_MAX_BACKUPS).rev() {
        let src = spider_log_backup_path(log_path, idx);
        let dst = spider_log_backup_path(log_path, idx + 1);
        if src.exists() {
            let _ = std::fs::rename(&src, &dst);
        }
    }

    let first_backup = spider_log_backup_path(log_path, 1);
    let _ = std::fs::rename(log_path, &first_backup);
}

fn cleanup_spider_log_backups(log_dir: &Path, now: std::time::SystemTime) {
    let retention = Duration::from_secs(SPIDER_LOG_RETENTION_DAYS * 24 * 60 * 60);
    let prefix = format!("{SPIDER_LOG_FILE_NAME}.");
    let entries = match std::fs::read_dir(log_dir) {
        Ok(v) => v,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|v| v.to_str()) {
            Some(v) => v,
            None => continue,
        };
        if !file_name.starts_with(&prefix) {
            continue;
        }

        let mut should_remove = false;
        if let Some(suffix) = file_name.strip_prefix(&prefix) {
            if let Ok(index) = suffix.parse::<usize>() {
                if index > SPIDER_LOG_MAX_BACKUPS {
                    should_remove = true;
                }
            } else {
                should_remove = true;
            }
        }

        if !should_remove {
            if let Ok(meta) = std::fs::metadata(&path) {
                if let Ok(modified) = meta.modified() {
                    if now.duration_since(modified).unwrap_or_default() > retention {
                        should_remove = true;
                    }
                }
            }
        }

        if should_remove {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(crate) fn append_spider_debug_log(text: &str) {
    let lock = spider_log_lock();
    let _guard = match lock.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    let log_dir = spider_log_dir();
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let log_path = log_dir.join(SPIDER_LOG_FILE_NAME);
    rotate_spider_log_if_needed(&log_path);
    cleanup_spider_log_backups(&log_dir, std::time::SystemTime::now());

    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(file, "{text}");
    }
}

/// Helper to download the spider JAR if not already cached.
async fn ensure_spider_jar(_app: &AppHandle, spider_url_raw: &str) -> Result<PathBuf, String> {
    if spider_url_raw.is_empty() {
        return Err("Spider URL is empty".into());
    }

    // TVBox config may append checksum metadata, e.g. ".../xx.png;md5;4343..."
    let (spider_url, expected_md5) = parse_spider_url_and_md5(spider_url_raw);
    let spider_url = spider_url.trim();
    if spider_url.is_empty() {
        return Err("Spider URL is empty after normalization".to_string());
    }

    if spider_url.starts_with("file://") {
        let mut path = spider_url.trim_start_matches("file:///").to_string();
        #[cfg(target_os = "windows")]
        {
            path = path.replace("/", "\\");
        }
        let local_path = PathBuf::from(&path);
        if !local_path.exists() {
            return Err(format!("Local spider file not found: {}", path));
        }
        let bytes = fs::read(&local_path).await.map_err(|e| e.to_string())?;
        if !looks_like_jar_bytes(&bytes) {
            return Err(format!(
                "Local spider file is not a valid jar (zip header missing): {}",
                path
            ));
        }
        if !matches_expected_md5(&bytes, expected_md5.as_deref()) {
            return Err(format!(
                "Local spider file MD5 mismatch: expected={}, path={}",
                expected_md5.as_deref().unwrap_or(""),
                path
            ));
        }
        return Ok(local_path);
    }

    let storage_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|v| v.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("spiders");
    if !storage_dir.exists() {
        fs::create_dir_all(&storage_dir)
            .await
            .map_err(|e| e.to_string())?;
    }

    let mut hasher = Sha256::new();
    hasher.update(spider_url.as_bytes());
    let hash = format!("{:x}.jar", hasher.finalize());
    let jar_path = storage_dir.join(&hash);

    if jar_path.exists() {
        match fs::read(&jar_path).await {
            Ok(cached) if looks_like_jar_bytes(&cached) => {
                // Accept cached file if it's a valid JAR regardless of MD5:
                // the remote file may have been updated since the config was published.
                return Ok(jar_path);
            }
            Ok(_) => {
                let _ = fs::remove_file(&jar_path).await;
                append_spider_debug_log(&format!(
                    "[SpiderBridge] Removed invalid cached spider file (not a JAR): {}",
                    jar_path.display()
                ));
            }
            Err(_) => {
                let _ = fs::remove_file(&jar_path).await;
            }
        }
    }

    let client = crate::media_cmds::build_client()?;
    let candidate_urls = build_spider_download_candidates(spider_url);
    let mut attempt_errors: Vec<String> = Vec::new();
    let mut downloaded: Option<(Vec<u8>, String)> = None;

    for candidate_url in candidate_urls {
        if candidate_url != spider_url {
            let mirror_log = format!(
                "[SpiderBridge] Trying spider mirror: {} -> {}",
                spider_url, candidate_url
            );
            println!("{}", mirror_log);
            append_spider_debug_log(&mirror_log);
        }

        let response = match client.get(&candidate_url).send().await {
            Ok(response) => response,
            Err(err) => {
                attempt_errors.push(format!("{} -> {}", candidate_url, err));
                continue;
            }
        };

        if !response.status().is_success() {
            attempt_errors.push(format!("{} -> HTTP {}", candidate_url, response.status()));
            continue;
        }

        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(err) => {
                attempt_errors.push(format!("{} -> {}", candidate_url, err));
                continue;
            }
        };

        if !looks_like_jar_bytes(bytes.as_ref()) {
            attempt_errors.push(format!(
                "{} -> downloaded content is not a valid jar",
                candidate_url
            ));
            continue;
        }

        if !matches_expected_md5(bytes.as_ref(), expected_md5.as_deref()) {
            // MD5 mismatch usually means the server updated the JAR after the config was published.
            // Treat as a soft warning: cache and use the new file anyway instead of rejecting it.
            let warn = format!(
                "[SpiderBridge] WARNING: Downloaded spider MD5 mismatch (expected={}, url={}). Server may have updated the file; using downloaded JAR anyway.",
                expected_md5.as_deref().unwrap_or(""),
                candidate_url
            );
            println!("{}", warn);
            append_spider_debug_log(&warn);
        }

        downloaded = Some((bytes.to_vec(), candidate_url));
        break;
    }

    let (bytes, downloaded_from) = downloaded.ok_or_else(|| {
        format!(
            "Failed to download target spider JAR from all candidates: {}",
            attempt_errors.join(" | ")
        )
    })?;

    if downloaded_from != spider_url {
        let success_log = format!(
            "[SpiderBridge] Spider mirror download succeeded: {}",
            downloaded_from
        );
        println!("{}", success_log);
        append_spider_debug_log(&success_log);
    }

    fs::write(&jar_path, bytes)
        .await
        .map_err(|e| e.to_string())?;

    Ok(jar_path)
}

/// tauri command to trigger searchContent
#[tauri::command]
pub async fn spider_search(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
    keyword: String,
    quick: bool,
) -> Result<String, String> {
    crate::spider_cmds_exec::execute_spider_method(
        &app,
        &spider_url,
        &site_key,
        &api_class,
        &ext,
        "searchContent",
        vec![("string", keyword), ("bool", quick.to_string())],
    )
    .await
}

/// tauri command to trigger homeContent
#[tauri::command]
pub async fn spider_home(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
) -> Result<String, String> {
    crate::spider_cmds_exec::execute_spider_method(
        &app,
        &spider_url,
        &site_key,
        &api_class,
        &ext,
        "homeContent",
        vec![("bool", "false".to_string())],
    )
    .await
}

/// tauri command to trigger categoryContent
#[tauri::command]
pub async fn spider_category(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
    tid: String,
    pg: u32,
) -> Result<String, String> {
    crate::spider_cmds_exec::execute_spider_method(
        &app,
        &spider_url,
        &site_key,
        &api_class,
        &ext,
        "categoryContent",
        vec![
            ("string", tid),
            ("string", pg.to_string()),
            ("bool", "false".to_string()),
            ("map", "".to_string()),
        ],
    )
    .await
}

/// tauri command to trigger detailContent
#[tauri::command]
pub async fn spider_detail(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
    ids: Vec<String>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let encoded_ids: Vec<String> = ids.iter().map(|s| STANDARD.encode(s)).collect();

    crate::spider_cmds_exec::execute_spider_method(
        &app,
        &spider_url,
        &site_key,
        &api_class,
        &ext,
        "detailContent",
        vec![("list", encoded_ids.join(","))],
    )
    .await
}

/// tauri command to trigger playerContent
#[tauri::command]
pub async fn spider_player(
    app: tauri::AppHandle,
    spider_url: String,
    site_key: String,
    api_class: String,
    ext: String,
    flag: String,
    id: String,
    vip_flags: Vec<String>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let encoded_flags: Vec<String> = vip_flags.iter().map(|s| STANDARD.encode(s)).collect();

    crate::spider_cmds_exec::execute_spider_method(
        &app,
        &spider_url,
        &site_key,
        &api_class,
        &ext,
        "playerContent",
        vec![
            ("string", flag),
            ("string", id),
            ("list", encoded_flags.join(",")),
        ],
    )
    .await
}

/// Resolve the bundled halo_spider.jar from multiple candidate locations.
/// Returns None if the file cannot be found in any location.
fn resolve_halo_spider_jar(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1. resource_dir (Tauri bundles resources here; unified jar/ folder)
    if let Ok(res_dir) = app.path().resource_dir() {
        candidates.push(
            res_dir
                .join("resources")
                .join("jar")
                .join("halo_spider.jar"),
        );
        candidates.push(res_dir.join("jar").join("halo_spider.jar"));
    }

    // 2. Exe-relative (NSIS install places resources next to exe)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(
                exe_dir
                    .join("resources")
                    .join("jar")
                    .join("halo_spider.jar"),
            );
            candidates.push(exe_dir.join("jar").join("halo_spider.jar"));
        }
    }

    // 3. Dev fallback: src-tauri/resources/local_spiders/
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("src-tauri")
                .join("resources")
                .join("local_spiders")
                .join("halo_spider.jar"),
        );
        candidates.push(
            cwd.join("resources")
                .join("local_spiders")
                .join("halo_spider.jar"),
        );
    }

    let found = candidates.iter().find(|p| p.is_file()).cloned();
    if let Some(ref p) = found {
        println!("[SpiderBridge] halo_spider.jar resolved to: {:?}", p);
    } else {
        eprintln!(
            "[SpiderBridge] halo_spider.jar not found. Searched: {:?}",
            candidates
        );
    }
    found
}

/// Pre-downloads and caches a TVBox spider JAR referenced by `spider_url`.
/// The URL may use the `<url>;md5;<hash>` format. This is a non-blocking prefetch:
/// the frontend should fire-and-forget this after config is loaded so the JAR is
/// ready before the user selects a spider site.
#[tauri::command]
pub async fn prefetch_spider_jar(
    app: tauri::AppHandle,
    spider_url: String,
) -> Result<crate::spider_cmds_runtime::SpiderPrefetchResult, String> {
    if spider_url.is_empty() {
        return Err("spider_url is empty".to_string());
    }
    let prepared = resolve_spider_jar_with_fallback(&app, &spider_url, "prefetch").await?;
    println!(
        "[SpiderBridge] prefetch_spider_jar OK: {}",
        prepared.prepared_jar_path.display()
    );
    Ok(build_prefetch_result(&prepared))
}

/// Returns the absolute path to the bundled halo_spider.jar as a file:// URL.
/// Frontend can use this as the default spiderUrl for sites configured to use the built-in spider.
#[tauri::command]
pub fn get_builtin_spider_jar_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = resolve_halo_spider_jar(&app)
        .ok_or_else(|| "halo_spider.jar not found in bundled resources".to_string())?;

    // Convert to file:// URL (cross-platform safe)
    let url = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
    Ok(url)
}

/// Returns detailed diagnostics about JAR path resolution for debugging release issues.
#[tauri::command]
pub fn get_bridge_diagnostics(app: tauri::AppHandle) -> serde_json::Value {
    let resource_dir = app
        .path()
        .resource_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|e| format!("ERR: {}", e));

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    let halo_spider_path = resolve_halo_spider_jar(&app)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "NOT FOUND".to_string());

    // Try to find bridge.jar
    let bridge_candidates: Vec<String> = {
        let mut paths: Vec<PathBuf> = Vec::new();
        if let Ok(res) = app.path().resource_dir() {
            paths.push(res.join("resources").join("jar").join("bridge.jar"));
            paths.push(res.join("jar").join("bridge.jar"));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                paths.push(dir.join("resources").join("jar").join("bridge.jar"));
                paths.push(dir.join("jar").join("bridge.jar"));
            }
        }
        paths
            .iter()
            .map(|p| {
                format!(
                    "{} [{}]",
                    p.to_string_lossy(),
                    if p.exists() { "OK" } else { "MISSING" }
                )
            })
            .collect()
    };

    let compat_dirs: Vec<String> = crate::spider_compat::resolve_compat_dirs(&app)
        .into_iter()
        .map(|path| {
            format!(
                "{} [{}]",
                path.to_string_lossy(),
                if path.is_dir() { "OK" } else { "MISSING" }
            )
        })
        .collect();

    serde_json::json!({
        "resource_dir": resource_dir,
        "exe_dir": exe_dir,
        "halo_spider_jar": halo_spider_path,
        "bridge_jar_candidates": bridge_candidates,
        "compat_dirs": compat_dirs,
        "compat_packs": crate::spider_compat::compat_pack_descriptors(),
    })
}

#[cfg(test)]
mod tests {
    use super::build_spider_download_candidates;

    #[test]
    fn jihulab_spider_url_gets_github_mirrors() {
        let candidates = build_spider_download_candidates(
            "https://jihulab.com/yoursmile2/TVBox/-/raw/master/Yoursmile.jar",
        );

        assert_eq!(
            candidates.first().map(String::as_str),
            Some("https://jihulab.com/yoursmile2/TVBox/-/raw/master/Yoursmile.jar")
        );
        assert!(candidates.contains(
            &"https://raw.githubusercontent.com/yoursmile66/TVBox/master/Yoursmile.jar".to_string()
        ));
        assert!(candidates.contains(
            &"https://raw.githubusercontent.com/yoursmile66/TVBox/main/Yoursmile.jar".to_string()
        ));
    }

    #[test]
    fn non_jihulab_spider_url_keeps_single_candidate() {
        let candidates = build_spider_download_candidates("https://example.com/custom_spider.jar");
        assert_eq!(
            candidates,
            vec!["https://example.com/custom_spider.jar".to_string()]
        );
    }
}
