use halo_lib::vod_playback_diag::{probe_vod_playback_source, VodPlaybackProbeArgs};
use tauri::Manager;

fn take_flag(args: &mut Vec<String>, flag: &str) -> Option<String> {
    let index = args.iter().position(|item| item == flag)?;
    if index + 1 >= args.len() {
        return None;
    }
    let value = args.remove(index + 1);
    args.remove(index);
    Some(value)
}

fn print_usage() {
    eprintln!(
        "Usage: cargo run --manifest-path src-tauri/Cargo.toml --bin vod_playback_diag -- --source <url> [--repo <name|url|index>] [--site <key|name|api|index>] [--verify-mpv]"
    );
}

fn main() {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    let source_url = take_flag(&mut args, "--source")
        .or_else(|| args.first().cloned())
        .unwrap_or_default();
    let repo_selector = take_flag(&mut args, "--repo");
    let site_selector = take_flag(&mut args, "--site");
    let verify_mpv = args.iter().any(|item| item == "--verify-mpv");

    if source_url.trim().is_empty() {
        print_usage();
        std::process::exit(2);
    }

    tauri::Builder::default()
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let handle = app.handle().clone();
            let probe_args = VodPlaybackProbeArgs {
                source_url: source_url.clone(),
                repo_selector: repo_selector.clone(),
                site_selector: site_selector.clone(),
                verify_mpv,
            };
            tauri::async_runtime::spawn(async move {
                match probe_vod_playback_source(&handle, probe_args).await {
                    Ok(report) => {
                        let json = serde_json::to_string_pretty(&report)
                            .unwrap_or_else(|_| "{}".to_string());
                        println!(">>HALO_VOD_PLAYBACK_DIAG<<");
                        println!("{json}");
                        println!(">>HALO_VOD_PLAYBACK_DIAG<<");
                        handle.exit(if report.success { 0 } else { 1 });
                    }
                    Err(err) => {
                        eprintln!("{err}");
                        handle.exit(1);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run vod_playback_diag");
}
