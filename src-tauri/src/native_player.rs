use std::collections::HashMap;
use std::ffi::c_void;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_libmpv::{MpvConfig, MpvExt};

#[cfg(target_os = "windows")]
use windows::core::w;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, GetClientRect, IsWindow, IsWindowVisible, SetWindowPos,
    ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_SHOW, WINDOW_EX_STYLE, WS_CHILD,
    WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
};
const VOD_WINDOW_LABEL: &str = "vod_player";
const MPV_DEFAULT_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativePlayerEngine {
    Mpv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub dpi_scale: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub title: Option<String>,
    pub transport_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlayerCommandRequest {
    pub command: String,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlayerLoadResult {
    pub engine: NativePlayerEngine,
    pub acknowledged: bool,
    pub ignored_headers: Vec<String>,
    pub pid: Option<u32>,
    pub runtime_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlayerStatus {
    pub engine: Option<NativePlayerEngine>,
    pub state: String,
    pub first_frame_rendered: bool,
    pub position_ms: Option<f64>,
    pub duration_ms: Option<f64>,
    pub host_attached: bool,
    pub host_visible: bool,
    pub host_width: Option<u32>,
    pub host_height: Option<u32>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub fullscreen: bool,
}

#[derive(Debug, Clone, Default)]
struct NativePlayerSession {
    engine: Option<NativePlayerEngine>,
    bounds: Option<NativeHostBounds>,
    mpv_host_hwnd: Option<isize>,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
struct EmbedBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

static NATIVE_PLAYER_SESSIONS: OnceLock<Mutex<HashMap<String, NativePlayerSession>>> =
    OnceLock::new();

fn native_player_sessions() -> &'static Mutex<HashMap<String, NativePlayerSession>> {
    NATIVE_PLAYER_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_session(window_label: &str) -> NativePlayerSession {
    native_player_sessions()
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(window_label).cloned())
        .unwrap_or_default()
}

fn upsert_session(window_label: &str, mutator: impl FnOnce(&mut NativePlayerSession)) {
    if let Ok(mut sessions) = native_player_sessions().lock() {
        let entry = sessions.entry(window_label.to_string()).or_default();
        mutator(entry);
    }
}

fn clear_session(window_label: &str) {
    if let Ok(mut sessions) = native_player_sessions().lock() {
        sessions.remove(window_label);
    }
}

fn set_session_error(window_label: &str, code: &str, message: impl Into<String>) {
    let message = message.into();
    upsert_session(window_label, |session| {
        session.error_code = Some(code.to_string());
        session.error_message = Some(message);
    });
}

fn clear_session_error(window_label: &str) {
    upsert_session(window_label, |session| {
        session.error_code = None;
        session.error_message = None;
    });
}

fn resolve_effective_label(window: &WebviewWindow, window_label: String) -> String {
    if window_label.trim().is_empty() {
        window.label().to_string()
    } else {
        window_label
    }
}

fn header_value(headers: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    headers.iter().find_map(|(key, value)| {
        if keys
            .iter()
            .any(|candidate| key.eq_ignore_ascii_case(candidate))
        {
            Some(value.clone())
        } else {
            None
        }
    })
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(src).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_contents(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&path, &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn candidate_libmpv_source_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("lib"));
        candidates.push(resource_dir.join("resources").join("lib"));
    }

    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        candidates.push(PathBuf::from(manifest_dir).join("lib"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("src-tauri").join("lib"));
        candidates.push(cwd.join("lib"));
    }

    candidates
}

fn resolve_exe_lib_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| format!("missing executable parent directory: {}", exe.display()))?;
    Ok(exe_dir.join("lib"))
}

fn prepare_libmpv_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let target_lib_dir = resolve_exe_lib_dir()?;
    let wrapper_target = target_lib_dir.join("libmpv-wrapper.dll");
    let libmpv_target = target_lib_dir.join("libmpv-2.dll");
    if wrapper_target.is_file() && libmpv_target.is_file() {
        return Ok(target_lib_dir);
    }

    let source_dir = candidate_libmpv_source_dirs(app)
        .into_iter()
        .find(|path| {
            path.join("libmpv-wrapper.dll").is_file() && path.join("libmpv-2.dll").is_file()
        })
        .ok_or_else(|| {
            "libmpv runtime files are missing (expected libmpv-wrapper.dll and libmpv-2.dll under src-tauri/lib or bundled resources/lib)"
                .to_string()
        })?;

    copy_dir_contents(&source_dir, &target_lib_dir)?;
    Ok(target_lib_dir)
}

