use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, CACHE_CONTROL, CONNECTION, PRAGMA, USER_AGENT,
};

const SPIDER_ARTIFACT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) HaloSpider/1.0";

pub(crate) struct SpiderArtifactDownload {
    pub bytes: Vec<u8>,
    pub used_rescue_transport: bool,
}

fn build_download_headers(force_close: bool) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(SPIDER_ARTIFACT_USER_AGENT),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
    if force_close {
        headers.insert(CONNECTION, HeaderValue::from_static("close"));
    }
    Ok(headers)
}

async fn fetch_spider_artifact_once(
    client: &reqwest::Client,
    url: &str,
    force_close: bool,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .headers(build_download_headers(force_close)?)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.is_empty() {
        return Err("empty response body".to_string());
    }
    Ok(bytes.to_vec())
}

fn should_retry_with_rescue_transport(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("error decoding response body")
        || lower.contains("content decoding")
        || lower.contains("unexpected eof")
        || lower.contains("connection closed")
        || lower.contains("body error")
        || lower.contains("chunked")
}

pub(crate) async fn download_spider_artifact(url: &str) -> Result<SpiderArtifactDownload, String> {
    let primary_client = crate::media_cmds::build_client()?;
    match fetch_spider_artifact_once(&primary_client, url, false).await {
        Ok(bytes) => Ok(SpiderArtifactDownload {
            bytes,
            used_rescue_transport: false,
        }),
        Err(primary_err) => {
            if !should_retry_with_rescue_transport(&primary_err) {
                return Err(primary_err);
            }
            let rescue_client = crate::media_cmds::build_rescue_client()?;
            let bytes = fetch_spider_artifact_once(&rescue_client, url, true)
                .await
                .map_err(|rescue_err| format!("primary={primary_err}; rescue={rescue_err}"))?;
            Ok(SpiderArtifactDownload {
                bytes,
                used_rescue_transport: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::should_retry_with_rescue_transport;

    #[test]
    fn retries_on_decode_errors() {
        assert!(should_retry_with_rescue_transport(
            "error decoding response body"
        ));
        assert!(should_retry_with_rescue_transport(
            "unexpected eof while reading body"
        ));
        assert!(should_retry_with_rescue_transport(
            "connection closed before message completed"
        ));
    }

    #[test]
    fn skips_rescue_on_normal_http_failures() {
        assert!(!should_retry_with_rescue_transport("HTTP 404"));
        assert!(!should_retry_with_rescue_transport("operation timed out"));
    }
}
