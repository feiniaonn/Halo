#[allow(dead_code)]
pub async fn fetch(url: &str) -> Option<String> {
    let target = url.trim();
    if !(target.starts_with("http://") || target.starts_with("https://")) {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("halo-desktop/lyrics-scrape")
        .build()
        .ok()?;
    let resp = client.get(target).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}