fn build_default_mpv_config(app: &AppHandle, wid: i64) -> Result<(MpvConfig, PathBuf), String> {
    let runtime_dir = prepare_libmpv_runtime(app)?;
    let mut initial_options = IndexMap::new();
    initial_options.insert("wid".to_string(), json!(wid));
    initial_options.insert("vo".to_string(), json!("gpu"));
    initial_options.insert("gpu-api".to_string(), json!("opengl"));
    initial_options.insert("hwdec".to_string(), json!("auto"));
    initial_options.insert("cache".to_string(), json!("yes"));
    initial_options.insert("cache-secs".to_string(), json!(20));
    initial_options.insert("cache-pause".to_string(), json!("no"));
    initial_options.insert("cache-pause-wait".to_string(), json!(0));
    initial_options.insert("demuxer-readahead-secs".to_string(), json!(20));
    initial_options.insert("demuxer-max-bytes".to_string(), json!("32MiB"));
    initial_options.insert("demuxer-max-back-bytes".to_string(), json!("8MiB"));
    initial_options.insert("ytdl".to_string(), json!("no"));
    initial_options.insert("hls-bitrate".to_string(), json!("max"));
    initial_options.insert(
        "demuxer-lavf-o".to_string(),
        json!("allowed_extensions=ALL"),
    );
    initial_options.insert("keep-open".to_string(), json!("yes"));
    initial_options.insert("force-window".to_string(), json!("yes"));
    initial_options.insert("background".to_string(), json!("color"));
    initial_options.insert("background-color".to_string(), json!("#000000"));
    initial_options.insert("terminal".to_string(), json!("no"));
    initial_options.insert("osc".to_string(), json!("no"));
    initial_options.insert("input-default-bindings".to_string(), json!("no"));

    let mut observed_properties = IndexMap::new();
    observed_properties.insert("pause".to_string(), "flag".to_string());
    observed_properties.insert("time-pos".to_string(), "double".to_string());
    observed_properties.insert("duration".to_string(), "double".to_string());
    observed_properties.insert("width".to_string(), "int64".to_string());
    observed_properties.insert("height".to_string(), "int64".to_string());
    observed_properties.insert("vo-configured".to_string(), "flag".to_string());
    observed_properties.insert("eof-reached".to_string(), "flag".to_string());
    observed_properties.insert("idle-active".to_string(), "flag".to_string());
    observed_properties.insert("video-zoom".to_string(), "double".to_string());
    observed_properties.insert("panscan".to_string(), "double".to_string());
    observed_properties.insert("aspect".to_string(), "double".to_string());
    observed_properties.insert("fullscreen".to_string(), "flag".to_string());

    Ok((
        MpvConfig {
            initial_options,
            observed_properties,
        },
        runtime_dir,
    ))
}

fn mpv_instance_exists(app: &AppHandle, window_label: &str) -> bool {
    app.mpv()
        .instances
        .lock()
        .map(|instances| instances.contains_key(window_label))
        .unwrap_or(false)
}

fn mpv_command(
    app: &AppHandle,
    window_label: &str,
    name: &str,
    args: Vec<Value>,
) -> Result<(), String> {
    app.mpv()
        .command(name, &args, window_label)
        .map_err(|error| error.to_string())
}

fn set_mpv_property(
    app: &AppHandle,
    window_label: &str,
    property: &str,
    value: Value,
) -> Result<(), String> {
    app.mpv()
        .set_property(property, &value, window_label)
        .map_err(|error| error.to_string())
}

