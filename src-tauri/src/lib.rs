mod compat_helper;
mod db;
mod icon_extractor;
mod java_runtime;
mod media_bootstrap;
pub mod media_cmds;
mod music;
mod music_control;
mod music_lyrics;
mod music_settings;
mod native_player;
mod settings;
mod shortcut_launcher;
mod spider_artifact_download;
mod spider_bridge_payload;
mod spider_cmds;
mod spider_cmds_dex;
mod spider_daemon;
mod spider_cmds_exec;
mod spider_cmds_profile;
mod spider_cmds_runtime;
mod spider_compat;
pub mod spider_diag;
mod spider_fast_paths;
mod spider_local_runtime_android;
mod spider_local_service;
mod spider_proxy_bridge;
mod spider_response_contract;
mod spider_runtime_contract;
mod spider_task_manager;
mod system_overview;
mod updater;
mod vod_hls_relay;
mod vod_hls_runtime;
mod vod_source_stats;

use db::PlayRecord;
use settings::{
    cancel_migrate_legacy_data, get_app_settings, get_close_behavior, get_migration_progress,
    import_background_asset, migrate_legacy_data, prepare_video_optimizer,
    set_allow_component_download, set_background, set_background_blur, set_close_behavior,
    set_launch_at_login, set_mini_mode_size, set_mini_restore_mode, set_storage_root,
    start_migrate_legacy_data, MigrationController,
};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::OnceLock;
use system_overview::{
    dashboard_system_overview, start_system_overview_sampler, DashboardOverviewState,
};
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size};
use updater::{
    updater_check, updater_download_and_install, updater_get_config, updater_probe_endpoint,
    updater_set_config,
};
use url::Url;

const COVER_DATA_URL_MAX_BYTES: u64 = 8 * 1024 * 1024;
pub(crate) const MPV_TEST_LOG_FILE: &str = "mpv_log.txt";
static MPV_TEST_LOG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(target_os = "windows")]
const SINGLE_INSTANCE_MUTEX_NAME: &str = "Local\\Halo.SingleInstance.com.tauri-app.halo";
#[cfg(target_os = "windows")]
const MAIN_WINDOW_TITLE: &str = "halo";

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn focus_existing_main_window() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };

    let title = to_wide_null(MAIN_WINDOW_TITLE);
    unsafe {
        let hwnd = FindWindowW(None, PCWSTR(title.as_ptr())).unwrap_or_default();
        if !hwnd.0.is_null() {
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

#[cfg(target_os = "windows")]
fn ensure_single_instance() -> Result<bool, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;

    let mutex_name = to_wide_null(SINGLE_INSTANCE_MUTEX_NAME);
    let handle = unsafe { CreateMutexW(None, false, PCWSTR(mutex_name.as_ptr())) }
        .map_err(|e| format!("create single instance mutex failed: {e}"))?;

    let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if already_exists {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(handle);
        }
        focus_existing_main_window();
        return Ok(false);
    }

    let _keep_mutex_handle_open_for_process_lifetime = handle;
    Ok(true)
}

#[cfg(target_os = "windows")]
fn should_enforce_single_instance() -> bool {
    !cfg!(debug_assertions)
}

fn dev_workspace_root() -> std::path::PathBuf {
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        let manifest_path = std::path::PathBuf::from(manifest_dir);
        if let Some(parent) = manifest_path.parent() {
            return parent.to_path_buf();
        }
        return manifest_path;
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let is_src_tauri = cwd
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.eq_ignore_ascii_case("src-tauri"))
        .unwrap_or(false);
    if is_src_tauri {
        return cwd.parent().map(|v| v.to_path_buf()).unwrap_or(cwd);
    }
    cwd
}

pub(crate) fn mpv_test_log_path() -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|v| v.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let base_dir = if cfg!(debug_assertions) {
        dev_workspace_root()
    } else {
        exe_dir
    };
    base_dir.join(MPV_TEST_LOG_FILE)
}

fn mpv_test_log_lock() -> &'static Mutex<()> {
    MPV_TEST_LOG_LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn append_mpv_test_log_line(message: &str) -> Result<(), String> {
    let _guard = mpv_test_log_lock()
        .lock()
        .map_err(|_| "mpv test log lock poisoned".to_string())?;
    let path = mpv_test_log_path();
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    writeln!(file, "[{}] {}", timestamp, message).map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(target_os = "windows")]
fn tune_windows_chrome<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };

    if let Ok(hwnd) = window.hwnd() {
        let corner_pref = DWMWCP_DONOTROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &corner_pref as *const _ as _,
                std::mem::size_of_val(&corner_pref) as u32,
            );
        }

        let border_color: u32 = DWMWA_COLOR_NONE;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &border_color as *const _ as _,
                std::mem::size_of_val(&border_color) as u32,
            );
        }
    }
}

