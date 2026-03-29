use halo_lib::spider_probe::probe_spider_site_method;
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

fn take_multi_flag(args: &mut Vec<String>, flag: &str) -> Vec<String> {
    let mut values = Vec::new();
    loop {
        let Some(index) = args.iter().position(|item| item == flag) else {
            break;
        };
        if index + 1 >= args.len() {
            break;
        }
        values.push(args.remove(index + 1));
        args.remove(index);
    }
    values
}

fn print_usage() {
    eprintln!(
        "Usage: cargo run --manifest-path src-tauri/Cargo.toml --bin spider_probe -- --source <url> --site <key|name|api|index> --method <homeContent|categoryContent|searchContent|detailContent|playerContent> [--repo <name|url|index>] [--keyword <text>] [--tid <id>] [--pg <n>] [--ids <vod-id>]... [--flag <route>] [--id <episode-id>] [--vip-flag <flag>]..."
    );
}

fn main() {
    let mut args = std::env::args().skip(1).collect::<Vec<_>>();
    let source_url = take_flag(&mut args, "--source")
        .or_else(|| args.first().cloned())
        .unwrap_or_default();
    let repo_selector = take_flag(&mut args, "--repo");
    let site_selector = take_flag(&mut args, "--site").unwrap_or_default();
    let method = take_flag(&mut args, "--method").unwrap_or_default();
    let keyword = take_flag(&mut args, "--keyword");
    let tid = take_flag(&mut args, "--tid");
    let pg = take_flag(&mut args, "--pg").and_then(|value| value.parse::<u32>().ok());
    let ids = take_multi_flag(&mut args, "--ids");
    let flag = take_flag(&mut args, "--flag");
    let id = take_flag(&mut args, "--id");
    let vip_flags = take_multi_flag(&mut args, "--vip-flag");

    if source_url.trim().is_empty()
        || site_selector.trim().is_empty()
        || method.trim().is_empty()
    {
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
            let method = method.clone();
            let keyword = keyword.clone();
            let tid = tid.clone();
            let ids = ids.clone();
            let flag = flag.clone();
            let id = id.clone();
            let vip_flags = vip_flags.clone();
            tauri::async_runtime::spawn(async move {
                match probe_spider_site_method(
                    &handle,
                    source_url,
                    repo_selector,
                    site_selector,
                    method,
                    keyword,
                    tid,
                    pg,
                    ids,
                    flag,
                    id,
                    vip_flags,
                )
                .await
                {
                    Ok(report) => {
                        let json = serde_json::to_string_pretty(&report)
                            .unwrap_or_else(|_| "{}".to_string());
                        println!(">>HALO_SPIDER_PROBE<<");
                        println!("{json}");
                        println!(">>HALO_SPIDER_PROBE<<");
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
        .expect("failed to run spider_probe");
}
