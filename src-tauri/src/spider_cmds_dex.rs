use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;
use tokio::process::Command;
use zip::ZipArchive;

const DESKTOP_TRANSFORM_VERSION: &str = "v3";
static DEX_TRANSFORM_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn desktop_spider_output_path(jar_path: &Path) -> PathBuf {
    let stem = jar_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("spider");
    jar_path.with_file_name(format!("{stem}.desktop.{DESKTOP_TRANSFORM_VERSION}.jar"))
}

fn desktop_spider_temp_output_path(output_jar: &Path) -> PathBuf {
    PathBuf::from(format!("{}.converting.jar", output_jar.to_string_lossy()))
}

fn dex_transform_lock() -> &'static tokio::sync::Mutex<()> {
    DEX_TRANSFORM_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn transformed_jar_is_fresh(app: &AppHandle, input: &Path, output: &Path) -> bool {
    let input_meta = match std::fs::metadata(input) {
        Ok(meta) => meta,
        Err(_) => return false,
    };
    let output_meta = match std::fs::metadata(output) {
        Ok(meta) => meta,
        Err(_) => return false,
    };
    if validate_transformed_jar(output).is_err() {
        return false;
    }

    let bridge_modified = crate::spider_cmds::resolve_bridge_jar(app)
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok());

    match (input_meta.modified(), output_meta.modified()) {
        (Ok(input_modified), Ok(output_modified)) => {
            if output_modified < input_modified {
                return false;
            }
            if let Some(bridge_modified) = bridge_modified {
                output_modified >= bridge_modified
            } else {
                true
            }
        }
        _ => false,
    }
}

fn resolve_dex_tools_lib_dir(app: &AppHandle) -> Result<PathBuf, String> {
    for base_dir in crate::spider_cmds::resolve_resource_jar_dirs(app) {
        let lib_dir = base_dir.join("dex-tools").join("lib");
        if lib_dir.is_dir() {
            return Ok(lib_dir);
        }
    }
    Err("dex-tools runtime directory not found in bundled resources".to_string())
}

fn transformed_jar_contains_classes(path: &Path) -> Result<bool, String> {
    let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|err| err.to_string())?;
        if entry.name().ends_with(".class") {
            return Ok(true);
        }
    }
    Ok(false)
}

fn validate_transformed_jar(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|err| err.to_string())?;
    if metadata.len() == 0 {
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "Dex spider transform produced an empty jar: {}",
            path.display()
        ));
    }

    if !transformed_jar_contains_classes(path)? {
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "Dex spider transform produced no class entries: {}",
            path.display()
        ));
    }

    Ok(())
}

pub(crate) fn jar_is_dex_only(path: &Path) -> Result<bool, String> {
    let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|err| err.to_string())?;
    let mut has_dex = false;
    let mut has_class = false;

    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|err| err.to_string())?;
        let name = entry.name();
        if name.ends_with(".dex") {
            has_dex = true;
        } else if name.ends_with(".class") {
            has_class = true;
        }
        if has_dex && has_class {
            break;
        }
    }

    Ok(has_dex && !has_class)
}

