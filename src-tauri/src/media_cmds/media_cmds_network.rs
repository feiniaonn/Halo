use hickory_resolver::config::{NameServerConfig, NameServerConfigGroup, ResolverConfig};
use hickory_resolver::name_server::TokioConnectionProvider;
use hickory_resolver::proto::xfer::Protocol;
use hickory_resolver::Resolver;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::Certificate;
use reqwest::RequestBuilder;
use reqwest::{Client, ClientBuilder};
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

fn default_match_all_host_pattern() -> String {
    "*".to_string()
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaProxyRule {
    #[serde(default = "default_match_all_host_pattern")]
    pub host: String,
    #[serde(rename = "proxyUrl")]
    pub proxy_url: String,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaTlsMode {
    #[default]
    Strict,
    AllowInvalid,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MediaHostnameVerificationMode {
    #[default]
    Strict,
    AllowInvalid,
}

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
pub struct MediaNetworkPolicyInput {
    #[serde(default, rename = "requestHeaders")]
    pub request_headers: Vec<MediaRequestHeaderRule>,
    #[serde(default, rename = "hostMappings")]
    pub host_mappings: Vec<MediaHostMapping>,
    #[serde(default)]
    pub doh: Vec<MediaDoHEntry>,
    #[serde(default, rename = "proxyRules")]
    pub proxy_rules: Vec<MediaProxyRule>,
    #[serde(default, rename = "tlsMode")]
    pub tls_mode: MediaTlsMode,
    #[serde(default, rename = "caBundlePath")]
    pub ca_bundle_path: Option<String>,
    #[serde(default, rename = "hostnameVerification")]
    pub hostname_verification: MediaHostnameVerificationMode,
}

#[derive(Clone, Debug, Default)]
struct MediaNetworkPolicyState {
    request_headers: Vec<MediaRequestHeaderRule>,
    host_mappings: Vec<MediaHostMapping>,
    doh: Vec<MediaDoHEntry>,
    proxy_rules: Vec<MediaProxyRule>,
    tls_mode: MediaTlsMode,
    ca_bundle_path: Option<String>,
    hostname_verification: MediaHostnameVerificationMode,
}

#[derive(Clone, Debug, Default)]
pub struct ResolvedMediaRequest {
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub matched_doh: Option<MediaDoHEntry>,
    pub matched_proxy_rule: Option<MediaProxyRule>,
    pub insecure_tls: bool,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct MediaNetworkPolicyStatus {
    pub generation: u64,
    pub request_header_rule_count: usize,
    pub host_mapping_count: usize,
    pub doh_entry_count: usize,
    pub proxy_rule_count: usize,
    pub supports_doh_resolver: bool,
    pub active_doh_provider_name: Option<String>,
    pub unsupported_doh_entry_count: usize,
    pub tls_mode: MediaTlsMode,
    pub hostname_verification: MediaHostnameVerificationMode,
    pub ca_bundle_configured: bool,
}

static MEDIA_NETWORK_POLICY: LazyLock<Mutex<MediaNetworkPolicyState>> =
    LazyLock::new(|| Mutex::new(MediaNetworkPolicyState::default()));
static MEDIA_NETWORK_POLICY_GENERATION: AtomicU64 = AtomicU64::new(1);
static MEDIA_HTTP_CLIENT_CACHE: LazyLock<Mutex<HashMap<String, Result<Client, String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn set_media_network_policy_state(policy: Option<MediaNetworkPolicyInput>) {
    if let Ok(mut state) = MEDIA_NETWORK_POLICY.lock() {
        *state = match policy {
            Some(value) => MediaNetworkPolicyState {
                request_headers: value.request_headers,
                host_mappings: value.host_mappings,
                doh: value.doh,
                proxy_rules: value.proxy_rules,
                tls_mode: value.tls_mode,
                ca_bundle_path: value.ca_bundle_path,
                hostname_verification: value.hostname_verification,
            },
            None => MediaNetworkPolicyState::default(),
        };
    }
    if let Ok(mut cache) = MEDIA_HTTP_CLIENT_CACHE.lock() {
        cache.clear();
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
        generation: current_media_network_policy_generation(),
        request_header_rule_count: state.request_headers.len(),
        host_mapping_count: state.host_mappings.len(),
        doh_entry_count: state.doh.len(),
        proxy_rule_count: state.proxy_rules.len(),
        supports_doh_resolver: doh_config.is_some(),
        active_doh_provider_name: doh_config
            .as_ref()
            .map(|config| config.active_provider_name.clone()),
        unsupported_doh_entry_count: doh_config
            .as_ref()
            .map(|config| config.unsupported_entry_count)
            .unwrap_or(state.doh.len()),
        tls_mode: state.tls_mode,
        hostname_verification: state.hostname_verification,
        ca_bundle_configured: state
            .ca_bundle_path
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty()),
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

fn apply_ca_bundle(
    mut builder: ClientBuilder,
    ca_bundle_path: Option<&str>,
) -> Result<ClientBuilder, String> {
    let Some(path) = ca_bundle_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(builder);
    };
    let bytes = std::fs::read(path).map_err(|err| format!("read CA bundle failed: {err}"))?;
    let certificate = Certificate::from_pem(&bytes)
        .or_else(|_| Certificate::from_der(&bytes))
        .map_err(|err| format!("parse CA bundle failed: {err}"))?;
    builder = builder.add_root_certificate(certificate);
    Ok(builder)
}

fn build_http_client(
    force_close_pool: bool,
    proxy_url: Option<&str>,
    follow_redirects: bool,
    timeout: Duration,
) -> Result<Client, String> {
    let policy = current_media_network_policy();
    let connect_timeout = std::cmp::min(timeout, Duration::from_secs(5));
    let mut builder = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .danger_accept_invalid_certs(policy.tls_mode == MediaTlsMode::AllowInvalid)
        .danger_accept_invalid_hostnames(
            policy.hostname_verification == MediaHostnameVerificationMode::AllowInvalid,
        )
        .connect_timeout(connect_timeout)
        .timeout(timeout)
        .tcp_keepalive(Some(Duration::from_secs(20)));
    if force_close_pool {
        builder = builder.pool_max_idle_per_host(0);
    }
    builder = builder.redirect(if follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    });
    if let Some(proxy_url) = proxy_url.map(str::trim).filter(|value| !value.is_empty()) {
        let proxy = reqwest::Proxy::all(proxy_url)
            .map_err(|err| format!("build proxy `{proxy_url}` failed: {err}"))?;
        builder = builder.proxy(proxy);
    }
    builder = apply_ca_bundle(builder, policy.ca_bundle_path.as_deref())?;
    builder = configure_http_client_builder(builder)?;
    builder.build().map_err(|e| e.to_string())
}

fn get_cached_http_client(
    force_close_pool: bool,
    proxy_url: Option<&str>,
    follow_redirects: bool,
    timeout: Duration,
) -> Result<Client, String> {
    let generation = current_media_network_policy_generation();
    let cache_key = format!(
        "{generation}|{}|{}|{}|{}",
        if force_close_pool {
            "rescue"
        } else {
            "primary"
        },
        proxy_url.unwrap_or_default(),
        if follow_redirects { "redir" } else { "noredir" },
        timeout.as_millis()
    );
    let mut cache = MEDIA_HTTP_CLIENT_CACHE.lock().map_err(|e| e.to_string())?;
    if let Some(cached_result) = cache.get(&cache_key) {
        return cached_result.clone();
    }
    let built = build_http_client(force_close_pool, proxy_url, follow_redirects, timeout);
    cache.insert(cache_key, built.clone());
    built
}

pub fn build_transport_client(
    resolved: &ResolvedMediaRequest,
    follow_redirects: bool,
    timeout: Duration,
) -> Result<Client, String> {
    get_cached_http_client(
        false,
        resolved
            .matched_proxy_rule
            .as_ref()
            .map(|rule| rule.proxy_url.as_str()),
        follow_redirects,
        timeout,
    )
}

pub fn build_rescue_transport_client(
    resolved: &ResolvedMediaRequest,
    follow_redirects: bool,
    timeout: Duration,
) -> Result<Client, String> {
    get_cached_http_client(
        true,
        resolved
            .matched_proxy_rule
            .as_ref()
            .map(|rule| rule.proxy_url.as_str()),
        follow_redirects,
        timeout,
    )
}

pub fn build_client() -> Result<Client, String> {
    get_cached_http_client(false, None, true, Duration::from_secs(10))
}

pub fn build_rescue_client() -> Result<Client, String> {
    get_cached_http_client(true, None, true, Duration::from_secs(10))
}

fn match_proxy_rule(rules: &[MediaProxyRule], url: &str) -> Option<MediaProxyRule> {
    rules
        .iter()
        .find(|rule| {
            !rule.proxy_url.trim().is_empty() && matches_host_pattern(rule.host.trim(), url)
        })
        .cloned()
}

fn should_log_insecure_tls(
    tls_mode: &MediaTlsMode,
    hostname_verification: &MediaHostnameVerificationMode,
) -> bool {
    *tls_mode == MediaTlsMode::AllowInvalid
        || *hostname_verification == MediaHostnameVerificationMode::AllowInvalid
}

fn current_insecure_tls_state() -> bool {
    let policy = current_media_network_policy();
    should_log_insecure_tls(&policy.tls_mode, &policy.hostname_verification)
}

fn empty_resolved_request(
    url: &str,
    headers: Option<HashMap<String, String>>,
) -> ResolvedMediaRequest {
    ResolvedMediaRequest {
        url: url.to_string(),
        headers,
        matched_doh: None,
        matched_proxy_rule: None,
        insecure_tls: current_insecure_tls_state(),
    }
}

fn apply_host_mappings(
    url: &str,
    headers: Option<HashMap<String, String>>,
    mappings: &[MediaHostMapping],
) -> ResolvedMediaRequest {
    let Ok(parsed) = url::Url::parse(url) else {
        return empty_resolved_request(url, headers);
    };

    let Some(matched) = mappings
        .iter()
        .find(|mapping| matches_host_pattern(&mapping.host, parsed.host_str().unwrap_or_default()))
    else {
        return ResolvedMediaRequest {
            url: parsed.to_string(),
            headers,
            matched_doh: None,
            matched_proxy_rule: None,
            insecure_tls: current_insecure_tls_state(),
        };
    };

    let mut rewritten = parsed.clone();
    let original_host = rewritten.host_str().unwrap_or_default().to_string();
    if rewritten.set_host(Some(matched.target.trim())).is_err() {
        return empty_resolved_request(&parsed.to_string(), headers);
    }

    let mut host_header = HashMap::new();
    if !original_host.is_empty() {
        host_header.insert("Host".to_string(), original_host);
    }

    ResolvedMediaRequest {
        url: rewritten.to_string(),
        headers: merge_headers(headers, Some(host_header)),
        matched_doh: None,
        matched_proxy_rule: None,
        insecure_tls: current_insecure_tls_state(),
    }
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
    resolved.matched_proxy_rule = match_proxy_rule(&policy.proxy_rules, &resolved.url);
    resolved.insecure_tls =
        should_log_insecure_tls(&policy.tls_mode, &policy.hostname_verification);
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
    use std::sync::{Mutex, OnceLock};

    fn policy_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("policy test lock poisoned")
    }

    #[test]
    fn resolves_host_mapping_and_request_headers() {
        let _guard = policy_test_guard();
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
            proxy_rules: Vec::new(),
            tls_mode: MediaTlsMode::Strict,
            ca_bundle_path: None,
            hostname_verification: MediaHostnameVerificationMode::Strict,
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
        let _guard = policy_test_guard();
        set_media_network_policy_state(None);
        let resolved = resolve_media_request("https://plain.example.com/demo", None);
        assert_eq!(resolved.url, "https://plain.example.com/demo");
        assert!(resolved.headers.is_none());
        assert!(resolved.matched_doh.is_none());
    }

    #[test]
    fn reports_network_policy_status() {
        let _guard = policy_test_guard();
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
            proxy_rules: vec![MediaProxyRule {
                host: "example.com".to_string(),
                proxy_url: "socks5://127.0.0.1:1080".to_string(),
            }],
            tls_mode: MediaTlsMode::AllowInvalid,
            ca_bundle_path: Some("D:/certs/dev-ca.pem".to_string()),
            hostname_verification: MediaHostnameVerificationMode::AllowInvalid,
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
        assert_eq!(status.proxy_rule_count, 1);
        assert_eq!(status.tls_mode, MediaTlsMode::AllowInvalid);
        assert_eq!(
            status.hostname_verification,
            MediaHostnameVerificationMode::AllowInvalid
        );
        assert!(status.ca_bundle_configured);
    }

    #[test]
    fn supports_custom_doh_urls_with_explicit_ips_and_endpoint() {
        let _guard = policy_test_guard();
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
        let _guard = policy_test_guard();
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
