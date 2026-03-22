#[path = "media_cmds/media_cmds_hls.rs"]
mod media_cmds_hls;
#[path = "media_cmds/media_cmds_jiexi.rs"]
mod media_cmds_jiexi;
#[path = "media_cmds/media_cmds_network.rs"]
mod media_cmds_network;
#[path = "media_cmds/media_cmds_source_fallbacks.rs"]
mod media_cmds_source_fallbacks;
#[path = "media_cmds/media_cmds_stream_probe.rs"]
mod media_cmds_stream_probe;
#[path = "media_cmds/media_cmds_transport.rs"]
mod media_cmds_transport;
#[path = "media_cmds/media_cmds_tvbox.rs"]
mod media_cmds_tvbox;

pub use media_cmds_hls::LiveProxyMetrics;
pub(crate) use media_cmds_network::build_transport_client;
pub use media_cmds_network::{
    apply_request_headers, build_client, configure_http_client_builder,
    current_media_network_policy_generation, resolve_media_request,
};
pub(crate) use media_cmds_network::{build_rescue_client, build_rescue_transport_client};
pub use media_cmds_transport::{
    execute_media_transport_request, MediaTransportOptions, MediaTransportRequest,
    MediaTransportResponse,
};

#[tauri::command]
pub async fn fetch_tvbox_config(url: String) -> Result<String, String> {
    media_cmds_tvbox::fetch_tvbox_config(url).await
}

#[tauri::command]
pub async fn fetch_text_resource(url: String) -> Result<String, String> {
    media_cmds_tvbox::fetch_text_resource(url).await
}