fn normalize_path_input(input: &str) -> String {
    let trimmed = input.trim().trim_matches(|c| c == '"' || c == '\'');

    if let Ok(url) = Url::parse(trimmed) {
        if url.scheme() == "file" {
            if let Ok(path) = url.to_file_path() {
                return path.to_string_lossy().to_string();
            }
        }
    }

    trimmed.to_string()
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        tune_windows_chrome(&w);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        // Guard against corrupted tiny-window state during startup/recovery.
        if let Ok(size) = w.inner_size() {
            if size.width < 500 || size.height < 320 {
                let _ = w.set_size(Size::Logical(LogicalSize::new(1200.0, 700.0)));
                let _ = w.center();
            }
        }
    }
}

fn shutdown_background_processes() {
    tauri::async_runtime::block_on(async {
        crate::spider_daemon::shutdown_daemon().await;
    });
}

#[tauri::command]
fn rust_log(message: String, level: String) {
    match level.to_lowercase().as_str() {
        "error" => eprintln!("[Frontend Error] {}", message),
        "warn" => println!("[Frontend Warn] {}", message),
        _ => println!("[Frontend Info] {}", message),
    }
}

#[tauri::command]
fn clear_mpv_test_log() -> Result<(), String> {
    let _guard = mpv_test_log_lock()
        .lock()
        .map_err(|_| "mpv test log lock poisoned".to_string())?;
    let path = mpv_test_log_path();
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn append_mpv_test_log(message: String) -> Result<(), String> {
    append_mpv_test_log_line(&message)
}

#[tauri::command]
fn get_mpv_test_log_path() -> String {
    mpv_test_log_path().to_string_lossy().to_string()
}

#[tauri::command]
fn get_builtin_mpv_path(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();

        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.push(
                resource_dir
                    .join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
            candidates.push(resource_dir.join("mpv").join("windows").join("mpv.exe"));
        }

        if let Ok(exe) = std::env::current_exe() {
            if let Some(exe_dir) = exe.parent() {
                candidates.push(
                    exe_dir
                        .join("resources")
                        .join("mpv")
                        .join("windows")
                        .join("mpv.exe"),
                );
                candidates.push(exe_dir.join("mpv").join("windows").join("mpv.exe"));
            }
        }

        if let Ok(cwd) = std::env::current_dir() {
            candidates.push(
                cwd.join("src-tauri")
                    .join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
            candidates.push(
                cwd.join("resources")
                    .join("mpv")
                    .join("windows")
                    .join("mpv.exe"),
            );
        }

        for path in candidates {
            if path.is_file() {
                return Ok(path.to_string_lossy().to_string());
            }
        }
        Err("Built-in mpv.exe not found (expected under resources/mpv/windows)".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Built-in mpv path resolution is only implemented on Windows".to_string())
    }
}

#[tauri::command]
async fn extract_icon_data_url(file_path: String) -> Result<String, String> {
    let normalized_path = normalize_path_input(&file_path);
    let path = std::path::Path::new(&normalized_path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    let input_for_extract = normalized_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        icon_extractor::extract_exe_icon_png(&input_for_extract)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(png_bytes) => {
            let b64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes);
            Ok(format!("data:image/png;base64,{}", b64))
        }
        Err(e) => {
            eprintln!("Failed to extract icon: {}", e);
            Err(format!("Failed to extract icon: {}", e))
        }
    }
}
#[tauri::command]
fn launch_path(path: String) -> Result<(), String> {
    let normalized_path = normalize_path_input(&path);
    shortcut_launcher::open_with_shell(&normalized_path)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let normalized_path = normalize_path_input(&path);
    shortcut_launcher::reveal_in_file_manager(&normalized_path)
}

#[derive(Clone, serde::Serialize)]
struct ShortcutFileFingerprint {
    key: String,
    path: String,
    size: u64,
    modified_ms: u128,
}

#[tauri::command]
fn shortcut_get_file_fingerprint(path: String) -> Result<ShortcutFileFingerprint, String> {
    let normalized_path = normalize_path_input(&path);
    let meta =
        std::fs::metadata(&normalized_path).map_err(|e| format!("read metadata failed: {e}"))?;
    if !meta.is_file() {
        return Err("target is not a file".to_string());
    }

    let modified_ms = meta
        .modified()
        .map_err(|e| format!("read modified time failed: {e}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("invalid modified timestamp: {e}"))?
        .as_millis();
    let size = meta.len();
    let normalized_key_path = normalized_path.replace('\\', "/").to_ascii_lowercase();
    let key = format!("{normalized_key_path}:{modified_ms}:{size}");

    Ok(ShortcutFileFingerprint {
        key,
        path: normalized_path,
        size,
        modified_ms,
    })
}

#[derive(Clone, Default, serde::Serialize)]
pub struct CurrentPlayingInfo {
    pub artist: String,
    pub title: String,
    pub cover_path: Option<String>,
    pub cover_data_url: Option<String>,
    pub duration_secs: Option<u64>,
    pub position_secs: Option<u64>,
    pub playback_status: Option<String>,
    pub source_app_id: Option<String>,
    pub source_platform: Option<String>,
}

#[tauri::command]
fn music_get_play_history(limit: i64) -> Result<Vec<PlayRecord>, String> {
    music::aggregated_play_history(limit)
}

#[tauri::command]
fn music_get_top10() -> Result<Vec<PlayRecord>, String> {
    music::aggregated_top10()
}

#[tauri::command]
fn music_get_current(
    current: tauri::State<'_, Arc<Mutex<Option<CurrentPlayingInfo>>>>,
) -> Option<CurrentPlayingInfo> {
    current.lock().ok().and_then(|g| g.clone())
}

/// Read a local cover image file and return a data URL for the frontend.
#[tauri::command]
fn get_cover_data_url(path: String) -> Option<String> {
    let requested = std::path::PathBuf::from(path);
    let canonical_cover = requested.canonicalize().ok()?;
    let covers_base = settings::get_music_data_dir().join("covers");
    let canonical_base = covers_base.canonicalize().unwrap_or(covers_base);
    if !canonical_cover.starts_with(&canonical_base) {
        eprintln!(
            "[music] rejected cover read outside managed covers directory: {}",
            canonical_cover.to_string_lossy()
        );
        return None;
    }

    let meta = std::fs::metadata(&canonical_cover).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > COVER_DATA_URL_MAX_BYTES {
        return None;
    }

    let bytes = std::fs::read(canonical_cover).ok()?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    Some(format!("data:image/jpeg;base64,{}", b64))
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let current_playing: Arc<Mutex<Option<CurrentPlayingInfo>>> = Arc::new(Mutex::new(None));

    #[cfg(target_os = "windows")]
    if should_enforce_single_instance() {
        match ensure_single_instance() {
            Ok(true) => {}
            Ok(false) => return,
            Err(err) => {
                eprintln!("[app] single instance guard failed: {err}");
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_mpv::init())
        .plugin(tauri_plugin_libmpv::init())
        .manage(current_playing.clone())
        .manage(DashboardOverviewState::default())
        .manage(MigrationController::default())
        .invoke_handler(tauri::generate_handler![
            extract_icon_data_url,
            launch_path,
            reveal_path,
            shortcut_get_file_fingerprint,
            music_get_play_history,
            music_get_top10,
            music_get_current,
            music_control::music_control,
            music_control::music_get_control_state,
            music_control::music_get_control_sources,
            music_control::music_get_daily_summary,
            music_lyrics::music_get_lyrics,
            music_lyrics::music_clear_lyrics_cache,
            music_settings::get_music_settings,
            music_settings::set_music_settings,
            get_cover_data_url,
            dashboard_system_overview,
            get_app_settings,
            set_storage_root,
            set_launch_at_login,
            set_close_behavior,
            get_close_behavior,
            set_mini_restore_mode,
            set_mini_mode_size,
            set_allow_component_download,
            set_background,
            set_background_blur,
            import_background_asset,
            prepare_video_optimizer,
            migrate_legacy_data,
            start_migrate_legacy_data,
            cancel_migrate_legacy_data,
            get_migration_progress,
            updater_get_config,
            updater_set_config,
            updater_check,
            updater_download_and_install,
            updater_probe_endpoint,
            media_bootstrap::prepare_media_bootstrap,
            media_cmds::fetch_tvbox_config,
            media_cmds::fetch_text_resource,
            media_cmds::list_vod_site_rankings,
            media_cmds::load_vod_aggregate_search_cache,
            media_cmds::save_vod_aggregate_search_cache,
            media_cmds::load_vod_detail_cache,
            media_cmds::save_vod_detail_cache,
            media_cmds::record_vod_site_success,
            media_cmds::set_media_network_policy,
            media_cmds::get_media_network_policy_status,
            media_cmds::execute_media_transport,
            media_cmds::probe_stream_kind,
            media_cmds::fetch_vod_home,
            media_cmds::fetch_vod_category,
            media_cmds::fetch_vod_search,
            media_cmds::fetch_vod_detail,
            media_cmds::proxy_media,
            media_cmds::resolve_jiexi,
            media_cmds::resolve_wrapped_media_url,
            media_cmds::resolve_jiexi_webview,
            media_cmds::proxy_hls_manifest,
            media_cmds::proxy_hls_segment,
            media_cmds::get_live_proxy_metrics,
            media_cmds::reset_live_proxy_metrics,
            media_cmds::release_live_stream,
            media_cmds::note_live_buffer_anomaly,
            media_cmds::launch_potplayer,
            vod_hls_relay::vod_open_hls_relay_session,
            vod_hls_relay::vod_close_hls_relay_session,
            vod_hls_relay::vod_get_hls_relay_stats,
            spider_cmds::spider_search,
            spider_cmds::spider_search_v2,
            spider_cmds::spider_home,
            spider_cmds::spider_home_v2,
            spider_cmds::spider_category,
            spider_cmds::spider_category_v2,
            spider_cmds::spider_detail,
            spider_cmds::spider_detail_v2,
            spider_cmds::spider_player,
            spider_cmds::spider_player_v2,
            spider_cmds::prefetch_spider_jar,
            spider_cmds_profile::profile_spider_site,
            spider_diag::spider_diagnose_source,
            spider_cmds::get_builtin_spider_jar_path,
            spider_cmds::get_bridge_diagnostics,
            spider_cmds::cancel_spider_tasks,
            spider_cmds_runtime::clear_spider_execution_report,
            spider_cmds_runtime::get_spider_execution_report,
            spider_cmds_runtime::get_spider_feature_flags,
            compat_helper::compat_helper_status,
            compat_helper::compat_helper_start,
            compat_helper::compat_helper_stop,
            compat_helper::compat_helper_trace_last_failure,
            get_builtin_mpv_path,
            native_player::native_player_init_or_attach,
            native_player::native_player_load,
            native_player::native_player_command,
            native_player::native_player_resize,
            native_player::native_player_status,
            native_player::native_player_destroy,
            clear_mpv_test_log,
            append_mpv_test_log,
            get_mpv_test_log_path,
            rust_log,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?Window setup + close behaviour 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.set_decorations(false);
                #[cfg(target_os = "windows")]
                tune_windows_chrome(&w);

                let close_handle = handle.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let behavior = settings::get_close_behavior();
                        match behavior.as_str() {
                            "tray" => {
                                if let Some(w) = close_handle.get_webview_window("main") {
                                    let _ = w.hide();
                                }
                            }
                            "tray_mini" => {
                                if let Some(w) = close_handle.get_webview_window("main") {
                                    let _ = w.unminimize();
                                    let _ = w.show();
                                    let _ = w.emit("window:force-mini-mode", ());
                                }
                            }
                            _ => {
                                shutdown_background_processes();
                                std::process::exit(0);
                            }
                        }
                    }
                });
            }

            // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?System tray icon 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?
            // Show main window early to reduce perceived startup delay.
            let args: Vec<String> = std::env::args().collect();
            if args.contains(&"--autostart".to_string()) {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            } else {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            {
                let tray_handle = handle.clone();
                let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
                let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = MenuBuilder::new(app)
                    .items(&[&show_item, &hide_item, &quit_item])
                    .build()?;
                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(move |app_handle, event| match event.id().as_ref() {
                        "show" => show_main_window(app_handle),
                        "hide" => {
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                        "quit" => {
                            shutdown_background_processes();
                            std::process::exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event({
                        let h = tray_handle.clone();
                        move |_tray, event| {
                            if let TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            } = event
                            {
                                show_main_window(&h);
                            }
                        }
                    })
                    .build(app)
                    .ok();
            }

            // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?GSMTC music listener (Windows) 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?
            #[cfg(target_os = "windows")]
            {
                let music_handle = handle.clone();
                let music_cp = current_playing.clone();
                let music_stop = Arc::new(AtomicBool::new(false));
                tauri::async_runtime::spawn(async move {
                    music::run_gsmtc_listener(music_handle, music_stop, music_cp).await;
                });
            }

            // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?System overview sampler 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?
            let overview_state = app.state::<DashboardOverviewState>().inner().clone();
            start_system_overview_sampler(handle.clone(), overview_state);

            {
                let daemon_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::spider_daemon::warmup_daemon(&daemon_handle).await;
                });
            }

            // 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?Show / hide based on startup args 闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣捣閻棗銆掑锝呬壕閻庤娲﹂崹璺虹暦缁嬭鏃堝焵椤掑嫬纾奸柕濠忓缁♀偓婵犵數濮撮崐缁樻櫠閺囩姷妫柟顖嗗瞼鍚嬮梺鍝勭灱閸犳牕鐣峰鍡╂Ь闁汇埄鍨遍惄顖炲蓟閿濆绠婚柛鎰级濞堝姊洪崫鍕拱缂佸鐗滅划璇测槈閵忕姷顔撻梺鍛婂姀閺佲晠鏁傞悾宀€顔?
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| eprintln!("error while running tauri application: {e}"));
}