fn get_mpv_property(
    app: &AppHandle,
    window_label: &str,
    property: &str,
    format: &str,
) -> Result<Value, String> {
    app.mpv()
        .get_property(property.to_string(), format.to_string(), window_label)
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn resolve_embed_bounds(
    window: &WebviewWindow,
    bounds: &NativeHostBounds,
) -> Result<EmbedBounds, String> {
    let parent_hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let mut client_rect = RECT::default();
    unsafe {
        GetClientRect(parent_hwnd, &mut client_rect).map_err(|error| error.to_string())?;
    }
    let origin = window.inner_position().map_err(|error| error.to_string())?;
    let default_width = (client_rect.right - client_rect.left).max(320);
    let default_height = (client_rect.bottom - client_rect.top).max(180);
    let width = i32::try_from(bounds.width).unwrap_or(default_width).max(32);
    let height = i32::try_from(bounds.height)
        .unwrap_or(default_height)
        .max(32);
    Ok(EmbedBounds {
        x: bounds.x.saturating_sub(origin.x),
        y: bounds.y.saturating_sub(origin.y),
        width,
        height,
    })
}

#[cfg(target_os = "windows")]
fn inspect_child_host(raw_hwnd: Option<isize>) -> (bool, bool, Option<u32>, Option<u32>) {
    let Some(value) = raw_hwnd else {
        return (false, false, None, None);
    };
    let hwnd = HWND(value as *mut c_void);
    if hwnd.0.is_null() {
        return (false, false, None, None);
    }
    let alive = unsafe { IsWindow(Some(hwnd)).as_bool() };
    if !alive {
        return (false, false, None, None);
    }
    let visible = unsafe { IsWindowVisible(hwnd).as_bool() };
    let mut rect = RECT::default();
    let (width, height) = match unsafe { GetClientRect(hwnd, &mut rect) } {
        Ok(_) => (
            u32::try_from((rect.right - rect.left).max(0)).ok(),
            u32::try_from((rect.bottom - rect.top).max(0)).ok(),
        ),
        Err(_) => (None, None),
    };
    (alive, visible, width, height)
}

#[cfg(target_os = "windows")]
fn destroy_child_host(raw_hwnd: Option<isize>) {
    if let Some(value) = raw_hwnd {
        let hwnd = HWND(value as *mut c_void);
        if !hwnd.0.is_null() {
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn create_child_host(parent_hwnd: HWND, bounds: EmbedBounds) -> Result<HWND, String> {
    let host = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("Static"),
            None,
            WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            Some(parent_hwnd),
            None,
            None,
            None,
        )
    }
    .map_err(|error| format!("create mpv host window failed: {error}"))?;
    unsafe {
        let _ = SetWindowPos(
            host,
            Some(HWND_TOP),
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        let _ = ShowWindow(host, SW_SHOW);
    }
    Ok(host)
}

#[cfg(target_os = "windows")]
fn ensure_mpv_embed_host(
    window: &WebviewWindow,
    window_label: &str,
    bounds: &NativeHostBounds,
) -> Result<i64, String> {
    let embed_bounds = resolve_embed_bounds(window, bounds)?;
    let parent_hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let existing = get_session(window_label).mpv_host_hwnd;
    let hwnd = existing
        .and_then(|raw| {
            let hwnd = HWND(raw as *mut c_void);
            if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)).as_bool() } {
                None
            } else {
                Some(hwnd)
            }
        })
        .unwrap_or_else(|| HWND(std::ptr::null_mut()));

    let host = if hwnd.0.is_null() {
        let created = create_child_host(parent_hwnd, embed_bounds)?;
        upsert_session(window_label, |session| {
            session.mpv_host_hwnd = Some(created.0 as isize);
        });
        created
    } else {
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                embed_bounds.x,
                embed_bounds.y,
                embed_bounds.width,
                embed_bounds.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        hwnd
    };

    Ok(host.0 as isize as i64)
}

#[cfg(not(target_os = "windows"))]
fn ensure_mpv_embed_host(
    _window: &WebviewWindow,
    _window_label: &str,
    _bounds: &NativeHostBounds,
) -> Result<i64, String> {
    Err("native mpv child-host is only implemented on Windows".to_string())
}

fn ensure_mpv_initialized(
    app: &AppHandle,
    window: &WebviewWindow,
    window_label: &str,
    bounds: &NativeHostBounds,
) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let session = get_session(window_label);
        let (host_alive, _, _, _) = inspect_child_host(session.mpv_host_hwnd);
        if mpv_instance_exists(app, window_label) && !host_alive {
            let _ = app.mpv().destroy(window_label);
            destroy_child_host(session.mpv_host_hwnd);
            upsert_session(window_label, |current| {
                current.mpv_host_hwnd = None;
            });
        }
    }
    let wid = ensure_mpv_embed_host(window, window_label, bounds)?;
    let (_, runtime_dir) = build_default_mpv_config(app, wid)?;
    if mpv_instance_exists(app, window_label) {
        return Ok(runtime_dir);
    }

    let (config, runtime_dir) = build_default_mpv_config(app, wid)?;
    app.mpv()
        .init(config, window_label)
        .map_err(|error| error.to_string())?;
    Ok(runtime_dir)
}

fn resize_mpv_viewport(
    app: &AppHandle,
    window: &WebviewWindow,
    window_label: &str,
    bounds: &NativeHostBounds,
) -> Result<(), String> {
    let _ = ensure_mpv_initialized(app, window, window_label, bounds)?;
    Ok(())
}