#[tauri::command]
pub fn list_vod_site_rankings(
    source: String,
    repo_url: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<crate::vod_source_stats::VodSiteRankingRecord>, String> {
    crate::vod_source_stats::list_vod_site_rankings(&source, repo_url.as_deref(), limit.unwrap_or(16))
}

#[tauri::command]
pub fn record_vod_site_success(
    source: String,
    repo_url: Option<String>,
    site_key: String,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_site_success(
        &source,
        repo_url.as_deref(),
        &site_key,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn list_vod_parse_rankings(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    api_class: String,
    route_name: String,
    limit: Option<i64>,
) -> Result<Vec<crate::vod_source_stats::VodParseRankingRecord>, String> {
    crate::vod_source_stats::list_vod_parse_rankings(
        &source,
        repo_url.as_deref(),
        &site_key,
        &api_class,
        &route_name,
        limit.unwrap_or(8),
    )
}

#[tauri::command]
pub fn record_vod_parse_success(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    api_class: String,
    route_name: String,
    parse_url: String,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_parse_success(
        &source,
        repo_url.as_deref(),
        &site_key,
        &api_class,
        &route_name,
        &parse_url,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn list_vod_parse_health_records(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    api_class: String,
    route_name: String,
    limit: Option<i64>,
) -> Result<Vec<crate::vod_source_stats::VodParseHealthRecord>, String> {
    crate::vod_source_stats::list_vod_parse_health_records(
        &source,
        repo_url.as_deref(),
        &site_key,
        &api_class,
        &route_name,
        limit.unwrap_or(12),
    )
}

#[tauri::command]
pub fn record_vod_parse_health_success(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    api_class: String,
    route_name: String,
    parse_url: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_parse_health_success(
        &source,
        repo_url.as_deref(),
        &site_key,
        &api_class,
        &route_name,
        &parse_url,
        duration_ms.unwrap_or_default(),
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn record_vod_parse_health_failure(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    api_class: String,
    route_name: String,
    parse_url: String,
    last_status: Option<String>,
    failure_kind: Option<String>,
    duration_ms: Option<i64>,
    hard_failure: bool,
    soft_failure: bool,
    quarantine_until_ms: Option<i64>,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_parse_health_failure(
        &source,
        repo_url.as_deref(),
        &site_key,
        &api_class,
        &route_name,
        &parse_url,
        last_status.as_deref().unwrap_or("failed"),
        failure_kind.as_deref(),
        duration_ms.unwrap_or_default(),
        hard_failure,
        soft_failure,
        quarantine_until_ms.unwrap_or_default(),
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn load_vod_aggregate_search_cache(
    source: String,
    repo_url: Option<String>,
    keyword: String,
    site_set_key: String,
) -> Result<Option<crate::vod_source_stats::VodCachedPayloadRecord>, String> {
    crate::vod_source_stats::load_vod_aggregate_search_cache(
        &source,
        repo_url.as_deref(),
        &keyword,
        &site_set_key,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn save_vod_aggregate_search_cache(
    source: String,
    repo_url: Option<String>,
    keyword: String,
    site_set_key: String,
    payload_json: String,
    ttl_ms: i64,
) -> Result<(), String> {
    crate::vod_source_stats::save_vod_aggregate_search_cache(
        &source,
        repo_url.as_deref(),
        &keyword,
        &site_set_key,
        &payload_json,
        chrono::Utc::now().timestamp_millis(),
        ttl_ms,
    )
}

#[tauri::command]
pub fn load_vod_playback_resolution_cache(
    source: String,
    repo_url: Option<String>,
    cache_key: String,
) -> Result<Option<crate::vod_source_stats::VodCachedPayloadRecord>, String> {
    crate::vod_source_stats::load_vod_playback_resolution_cache(
        &source,
        repo_url.as_deref(),
        &cache_key,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn save_vod_playback_resolution_cache(
    source: String,
    repo_url: Option<String>,
    cache_key: String,
    payload_json: String,
    ttl_ms: i64,
) -> Result<(), String> {
    crate::vod_source_stats::save_vod_playback_resolution_cache(
        &source,
        repo_url.as_deref(),
        &cache_key,
        &payload_json,
        chrono::Utc::now().timestamp_millis(),
        ttl_ms,
    )
}

#[tauri::command]
pub fn load_vod_detail_cache(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    vod_id: String,
) -> Result<Option<crate::vod_source_stats::VodCachedPayloadRecord>, String> {
    crate::vod_source_stats::load_vod_detail_cache(
        &source,
        repo_url.as_deref(),
        &site_key,
        &vod_id,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn save_vod_detail_cache(
    source: String,
    repo_url: Option<String>,
    site_key: String,
    vod_id: String,
    payload_json: String,
    ttl_ms: i64,
) -> Result<(), String> {
    crate::vod_source_stats::save_vod_detail_cache(
        &source,
        repo_url.as_deref(),
        &site_key,
        &vod_id,
        &payload_json,
        chrono::Utc::now().timestamp_millis(),
        ttl_ms,
    )
}

#[tauri::command]
pub fn load_vod_dispatch_cache(
    source: String,
    repo_url: Option<String>,
    origin_site_key: String,
    keyword: String,
) -> Result<Option<crate::vod_source_stats::VodCachedPayloadRecord>, String> {
    crate::vod_source_stats::load_vod_dispatch_cache(
        &source,
        repo_url.as_deref(),
        &origin_site_key,
        &keyword,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn save_vod_dispatch_cache(
    source: String,
    repo_url: Option<String>,
    origin_site_key: String,
    keyword: String,
    payload_json: String,
    ttl_ms: i64,
) -> Result<(), String> {
    crate::vod_source_stats::save_vod_dispatch_cache(
        &source,
        repo_url.as_deref(),
        &origin_site_key,
        &keyword,
        &payload_json,
        chrono::Utc::now().timestamp_millis(),
        ttl_ms,
    )
}

#[tauri::command]
pub fn load_vod_dispatch_backend_stats(
    source: String,
    repo_url: Option<String>,
    origin_site_key: String,
    limit: Option<i64>,
) -> Result<Vec<crate::vod_source_stats::VodDispatchBackendStatRecord>, String> {
    crate::vod_source_stats::load_vod_dispatch_backend_stats(
        &source,
        repo_url.as_deref(),
        &origin_site_key,
        limit.unwrap_or(32),
    )
}

#[tauri::command]
pub fn record_vod_dispatch_backend_success(
    source: String,
    repo_url: Option<String>,
    origin_site_key: String,
    target_site_key: String,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_dispatch_backend_success(
        &source,
        repo_url.as_deref(),
        &origin_site_key,
        &target_site_key,
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn record_vod_dispatch_backend_failure(
    source: String,
    repo_url: Option<String>,
    origin_site_key: String,
    target_site_key: String,
    last_status: Option<String>,
    failure_kind: Option<String>,
    hard_failure: bool,
    upstream_failure: bool,
    quarantine_until_ms: Option<i64>,
) -> Result<(), String> {
    crate::vod_source_stats::record_vod_dispatch_backend_failure(
        &source,
        repo_url.as_deref(),
        &origin_site_key,
        &target_site_key,
        last_status.as_deref().unwrap_or("failed"),
        failure_kind.as_deref(),
        hard_failure,
        upstream_failure,
        quarantine_until_ms.unwrap_or_default(),
        chrono::Utc::now().timestamp_millis(),
    )
}

#[tauri::command]
pub fn set_media_network_policy(policy: Option<media_cmds_network::MediaNetworkPolicyInput>) {
    media_cmds_network::set_media_network_policy(policy);
}

#[tauri::command]
pub fn get_media_network_policy_status() -> media_cmds_network::MediaNetworkPolicyStatus {
    media_cmds_network::get_media_network_policy_status()
}

#[tauri::command]
pub async fn execute_media_transport(
    request: media_cmds_transport::MediaTransportRequest,
) -> Result<media_cmds_transport::MediaTransportResponse, String> {
    media_cmds_transport::execute_media_transport_request(request).await
}

#[tauri::command]
pub async fn probe_stream_kind(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<media_cmds_stream_probe::StreamProbeResult, String> {
    media_cmds_stream_probe::probe_stream_kind(url, headers, timeout_ms).await
}

#[tauri::command]
pub async fn fetch_vod_home(api_url: String) -> Result<String, String> {
    media_cmds_tvbox::fetch_vod_home(api_url).await
}

#[tauri::command]
pub async fn fetch_vod_category(api_url: String, tid: String, pg: u32) -> Result<String, String> {
    media_cmds_tvbox::fetch_vod_category(api_url, tid, pg).await
}

#[tauri::command]
pub async fn fetch_vod_search(api_url: String, keyword: String) -> Result<String, String> {
    media_cmds_tvbox::fetch_vod_search(api_url, keyword).await
}

#[tauri::command]
pub async fn fetch_vod_detail(api_url: String, ids: String) -> Result<String, String> {
    media_cmds_tvbox::fetch_vod_detail(api_url, ids).await
}

#[tauri::command]
pub async fn proxy_media(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    media_cmds_tvbox::proxy_media(url, headers).await
}

#[tauri::command]
pub async fn resolve_jiexi(
    jiexi_prefix: String,
    video_url: String,
    extra_headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    media_cmds_jiexi::resolve_jiexi(jiexi_prefix, video_url, extra_headers, timeout_ms).await
}

#[tauri::command]
pub async fn resolve_wrapped_media_url(
    target_url: String,
    extra_headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    media_cmds_jiexi::resolve_wrapped_media_url(target_url, extra_headers, timeout_ms).await
}

#[tauri::command]
pub async fn resolve_jiexi_webview(
    app: tauri::AppHandle,
    jiexi_prefix: String,
    video_url: String,
    timeout_ms: Option<u64>,
    visible: Option<bool>,
    click_actions: Option<Vec<media_cmds_jiexi::JiexiClickActionInput>>,
) -> Result<String, String> {
    media_cmds_jiexi::resolve_jiexi_webview(
        app,
        jiexi_prefix,
        video_url,
        timeout_ms,
        visible,
        click_actions,
    )
    .await
}

#[tauri::command]
pub async fn proxy_hls_manifest(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    playback_rules: Option<Vec<media_cmds_hls::TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    stream_key: Option<String>,
) -> Result<String, String> {
    media_cmds_hls::proxy_hls_manifest(url, headers, playback_rules, blocked_hosts, stream_key)
        .await
}

#[tauri::command]
pub async fn proxy_hls_segment(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    playback_rules: Option<Vec<media_cmds_hls::TvBoxPlaybackRuleInput>>,
    blocked_hosts: Option<Vec<String>>,
    stream_key: Option<String>,
) -> Result<String, String> {
    media_cmds_hls::proxy_hls_segment(url, headers, playback_rules, blocked_hosts, stream_key).await
}

#[tauri::command]
pub fn get_live_proxy_metrics() -> LiveProxyMetrics {
    media_cmds_hls::get_live_proxy_metrics()
}

#[tauri::command]
pub fn reset_live_proxy_metrics(stream_key: Option<String>) {
    media_cmds_hls::reset_live_proxy_metrics(stream_key);
}

#[tauri::command]
pub fn release_live_stream(stream_key: String) {
    media_cmds_hls::release_live_stream(stream_key);
}

#[tauri::command]
pub fn note_live_buffer_anomaly() {
    media_cmds_hls::note_live_buffer_anomaly();
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn launch_potplayer(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    use std::process::Command;
    use std::io::Write;

    let exe = find_potplayer_exe()?;

    // If it's an M3U8 URL, download and save to temp file
    if url.to_lowercase().contains(".m3u8") || url.to_lowercase().contains("m3u8") {
        log::info!("[PotPlayer] Downloading M3U8 manifest from: {}", url);

        let client = build_client()?;
        let mut req = client.get(&url);
        if let Some(hdrs) = headers {
            for (k, v) in hdrs {
                req = req.header(k, v);
            }
        }

        let manifest = req.send()
            .await
            .map_err(|e| format!("下载 M3U8 失败: {}", e))?
            .text()
            .await
            .map_err(|e| format!("读取 M3U8 内容失败: {}", e))?;

        // Save to temp file
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("halo_potplayer_{}.m3u8", chrono::Utc::now().timestamp()));

        let mut file = std::fs::File::create(&temp_file)
            .map_err(|e| format!("创建临时文件失败: {}", e))?;
        file.write_all(manifest.as_bytes())
            .map_err(|e| format!("写入临时文件失败: {}", e))?;

        log::info!("[PotPlayer] Saved manifest to: {}", temp_file.display());
        log::info!("[PotPlayer] Launching with temp file");

        Command::new(&exe)
            .arg(temp_file.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("启动 PotPlayer 失败: {}", e))?;
    } else {
        log::info!("[PotPlayer] Launching with direct URL: {}", url);
        Command::new(&exe)
            .arg(&url)
            .spawn()
            .map_err(|e| format!("启动 PotPlayer 失败: {}", e))?;
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn launch_potplayer(
    _url: String,
    _headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), String> {
    Err("PotPlayer 仅支持 Windows 系统".to_string())
}

#[cfg(target_os = "windows")]
fn find_potplayer_exe() -> Result<std::path::PathBuf, String> {
    use std::path::PathBuf;

    // Try registry first
    let registry_paths = [
        r"SOFTWARE\DAUM\PotPlayer64",
        r"SOFTWARE\DAUM\PotPlayer",
        r"SOFTWARE\WOW6432Node\DAUM\PotPlayer",
    ];

    for reg_path in &registry_paths {
        if let Ok(exe) = read_registry_exe_path(reg_path) {
            if exe.exists() {
                return Ok(exe);
            }
        }
    }

    // Fallback to common paths
    let common_paths = [
        r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
        r"C:\Program Files\DAUM\PotPlayer\PotPlayer64.exe",
        r"C:\Program Files (x86)\DAUM\PotPlayer\PotPlayerMini.exe",
        r"C:\Program Files (x86)\DAUM\PotPlayer\PotPlayer.exe",
    ];

    for path_str in &common_paths {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("未找到 PotPlayer，请先安装 PotPlayer".to_string())
}

#[cfg(target_os = "windows")]
fn read_registry_exe_path(subkey: &str) -> Result<std::path::PathBuf, String> {
    use std::path::PathBuf;
    use windows::Win32::System::Registry::{RegOpenKeyExW, RegQueryValueExW, RegCloseKey, HKEY, HKEY_LOCAL_MACHINE, KEY_READ};
    use windows::core::PCWSTR;

    unsafe {
        let subkey_wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
        let mut hkey: HKEY = HKEY::default();

        if RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(subkey_wide.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        ).is_err() {
            return Err("Registry key not found".to_string());
        }

        let value_name_wide: Vec<u16> = "ProgramPath".encode_utf16().chain(std::iter::once(0)).collect();
        let mut buffer = vec![0u16; 512];
        let mut buffer_size = (buffer.len() * 2) as u32;

        let result = RegQueryValueExW(
            hkey,
            PCWSTR(value_name_wide.as_ptr()),
            None,
            None,
            Some(buffer.as_mut_ptr() as *mut u8),
            Some(&mut buffer_size),
        );

        let _ = RegCloseKey(hkey);

        if result.is_err() {
            return Err("Registry value not found".to_string());
        }

        let len = (buffer_size as usize / 2).saturating_sub(1);
        let path_str = String::from_utf16_lossy(&buffer[..len]);
        Ok(PathBuf::from(path_str.trim()))
    }
}
