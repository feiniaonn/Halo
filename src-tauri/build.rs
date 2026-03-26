use std::path::PathBuf;
use std::process::Command;
use std::time::SystemTime;

fn latest_modified_in(path: &PathBuf) -> Option<SystemTime> {
    let metadata = std::fs::metadata(path).ok()?;
    if metadata.is_file() {
        return metadata.modified().ok();
    }

    let mut latest = metadata.modified().ok();
    let entries = std::fs::read_dir(path).ok()?;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let entry_modified = latest_modified_in(&entry_path);
        if let Some(candidate) = entry_modified {
            latest = Some(match latest {
                Some(current) if current >= candidate => current,
                _ => candidate,
            });
        }
    }

    latest
}

fn bridge_rebuild_required(manifest_dir: &PathBuf) -> bool {
    let output_jar = manifest_dir
        .join("resources")
        .join("jar")
        .join("bridge.jar");
    let output_modified = std::fs::metadata(&output_jar)
        .ok()
        .and_then(|metadata| metadata.modified().ok());

    let Some(output_modified) = output_modified else {
        return true;
    };

    let inputs = [
        manifest_dir.join("spider-bridge").join("src"),
        manifest_dir.join("spider-bridge").join("patch-src"),
        manifest_dir.join("spider-bridge").join("build_bridge.ps1"),
    ];

    inputs
        .iter()
        .filter_map(latest_modified_in)
        .any(|input_modified| input_modified > output_modified)
}

fn main() {
    println!("cargo:rerun-if-changed=spider-bridge/src");
    println!("cargo:rerun-if-changed=spider-bridge/patch-src");
    println!("cargo:rerun-if-changed=spider-bridge/build_bridge.ps1");

    #[cfg(target_os = "windows")]
    {
        if std::env::var("HALO_SKIP_BRIDGE_BUILD")
            .map(|value| value.trim() == "1")
            .unwrap_or(false)
        {
            println!(
                "cargo:warning=Skipping spider bridge rebuild because HALO_SKIP_BRIDGE_BUILD=1"
            );
        } else {
            let manifest_dir = PathBuf::from(
                std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR missing"),
            );
            let script_path = manifest_dir.join("spider-bridge").join("build_bridge.ps1");
            if script_path.is_file() && bridge_rebuild_required(&manifest_dir) {
                let status = Command::new("powershell")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-File")
                    .arg(&script_path)
                    .current_dir(&manifest_dir)
                    .status()
                    .expect("failed to spawn spider bridge build script");
                if !status.success() {
                    panic!("spider bridge rebuild failed with status {status}");
                }
            } else if script_path.is_file() {
                println!(
                    "cargo:warning=Spider bridge rebuild skipped because outputs are up to date"
                );
            } else {
                println!(
                    "cargo:warning=Spider bridge build script not found: {}",
                    script_path.display()
                );
            }
        }
    }

    tauri_build::build()
}
