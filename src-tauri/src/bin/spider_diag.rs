use halo_lib::spider_diag::diagnose_spider_source;
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
        "Usage: cargo run --manifest-path src-tauri/Cargo.toml --bin spider_diag -- --source <url> [--repo <name|url|index>] [--site <key|name|api|index>]"
    );
}

fn main() {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    let source_url = take_flag(&mut args, "--source")
        .or_else(|| args.first().cloned())
        .unwrap_or_default();
    let repo_selector = take_flag(&mut args, "--repo");
    let site_selector = take_flag(&mut args, "--site");

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
            let source_url = source_url.clone();
            let repo_selector = repo_selector.clone();
            let site_selector = site_selector.clone();
            tauri::async_runtime::spawn(async move {
                match diagnose_spider_source(&handle, source_url, repo_selector, site_selector)
                    .await
                {
                    Ok(report) => {
                        let json = serde_json::to_string_pretty(&report)
                            .unwrap_or_else(|_| "{}".to_string());
                        println!(">>HALO_SPIDER_DIAG<<");
                        println!("{json}");
                        println!(">>HALO_SPIDER_DIAG<<");
                        handle.exit(0);
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
        .expect("failed to run spider_diag");
}
