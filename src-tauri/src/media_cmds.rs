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
) -> Result<media_cmds_stream_probe::StreamProbeResult, String> {
    media_cmds_stream_probe::probe_stream_kind(url, headers).await
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
) -> Result<String, String> {
    media_cmds_jiexi::resolve_jiexi(jiexi_prefix, video_url, extra_headers).await
}

#[tauri::command]
pub async fn resolve_wrapped_media_url(
    target_url: String,
    extra_headers: Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    media_cmds_jiexi::resolve_wrapped_media_url(target_url, extra_headers).await
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
