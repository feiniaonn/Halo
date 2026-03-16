use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SpiderRuntimeFamily {
    FmAnotherds,
    AppMergeC,
    A0JsHeavy,
    PureJsBridge,
    Unknown,
}

impl Default for SpiderRuntimeFamily {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpiderExecutionPhase {
    Prefetch,
    Profile,
    Execute,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SpiderTransportTarget {
    RustUnified,
    JavaOkHttp,
    JavaOkHttpFallback,
    LocalHelper,
    Unknown,
}

impl Default for SpiderTransportTarget {
    fn default() -> Self {
        Self::Unknown
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SpiderFailureCode {
    RemoteArtifactFetchFailed,
    ClassSelectionMiss,
    RuntimeInitFailed,
    RuntimeMethodFailed,
    TransportTlsFailed,
    TransportProxyFailed,
    TransportTimeout,
    UpstreamForbidden,
    UpstreamMalformedPayload,
    PayloadSchemaInvalid,
    DependencyMissing,
    CapabilityUnsupported,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpiderSourceHealthImpact {
    None,
    Soft,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpiderFeatureFlags {
    pub unified_request_policy_v1: bool,
    pub spider_execution_envelope_v1: bool,
    pub normalized_payload_v1: bool,
    pub spider_task_manager_v1: bool,
}

impl Default for SpiderFeatureFlags {
    fn default() -> Self {
        Self {
            unified_request_policy_v1: true,
            spider_execution_envelope_v1: true,
            normalized_payload_v1: true,
            spider_task_manager_v1: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderExecutionDiagnostics {
    pub request_id: String,
    pub root_cause: Option<String>,
    pub fallback_used: bool,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderExecutionTimings {
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpiderExecutionEnvelope<T> {
    pub ok: bool,
    pub site_key: String,
    pub method: String,
    pub phase: SpiderExecutionPhase,
    pub runtime_family: SpiderRuntimeFamily,
    pub execution_target: String,
    pub transport_target: SpiderTransportTarget,
    pub failure_code: Option<SpiderFailureCode>,
    pub retryable: bool,
    pub source_health_impact: SpiderSourceHealthImpact,
    pub timings: SpiderExecutionTimings,
    pub payload: Option<T>,
    pub diagnostics: SpiderExecutionDiagnostics,
}

fn feature_flag_from_env(name: &str, default_value: bool) -> bool {
    let Ok(value) = std::env::var(name) else {
        return default_value;
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "0" | "false" | "off" | "no" => false,
        "1" | "true" | "on" | "yes" => true,
        _ => default_value,
    }
}

pub fn current_spider_feature_flags() -> &'static SpiderFeatureFlags {
    static FLAGS: OnceLock<SpiderFeatureFlags> = OnceLock::new();
    FLAGS.get_or_init(|| {
        let defaults = SpiderFeatureFlags::default();
        SpiderFeatureFlags {
            unified_request_policy_v1: feature_flag_from_env(
                "HALO_UNIFIED_REQUEST_POLICY_V1",
                defaults.unified_request_policy_v1,
            ),
            spider_execution_envelope_v1: feature_flag_from_env(
                "HALO_SPIDER_EXECUTION_ENVELOPE_V1",
                defaults.spider_execution_envelope_v1,
            ),
            normalized_payload_v1: feature_flag_from_env(
                "HALO_NORMALIZED_PAYLOAD_V1",
                defaults.normalized_payload_v1,
            ),
            spider_task_manager_v1: feature_flag_from_env(
                "HALO_SPIDER_TASK_MANAGER_V1",
                defaults.spider_task_manager_v1,
            ),
        }
    })
}

pub fn detect_runtime_family(site_key: &str, class_name: Option<&str>) -> SpiderRuntimeFamily {
    let combined = format!(
        "{} {}",
        site_key.trim().to_ascii_lowercase(),
        class_name.unwrap_or_default().trim().to_ascii_lowercase()
    );

    if combined.contains("jsbridge") || combined.ends_with(".js") {
        return SpiderRuntimeFamily::PureJsBridge;
    }

    if combined.contains("douban") || combined.contains("ygp") || combined.contains("anotherds") {
        return SpiderRuntimeFamily::FmAnotherds;
    }

    if combined.contains("app3q")
        || combined.contains("appjg")
        || combined.contains("appqi")
        || combined.contains("apprj")
        || combined.contains("hxq")
    {
        return SpiderRuntimeFamily::AppMergeC;
    }

    if combined.contains("appysv2") || combined.contains("appfox") || combined.contains("appnox") {
        return SpiderRuntimeFamily::A0JsHeavy;
    }

    SpiderRuntimeFamily::Unknown
}
