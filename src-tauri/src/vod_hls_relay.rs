#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodRelaySession {
    pub session_id: String,
    pub local_manifest_url: String,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodRelayStats {
    pub session_id: String,
    pub exists: bool,
    pub created_at_ms: Option<u64>,
    pub last_access_ms: Option<u64>,
    pub idle_ms: Option<u64>,
    pub upstream_host: Option<String>,
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_open_hls_relay_session(
    url: String,
    _headers: Option<std::collections::HashMap<String, String>>,
    _source_hint: Option<String>,
    _sourceHint: Option<String>,
) -> Result<VodRelaySession, String> {
    let session_id = format!("recovery-{}", chrono::Local::now().timestamp_millis());
    Ok(VodRelaySession {
        session_id,
        local_manifest_url: url,
        expires_at_ms: (chrono::Local::now().timestamp_millis() + 30 * 60 * 1000) as u64,
    })
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_close_hls_relay_session(
    sessionId: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let _ = sessionId.or(session_id);
    Ok(())
}

#[allow(non_snake_case)]
#[tauri::command]
pub async fn vod_get_hls_relay_stats(
    sessionId: Option<String>,
    session_id: Option<String>,
) -> Result<VodRelayStats, String> {
    let id = sessionId
        .or(session_id)
        .unwrap_or_else(|| "unknown".to_string());
    Ok(VodRelayStats {
        session_id: id,
        exists: true,
        created_at_ms: None,
        last_access_ms: None,
        idle_ms: None,
        upstream_host: None,
    })
}