fn apply_mpv_request(
    app: &AppHandle,
    window_label: &str,
    request: &NativeMediaRequest,
) -> Result<(), String> {
    let headers = request.headers.clone().unwrap_or_default();
    let user_agent = header_value(&headers, &["user-agent"])
        .unwrap_or_else(|| MPV_DEFAULT_USER_AGENT.to_string());
    let referer = header_value(&headers, &["referer", "referrer"]);

    let is_proxy = request
        .transport_mode
        .as_ref()
        .map(|m| m == "proxy")
        .unwrap_or(false);

    if !is_proxy {
        let mut header_pairs = headers
            .into_iter()
            .filter(|(_, value)| !value.trim().is_empty())
            .map(|(key, value)| format!("{key}: {}", value.replace(',', "%2C")))
            .collect::<Vec<_>>();

        if !header_pairs
            .iter()
            .any(|entry| entry.to_ascii_lowercase().starts_with("accept:"))
        {
            header_pairs.push("Accept: */*".to_string());
        }
        if !header_pairs
            .iter()
            .any(|entry| entry.to_ascii_lowercase().starts_with("accept-language:"))
        {
            header_pairs.push("Accept-Language: zh-CN%2Czh;q=0.9%2Cen;q=0.8".to_string());
        }
        if !header_pairs
            .iter()
            .any(|entry| entry.to_ascii_lowercase().starts_with("cache-control:"))
        {
            header_pairs.push("Cache-Control: no-cache".to_string());
        }
        if !header_pairs
            .iter()
            .any(|entry| entry.to_ascii_lowercase().starts_with("pragma:"))
        {
            header_pairs.push("Pragma: no-cache".to_string());
        }
        if !header_pairs
            .iter()
            .any(|entry| entry.to_ascii_lowercase().starts_with("user-agent:"))
        {
            header_pairs.push(format!("User-Agent: {}", user_agent.replace(',', "%2C")));
        }

        set_mpv_property(
            app,
            window_label,
            "http-header-fields",
            json!(header_pairs.join(", ")),
        )?;
        if let Some(referer) = referer {
            set_mpv_property(app, window_label, "referrer", json!(referer))?;
        }
    } else {
        // When using relay, clear custom headers to avoid pollution on localhost
        set_mpv_property(app, window_label, "http-header-fields", json!(""))?;
    }

    set_mpv_property(app, window_label, "user-agent", json!(user_agent))?;

    mpv_command(
        app,
        window_label,
        "loadfile",
        vec![json!(request.url), json!("replace")],
    )
}

fn stop_backend(app: &AppHandle, window_label: &str, engine: NativePlayerEngine) {
    match engine {
        NativePlayerEngine::Mpv => {
            if mpv_instance_exists(app, window_label) {
                let _ = app.mpv().destroy(window_label);
            }
            #[cfg(target_os = "windows")]
            destroy_child_host(get_session(window_label).mpv_host_hwnd);
            upsert_session(window_label, |session| {
                session.mpv_host_hwnd = None;
            });
        }
    }
}

