use std::collections::HashSet;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<PathBuf>, candidate: PathBuf) {
    if seen.insert(candidate.clone()) {
        paths.push(candidate);
    }
}

fn bundled_runtime_variants() -> &'static [&'static str] {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        &[
            "java/windows-x64/runtime",
            "java/windows-x64/jdk",
            "java/windows-x64",
            "runtime/java/windows-x64/runtime",
            "runtime/java/windows-x64/jdk",
            "runtime/java/windows-x64",
        ]
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        &[
            "java/windows-arm64/runtime",
            "java/windows-arm64/jdk",
            "java/windows-arm64",
            "runtime/java/windows-arm64/runtime",
            "runtime/java/windows-arm64/jdk",
            "runtime/java/windows-arm64",
        ]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["java/runtime", "java/jdk", "java"]
    }
}

fn java_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "java.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "java"
    }
}

fn collect_java_home_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    if let Ok(value) = std::env::var("HALO_JAVA_HOME") {
        let candidate = PathBuf::from(value.trim());
        if !candidate.as_os_str().is_empty() {
            push_unique_path(&mut paths, &mut seen, candidate);
        }
    }

    if let Ok(value) = std::env::var("JAVA_HOME") {
        let candidate = PathBuf::from(value.trim());
        if !candidate.as_os_str().is_empty() {
            push_unique_path(&mut paths, &mut seen, candidate);
        }
    }

    let mut base_paths = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        base_paths.push(resource_dir.join("resources"));
        base_paths.push(resource_dir);
    }

    if let Ok(cwd) = std::env::current_dir() {
        base_paths.push(cwd.join("src-tauri").join("resources"));
        base_paths.push(cwd.join("resources"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            base_paths.push(exe_dir.join("resources"));
            base_paths.push(exe_dir.to_path_buf());
        }
    }

    for base in base_paths {
        for relative in bundled_runtime_variants() {
            push_unique_path(&mut paths, &mut seen, base.join(relative));
        }
    }

    paths
}

fn normalize_java_home(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        let file_name = candidate
            .file_name()?
            .to_string_lossy()
            .to_ascii_lowercase();
        if file_name == java_binary_name().to_ascii_lowercase() {
            return candidate
                .parent()
                .and_then(Path::parent)
                .map(Path::to_path_buf);
        }
    }

    if candidate.join("bin").join(java_binary_name()).is_file() {
        return Some(candidate.to_path_buf());
    }

    None
}

pub(crate) fn resolve_java_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let candidates = collect_java_home_candidates(app);
    for candidate in &candidates {
        if let Some(java_home) = normalize_java_home(candidate) {
            let java_bin = java_home.join("bin").join(java_binary_name());
            if java_bin.is_file() {
                return Ok(java_bin);
            }
        }
    }

    let rendered_candidates = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "bundled Java runtime not found. Expected java.exe under one of: {rendered_candidates}. \
Run src-tauri\\scripts\\sync_java_runtime.ps1 -JavaHome <path> before packaging."
    ))
}

pub(crate) fn resolve_java_home(app: &AppHandle) -> Result<PathBuf, String> {
    let java_bin = resolve_java_binary(app)?;
    java_bin
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("invalid bundled Java binary path: {}", java_bin.display()))
}
