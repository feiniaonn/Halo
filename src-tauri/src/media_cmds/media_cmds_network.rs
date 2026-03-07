use hickory_resolver::config::{NameServerConfig, NameServerConfigGroup, ResolverConfig};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::proto::xfer::Protocol;
use hickory_resolver::Resolver;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::Client;
use reqwest::RequestBuilder;
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaRequestHeaderRule {
    pub host: String,
    #[serde(default)]
    pub header: HashMap<String, String>,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaHostMapping {
    pub host: String,
    pub target: String,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaDoHEntry {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub ips: Vec<String>,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaNetworkPolicyInput {
    #[serde(default, rename = "requestHeaders")]
    pub request_headers: Vec<MediaRequestHeaderRule>,
    #[serde(default, rename = "hostMappings")]
    pub host_mappings: Vec<MediaHostMapping>,
    #[serde(default)]
    pub doh: Vec<MediaDoHEntry>,
}

#[derive(Clone, Debug, Default)]
struct MediaNetworkPolicyState {
    request_headers: Vec<MediaRequestHeaderRule>,
    host_mappings: Vec<MediaHostMapping>,
    doh: Vec<MediaDoHEntry>,
}

#[derive(Clone, Debug, Default)]
pub struct ResolvedMediaRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub matched_doh: Option<MediaDoHEntry>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct MediaNetworkPolicyStatus {
    pub request_header_rule_count: usize,
    pub host_mapping_count: usize,
    pub doh_entry_count: usize,
    pub supports_doh_resolver: bool,
    pub active_doh_provider_name: Option<String>,
    pub unsupported_doh_entry_count: usize,
}

static MEDIA_NETWORK_POLICY: LazyLock<Mutex<MediaNetworkPolicyState>> =
    LazyLock::new(|| Mutex::new(MediaNetworkPolicyState::default()));
static MEDIA_NETWORK_POLICY_GENERATION: AtomicU64 = AtomicU64::new(1);
static MEDIA_HTTP_CLIENT: LazyLock<Mutex<Option<(u64, Result<Client, String>)>>> =
    LazyLock::new(|| Mutex::new(None));
static MEDIA_HTTP_RESCUE_CLIENT: LazyLock<Mutex<Option<(u64, Result<Client, String>)>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn set_media_network_policy_state(policy: Option<MediaNetworkPolicyInput>) {
    if let Ok(mut state) = MEDIA_NETWORK_POLICY.lock() {
        *state = match policy {
            Some(value) => MediaNetworkPolicyState {
                request_headers: value.request_headers,
                host_mappings: value.host_mappings,
                doh: value.doh,
            },
            None => MediaNetworkPolicyState::default(),
        };
    }
    MEDIA_NETWORK_POLICY_GENERATION.fetch_add(1, Ordering::Relaxed);
}

pub fn set_media_network_policy(policy: Option<MediaNetworkPolicyInput>) {
    set_media_network_policy_state(policy);
}

pub fn get_media_network_policy_status() -> MediaNetworkPolicyStatus {
    let state = current_media_network_policy();
    let doh_config = build_doh_config(&state.doh);
    MediaNetworkPolicyStatus {
        request_header_rule_count: state.request_headers.len(),
        host_mapping_count: state.host_mappings.len(),
        doh_entry_count: state.doh.len(),
        supports_doh_resolver: doh_config.is_some(),
        active_doh_provider_name: doh_config
            .as_ref()
            .map(|config| config.active_provider_name.clone()),
        unsupported_doh_entry_count: doh_config
            .as_ref()
            .map(|config| config.unsupported_entry_count)
            .unwrap_or(state.doh.len()),
    }
}

pub fn current_media_network_policy_generation() -> u64 {
    MEDIA_NETWORK_POLICY_GENERATION.load(Ordering::Relaxed)
}

fn current_media_network_policy() -> MediaNetworkPolicyState {
    MEDIA_NETWORK_POLICY
        .lock()
        .map(|state| state.clone())
        .unwrap_or_default()
}

#[derive(Clone)]
struct BuiltDoHConfig {
    resolver_config: ResolverConfig,
    active_provider_name: String,
    unsupported_entry_count: usize,
}

fn resolve_doh_server_ips(host: &str, port: u16, explicit_ips: &[String]) -> Vec<IpAddr> {
    if !explicit_ips.is_empty() {
        return explicit_ips
            .iter()
            .filter_map(|value| value.trim().parse::<IpAddr>().ok())
            .collect();
    }

    (host, port)
        .to_socket_addrs()
        .map(|iter| iter.map(|addr| addr.ip()).collect::<Vec<IpAddr>>())
        .unwrap_or_default()
}

fn build_doh_name_server_group(entry: &MediaDoHEntry) -> Option<NameServerConfigGroup> {
    let parsed = url::Url::parse(entry.url.trim()).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }

    let host = parsed.host_str()?.trim().to_string();
    if host.is_empty() {
        return None;
    }

    let port = parsed.port_or_known_default().unwrap_or(443);
    let endpoint = if parsed.path() == "/" && parsed.query().is_none() {
        None
    } else {
        let mut path = parsed.path().to_string();
        if let Some(query) = parsed.query() {
            path.push('?');
            path.push_str(query);
        }
        Some(path)
    };

    let ips = resolve_doh_server_ips(&host, port, &entry.ips);
    if ips.is_empty() {
        return None;
    }

    let mut group = NameServerConfigGroup::new();
    for ip in ips {
        let mut config = NameServerConfig::new(SocketAddr::new(ip, port), Protocol::Https);
        config.tls_dns_name = Some(host.clone());
        config.http_endpoint = endpoint.clone();
        config.trust_negative_responses = true;
        group.push(config);
    }
    Some(group)
}

fn build_doh_config(entries: &[MediaDoHEntry]) -> Option<BuiltDoHConfig> {
    let mut group = NameServerConfigGroup::new();
    let mut supported_names: Vec<String> = Vec::new();
    let mut unsupported_entry_count = 0usize;

    for entry in entries {
        if let Some(next_group) = build_doh_name_server_group(entry) {
            group.merge(next_group);
            let display_name = entry.name.trim();
            supported_names.push(if display_name.is_empty() {
                entry.url.trim().to_string()
            } else {
                display_name.to_string()
            });
        } else {
            unsupported_entry_count = unsupported_entry_count.saturating_add(1);
        }
    }

    if group.is_empty() {
        return None;
    }

    Some(BuiltDoHConfig {
        resolver_config: ResolverConfig::from_parts(None, Vec::new(), group),
        active_provider_name: supported_names.join(" + "),
        unsupported_entry_count,
    })
}

#[derive(Clone)]
struct DohDnsResolver {
    inner: Resolver<TokioConnectionProvider>,
}

impl Resolve for DohDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.inner.clone();
        let host = name.as_str().to_string();
        Box::pin(async move {
            let lookup = resolver
                .lookup_ip(host.as_str())
                .await
                .map_err(|error| -> Box<dyn std::error::Error + Send + Sync> { Box::new(error) })?;
            let addrs: Vec<SocketAddr> = lookup.iter().map(|ip| SocketAddr::new(ip, 0)).collect();
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn build_active_doh_resolver() -> Result<Option<(Arc<DohDnsResolver>, BuiltDoHConfig)>, String> {
    let policy = current_media_network_policy();
    let Some(config) = build_doh_config(&policy.doh) else {
        return Ok(None);
    };
    let resolver_config = config.resolver_config.clone();

    let resolver =
        Resolver::builder_with_config(resolver_config, TokioConnectionProvider::default()).build();

    Ok(Some((Arc::new(DohDnsResolver { inner: resolver }), config)))
}

pub fn matches_host_pattern(pattern: &str, url_or_host: &str) -> bool {
    let token = pattern.trim().to_ascii_lowercase();
    if token.is_empty() {
        return false;
    }

    let parsed = url::Url::parse(url_or_host).ok();
    let host = parsed
        .as_ref()
        .and_then(|value| value.host_str())
        .unwrap_or(url_or_host)
        .to_ascii_lowercase();
    let haystack = format!("{} {}", url_or_host.to_ascii_lowercase(), host);

    if token.contains('*') || token.contains(".*") {
        let escaped = regex::escape(&token)
            .replace("\\.\\*", ".*")
            .replace("\\*", ".*");
        if let Ok(expression) = regex::Regex::new(&escaped) {
            return expression.is_match(url_or_host) || expression.is_match(&host);
        }
        let simplified = token.replace('*', "").replace(".*", "");
        return !simplified.is_empty() && haystack.contains(&simplified);
    }

    haystack.contains(&token)
}

pub fn configure_http_client_builder(
    builder: reqwest::ClientBuilder,
) -> Result<reqwest::ClientBuilder, String> {
    let Some((resolver, _profile)) = build_active_doh_resolver()? else {
        return Ok(builder);
    };
    Ok(builder.dns_resolver(resolver))
}

fn build_http_client(force_close_pool: bool) -> Result<Client, String> {
    let mut builder = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .tcp_keepalive(Some(Duration::from_secs(20)));
    if force_close_pool {
        builder = builder.pool_max_idle_per_host(0);
    }
    builder = configure_http_client_builder(builder)?;
    builder.build().map_err(|e| e.to_string())
}

fn get_cached_http_client(force_close_pool: bool) -> Result<Client, String> {
    let generation = current_media_network_policy_generation();
    let slot = if force_close_pool {
        &MEDIA_HTTP_RESCUE_CLIENT
    } else {
        &MEDIA_HTTP_CLIENT
    };

    let mut cache = slot.lock().map_err(|e| e.to_string())?;
    if let Some((cached_generation, cached_result)) = &*cache {
        if *cached_generation == generation {
            return cached_result.clone();
        }
    }

    let built = build_http_client(force_close_pool);
    *cache = Some((generation, built.clone()));
    built
}

pub fn build_client() -> Result<Client, String> {
    get_cached_http_client(false)
}

pub fn build_rescue_client() -> Result<Client, String> {
    get_cached_http_client(true)
}

fn merge_headers(
    base_headers: Option<HashMap<String, String>>,
    extra_headers: Option<HashMap<String, String>>,
) -> Option<HashMap<String, String>> {
    let mut merged = HashMap::new();
    if let Some(extra) = extra_headers {
        merged.extend(extra);
    }
    if let Some(base) = base_headers {
        merged.extend(base);
    }
    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

fn match_request_headers(
    rules: &[MediaRequestHeaderRule],
    url: &str,
) -> Option<HashMap<String, String>> {
    let mut merged = HashMap::new();
    for rule in rules {
        if !matches_host_pattern(&rule.host, url) {
            continue;
        }
        for (key, value) in &rule.header {
            if !key.trim().is_empty() && !value.trim().is_empty() {
                merged.insert(key.clone(), value.clone());
            }
        }
    }
    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

fn apply_host_mappings(
    url: &str,
    headers: Option<HashMap<String, String>>,
    mappings: &[MediaHostMapping],
) -> ResolvedMediaRequest {
    let Ok(parsed) = url::Url::parse(url) else {
        return ResolvedMediaRequest {
            url: url.to_string(),
            headers,
            matched_doh: None,
        };
    };

    let Some(matched) = mappings
        .iter()
        .find(|mapping| matches_host_pattern(&mapping.host, parsed.host_str().unwrap_or_default()))
    else {
        return ResolvedMediaRequest {
            url: parsed.to_string(),
            headers,
            matched_doh: None,
        };
    };

    let mut rewritten = parsed.clone();
    let original_host = rewritten.host_str().unwrap_or_default().to_string();
    if rewritten.set_host(Some(matched.target.trim())).is_err() {
        return ResolvedMediaRequest {
            url: parsed.to_string(),
            headers,
            matched_doh: None,
        };
    }

    let mut host_header = HashMap::new();
    if !original_host.is_empty() {
        host_header.insert("Host".to_string(), original_host);
    }

    ResolvedMediaRequest {
        url: rewritten.to_string(),
        headers: merge_headers(headers, Some(host_header)),
        matched_doh: None,
    }
}

fn match_doh_entry(entries: &[MediaDoHEntry], url: &str) -> Option<MediaDoHEntry> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    entries
        .iter()
        .find(|entry| {
            entry
                .ips
                .iter()
                .any(|value| matches_host_pattern(value, &host))
                || matches_host_pattern(&entry.name, &host)
        })
        .cloned()
}

pub fn resolve_media_request(
    url: &str,
    explicit_headers: Option<HashMap<String, String>>,
) -> ResolvedMediaRequest {
    let policy = current_media_network_policy();
    let matched_headers = match_request_headers(&policy.request_headers, url);
    let mut resolved = apply_host_mappings(
        url,
        merge_headers(explicit_headers, matched_headers),
        &policy.host_mappings,
    );
    resolved.matched_doh = match_doh_entry(&policy.doh, &resolved.url);
    resolved
}

pub fn apply_request_headers(
    mut builder: RequestBuilder,
    headers: &Option<HashMap<String, String>>,
) -> RequestBuilder {
    if let Some(items) = headers {
        for (key, value) in items {
            builder = builder.header(key, value);
        }
    }
    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_host_mapping_and_request_headers() {
        set_media_network_policy_state(Some(MediaNetworkPolicyInput {
            request_headers: vec![MediaRequestHeaderRule {
                host: "example.com".to_string(),
                header: HashMap::from([("User-Agent".to_string(), "Halo".to_string())]),
            }],
            host_mappings: vec![MediaHostMapping {
                host: "media.example.com".to_string(),
                target: "mirror.example.net".to_string(),
            }],
            doh: Vec::new(),
        }));

        let resolved = resolve_media_request(
            "https://media.example.com/video.m3u8",
            Some(HashMap::from([(
                "Referer".to_string(),
                "https://app.example.com".to_string(),
            )])),
        );

        assert_eq!(resolved.url, "https://mirror.example.net/video.m3u8");
        assert_eq!(
            resolved.headers,
            Some(HashMap::from([
                ("Host".to_string(), "media.example.com".to_string()),
                ("Referer".to_string(), "https://app.example.com".to_string()),
                ("User-Agent".to_string(), "Halo".to_string()),
            ]))
        );
    }

    #[test]
    fn clears_network_policy_state() {
        set_media_network_policy_state(None);
        let resolved = resolve_media_request("https://plain.example.com/demo", None);
        assert_eq!(resolved.url, "https://plain.example.com/demo");
        assert!(resolved.headers.is_none());
        assert!(resolved.matched_doh.is_none());
    }

    #[test]
    fn reports_network_policy_status() {
        set_media_network_policy_state(Some(MediaNetworkPolicyInput {
            request_headers: vec![MediaRequestHeaderRule {
                host: "example.com".to_string(),
                header: HashMap::from([("User-Agent".to_string(), "Halo".to_string())]),
            }],
            host_mappings: vec![MediaHostMapping {
                host: "media.example.com".to_string(),
                target: "mirror.example.net".to_string(),
            }],
            doh: vec![MediaDoHEntry {
                name: "Custom DoH".to_string(),
                url: "https://resolver.example.test/custom-dns".to_string(),
                ips: vec!["1.12.12.12".to_string()],
            }],
        }));

        let status = get_media_network_policy_status();
        assert_eq!(status.request_header_rule_count, 1);
        assert_eq!(status.host_mapping_count, 1);
        assert_eq!(status.doh_entry_count, 1);
        assert!(status.supports_doh_resolver);
        assert_eq!(
            status.active_doh_provider_name.as_deref(),
            Some("Custom DoH")
        );
        assert_eq!(status.unsupported_doh_entry_count, 0);
    }

    #[test]
    fn supports_custom_doh_urls_with_explicit_ips_and_endpoint() {
        let group = build_doh_name_server_group(&MediaDoHEntry {
            name: "Arbitrary".to_string(),
            url: "https://resolver.example.test/custom-dns?dns=1".to_string(),
            ips: vec!["1.1.1.1".to_string(), "2606:4700:4700::1111".to_string()],
        })
        .expect("expected custom doh config");

        assert_eq!(group.len(), 2);
        assert_eq!(group[0].protocol, Protocol::Https);
        assert_eq!(group[0].socket_addr.port(), 443);
        assert_eq!(
            group[0].tls_dns_name.as_deref(),
            Some("resolver.example.test")
        );
        assert_eq!(group[0].http_endpoint.as_deref(), Some("/custom-dns?dns=1"));
    }

    #[test]
    fn tracks_unsupported_doh_entries_when_mixed() {
        let config = build_doh_config(&[
            MediaDoHEntry {
                name: "Supported".to_string(),
                url: "https://resolver.example.test/dns-query".to_string(),
                ips: vec!["1.0.0.1".to_string()],
            },
            MediaDoHEntry {
                name: "Broken".to_string(),
                url: "http://resolver.example.test/dns-query".to_string(),
                ips: vec!["1.0.0.1".to_string()],
            },
        ])
        .expect("expected partial custom doh config");

        assert_eq!(config.active_provider_name, "Supported");
        assert_eq!(config.unsupported_entry_count, 1);
    }
}