pub(crate) fn shutdown_all_players(app: &AppHandle) {
    let labels = native_player_sessions()
        .lock()
        .ok()
        .map(|sessions| sessions.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    for window_label in labels {
        let session = get_session(&window_label);
        if let Some(engine) = session.engine {
            stop_backend(app, &window_label, engine);
        }
        clear_session(&window_label);
    }
}

#[tauri::command]
pub fn native_player_init_or_attach(
    window: WebviewWindow,
    engine: NativePlayerEngine,
    host_bounds: NativeHostBounds,
) -> Result<(), String> {
    let window_label = window.label().to_string();
    let existing = get_session(&window_label);
    if let Some(previous_engine) = existing.engine {
        if previous_engine != engine {
            stop_backend(&window.app_handle(), &window_label, previous_engine);
        }
    }

    upsert_session(&window_label, |session| {
        session.engine = Some(engine);
        session.bounds = Some(host_bounds.clone());
    });
    clear_session_error(&window_label);

    match engine {
        NativePlayerEngine::Mpv => {
            resize_mpv_viewport(&window.app_handle(), &window, &window_label, &host_bounds)?
        }
    }

    Ok(())
}

#[tauri::command]
pub fn native_player_resize(
    window: WebviewWindow,
    window_label: String,
    host_bounds: NativeHostBounds,
) -> Result<(), String> {
    let effective_label = resolve_effective_label(&window, window_label);
    let session = get_session(&effective_label);
    upsert_session(&effective_label, |current| {
        current.bounds = Some(host_bounds.clone());
    });

    match session.engine {
        Some(NativePlayerEngine::Mpv) => resize_mpv_viewport(
            &window.app_handle(),
            &window,
            &effective_label,
            &host_bounds,
        )?,
        None => {}
    }

    Ok(())
}

#[tauri::command]
pub fn native_player_load(
    window: WebviewWindow,
    window_label: String,
    request: NativeMediaRequest,
) -> Result<NativePlayerLoadResult, String> {
    let effective_label = resolve_effective_label(&window, window_label);
    let session = get_session(&effective_label);
    let engine = session
        .engine
        .ok_or_else(|| "native player engine is not attached".to_string())?;
    clear_session_error(&effective_label);

    match engine {
        NativePlayerEngine::Mpv => {
            let bounds = session
                .bounds
                .as_ref()
                .ok_or_else(|| "native player host bounds are missing".to_string())?;
            let runtime_dir =
                ensure_mpv_initialized(&window.app_handle(), &window, &effective_label, bounds)?;
            apply_mpv_request(&window.app_handle(), &effective_label, &request).map_err(
                |error| {
                    set_session_error(&effective_label, "mpv_load_failed", &error);
                    error
                },
            )?;

            Ok(NativePlayerLoadResult {
                engine,
                acknowledged: true,
                ignored_headers: Vec::new(),
                pid: None,
                runtime_path: Some(runtime_dir.to_string_lossy().to_string()),
            })
        }
    }
}

#[tauri::command]
pub fn native_player_status(
    app: AppHandle,
    window_label: String,
) -> Result<NativePlayerStatus, String> {
    let effective_label = if window_label.trim().is_empty() {
        VOD_WINDOW_LABEL.to_string()
    } else {
        window_label
    };
    let session = get_session(&effective_label);

    match session.engine {
        Some(NativePlayerEngine::Mpv) => {
            if !mpv_instance_exists(&app, &effective_label) {
                #[cfg(target_os = "windows")]
                let (host_attached, host_visible, host_width, host_height) =
                    inspect_child_host(session.mpv_host_hwnd);
                #[cfg(not(target_os = "windows"))]
                let (host_attached, host_visible, host_width, host_height) = (
                    session.bounds.is_some(),
                    session.bounds.is_some(),
                    session.bounds.as_ref().map(|value| value.width),
                    session.bounds.as_ref().map(|value| value.height),
                );
                return Ok(NativePlayerStatus {
                    engine: Some(NativePlayerEngine::Mpv),
                    state: "idle".to_string(),
                    first_frame_rendered: false,
                    position_ms: None,
                    duration_ms: None,
                    host_attached,
                    host_visible,
                    host_width,
                    host_height,
                    error_code: session.error_code.clone(),
                    error_message: session.error_message.clone(),
                    fullscreen: false,
                });
            }

            let time_pos = get_mpv_property(&app, &effective_label, "time-pos", "double")
                .ok()
                .and_then(|value| value.as_f64());
            let duration = get_mpv_property(&app, &effective_label, "duration", "double")
                .ok()
                .and_then(|value| value.as_f64());
            let _width = get_mpv_property(&app, &effective_label, "width", "int64")
                .ok()
                .and_then(|value| value.as_i64())
                .and_then(|value| u32::try_from(value).ok());
            let _height = get_mpv_property(&app, &effective_label, "height", "int64")
                .ok()
                .and_then(|value| value.as_i64())
                .and_then(|value| u32::try_from(value).ok());
            let vo_configured = get_mpv_property(&app, &effective_label, "vo-configured", "flag")
                .ok()
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let eof_reached = get_mpv_property(&app, &effective_label, "eof-reached", "flag")
                .ok()
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let paused = get_mpv_property(&app, &effective_label, "pause", "flag")
                .ok()
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let idle_active = get_mpv_property(&app, &effective_label, "idle-active", "flag")
                .ok()
                .and_then(|value| value.as_bool())
                .unwrap_or(false);

            let first_frame_rendered = time_pos.unwrap_or(0.0) > 0.05 || vo_configured;
            let state = if session.error_code.is_some() {
                "error"
            } else if idle_active {
                "idle"
            } else if eof_reached {
                "ended"
            } else if paused {
                "paused"
            } else if first_frame_rendered {
                "playing"
            } else {
                "loading"
            };

            #[cfg(target_os = "windows")]
            let (host_attached, host_visible, host_width, host_height) =
                inspect_child_host(session.mpv_host_hwnd);
            #[cfg(not(target_os = "windows"))]
            let (host_attached, host_visible, host_width, host_height) = (
                session.bounds.is_some(),
                session.bounds.is_some(),
                session.bounds.as_ref().map(|value| value.width),
                session.bounds.as_ref().map(|value| value.height),
            );

            Ok(NativePlayerStatus {
                engine: Some(NativePlayerEngine::Mpv),
                state: state.to_string(),
                first_frame_rendered,
                position_ms: time_pos.map(|value| value * 1000.0),
                duration_ms: duration.map(|value| value * 1000.0),
                host_attached,
                host_visible,
                host_width,
                host_height,
                error_code: session.error_code.clone(),
                error_message: session.error_message.clone(),
                fullscreen: app
                    .get_webview_window(&effective_label)
                    .and_then(|w| w.is_fullscreen().ok())
                    .unwrap_or(false),
            })
        }
        None => Ok(NativePlayerStatus {
            engine: None,
            state: "idle".to_string(),
            first_frame_rendered: false,
            position_ms: None,
            duration_ms: None,
            host_attached: false,
            host_visible: false,
            host_width: None,
            host_height: None,
            error_code: None,
            error_message: None,
            fullscreen: false,
        }),
    }
}

#[tauri::command]
pub fn native_player_command(
    app: AppHandle,
    window_label: String,
    request: NativePlayerCommandRequest,
) -> Result<(), String> {
    let effective_label = if window_label.trim().is_empty() {
        VOD_WINDOW_LABEL.to_string()
    } else {
        window_label
    };
    let session = get_session(&effective_label);
    let engine = session
        .engine
        .ok_or_else(|| "native player is not attached".to_string())?;

    match engine {
        NativePlayerEngine::Mpv => match request.command.as_str() {
            "play" => set_mpv_property(&app, &effective_label, "pause", json!(false)),
            "pause" => set_mpv_property(&app, &effective_label, "pause", json!(true)),
            "seek" => {
                let position_ms = request
                    .payload
                    .as_ref()
                    .and_then(|value| value.get("positionMs"))
                    .and_then(|value| value.as_f64())
                    .ok_or_else(|| "seek command requires payload.positionMs".to_string())?;
                mpv_command(
                    &app,
                    &effective_label,
                    "seek",
                    vec![
                        json!(position_ms / 1000.0),
                        json!("absolute"),
                        json!("exact"),
                    ],
                )
            }
            "set_volume" => {
                let volume = request
                    .payload
                    .as_ref()
                    .and_then(|value| value.get("volume"))
                    .and_then(|value| value.as_f64())
                    .ok_or_else(|| "set_volume command requires payload.volume".to_string())?;
                set_mpv_property(&app, &effective_label, "volume", json!(volume))
            }
            "set_aspect_ratio" => {
                let ratio = request
                    .payload
                    .as_ref()
                    .and_then(|value| value.get("ratio"))
                    .and_then(|value| value.as_f64())
                    .unwrap_or(-1.0);
                set_mpv_property(
                    &app,
                    &effective_label,
                    "video-aspect-override",
                    json!(ratio),
                )
            }
            "toggle_fullscreen" => {
                let window = app.get_webview_window(&effective_label).ok_or_else(|| {
                    format!("Failed to find window with label: {}", effective_label)
                })?;
                let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
                window
                    .set_fullscreen(!is_fullscreen)
                    .map_err(|e| e.to_string())
            }
            "set_panscan" => {
                let value = request
                    .payload
                    .as_ref()
                    .and_then(|value| value.get("panscan"))
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0);
                set_mpv_property(&app, &effective_label, "panscan", json!(value))
            }
            "stop" => mpv_command(&app, &effective_label, "stop", Vec::new()),
            other => Err(format!(
                "unsupported native player command for mpv: {other}"
            )),
        },
    }
}

#[tauri::command]
pub fn native_player_destroy(app: AppHandle, window_label: String) -> Result<(), String> {
    let effective_label = if window_label.trim().is_empty() {
        VOD_WINDOW_LABEL.to_string()
    } else {
        window_label
    };
    let session = get_session(&effective_label);
    if let Some(engine) = session.engine {
        stop_backend(&app, &effective_label, engine);
    }
    clear_session(&effective_label);
    Ok(())
}