async fn transform_dex_jar(
    app: &AppHandle,
    input_jar: &Path,
    output_jar: &Path,
) -> Result<(), String> {
    let bridge_jar = crate::spider_cmds::resolve_bridge_jar(app)?;
    let dex_tools_lib_dir = resolve_dex_tools_lib_dir(app)?;
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let classpath = [
        clean_path(&bridge_jar),
        clean_path(&dex_tools_lib_dir.join("*")),
    ]
    .join(cp_separator);

    let java_bin = crate::java_runtime::resolve_java_binary(app)?;
    let java_home = crate::java_runtime::resolve_java_home(app)?;
    let mut cmd = Command::new(&java_bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Xmx768m")
        .arg("-cp")
        .arg(classpath)
        .arg("com.halo.spider.DexSpiderTransformer")
        .arg(clean_path(input_jar))
        .arg(clean_path(output_jar))
        .env("JAVA_HOME", java_home)
        .kill_on_drop(true);

    let log = format!(
        "[SpiderBridge] Transforming dex spider jar for desktop: {} -> {}",
        input_jar.display(),
        output_jar.display()
    );
    crate::spider_cmds::append_spider_debug_log(&log);

    let execution = tokio::time::timeout(Duration::from_secs(90), cmd.output());
    let output = match execution.await {
        Ok(Ok(output)) => output,
        Ok(Err(err)) => return Err(format!("Failed to spawn dex transformer: {err}")),
        Err(_) => return Err("Dex spider transformation timed out".to_string()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge] Dex transformer stdout:\n{stdout}"
        ));
    }
    if !stderr.is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderBridge] Dex transformer stderr:\n{stderr}"
        ));
    }

    if !output.status.success() {
        return Err(format!(
            "Dex spider transform failed (exit={}): {}",
            output.status.code().unwrap_or(-1),
            if !stderr.is_empty() { stderr } else { stdout }
        ));
    }

    if !output_jar.is_file() {
        return Err("Dex spider transform finished without producing output jar".to_string());
    }

    validate_transformed_jar(output_jar)?;

    Ok(())
}

pub(crate) async fn ensure_desktop_spider_jar(
    app: &AppHandle,
    jar_path: &Path,
) -> Result<PathBuf, String> {
    if !jar_is_dex_only(jar_path)? {
        return Ok(jar_path.to_path_buf());
    }

    let output_jar = desktop_spider_output_path(jar_path);
    if output_jar.is_file() && transformed_jar_is_fresh(app, jar_path, &output_jar) {
        return Ok(output_jar);
    }

    let _guard = dex_transform_lock().lock().await;
    if output_jar.is_file() && transformed_jar_is_fresh(app, jar_path, &output_jar) {
        return Ok(output_jar);
    }

    let temp_output_jar = desktop_spider_temp_output_path(&output_jar);
    if temp_output_jar.exists() {
        let _ = std::fs::remove_file(&temp_output_jar);
    }

    transform_dex_jar(app, jar_path, &output_jar).await?;
    Ok(output_jar)
}

#[cfg(test)]
mod tests {
    use super::{desktop_spider_temp_output_path, jar_is_dex_only, validate_transformed_jar};
    use std::io::Write;
    use std::path::PathBuf;

    fn temp_jar_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        path.push(format!("halo-spider-{name}-{nanos}.jar"));
        path
    }

    fn build_test_jar(path: &std::path::Path, entries: &[(&str, &[u8])]) {
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
    fn detects_dex_only_archive() {
        let jar = temp_jar_path("dex-only");
        build_test_jar(
            &jar,
            &[("classes.dex", b"dex"), ("assets/config.json", b"{}")],
        );
        assert!(jar_is_dex_only(&jar).unwrap());
        let _ = std::fs::remove_file(jar);
    }

    #[test]
    fn ignores_regular_class_archive() {
        let jar = temp_jar_path("class");
        build_test_jar(&jar, &[("com/example/Test.class", b"classdata")]);
        assert!(!jar_is_dex_only(&jar).unwrap());
        let _ = std::fs::remove_file(jar);
    }

    #[test]
    fn rejects_classless_transformed_archive() {
        let jar = temp_jar_path("classless-output");
        build_test_jar(
            &jar,
            &[("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\n")],
        );
        let err = validate_transformed_jar(&jar).unwrap_err();
        assert!(err.contains("no class entries"));
        assert!(!jar.exists());
    }

    #[test]
    fn accepts_valid_transformed_archive() {
        let jar = temp_jar_path("valid-output");
        build_test_jar(&jar, &[("com/example/Test.class", b"classdata")]);
        assert!(validate_transformed_jar(&jar).is_ok());
        let _ = std::fs::remove_file(jar);
    }

    #[test]
    fn builds_temp_output_path_next_to_target_jar() {
        let output = PathBuf::from(r"D:\tmp\demo.desktop.v3.jar");
        let temp = desktop_spider_temp_output_path(&output);
        assert_eq!(
            temp,
            PathBuf::from(r"D:\tmp\demo.desktop.v3.jar.converting.jar")
        );
    }
}
