use std::time::{Duration, Instant};

use regex::Regex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use super::{apply_request_headers, build_transport_client, resolve_media_request};

const JIEXI_WORKER_LABEL: &str = "jiexi_worker";

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiexiClickActionInput {
    pub kind: String,
    pub target: String,
    pub frame_selector: Option<String>,
    pub index: Option<usize>,
}

fn looks_like_image_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]
        .iter()
        .any(|token| lower.contains(token))
}

fn looks_like_direct_media_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if !lower.starts_with("http") || looks_like_image_url(&lower) {
        return false;
    }

    lower.contains(".m3u8")
        || lower.contains(".mp4")
        || lower.contains(".flv")
        || lower.contains(".mpd")
        || lower.contains(".m4s")
        || lower.contains(".m2ts")
        || lower.contains(".ts")
        || lower.contains(".webm")
        || lower.contains(".mkv")
        || lower.contains(".mov")
        || lower.contains("mime=video")
        || lower.contains("contenttype=video")
        || lower.contains("type=m3u8")
        || lower.contains("type=mp4")
        || lower.contains("type=flv")
        || lower.contains("type=mpd")
        || lower.contains("video/mp2t")
}

fn trim_url_punctuation(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(&['\\', '"', '\'', ',', ';', ')', ']'][..])
        .to_string()
}

fn strip_encoded_url_tail(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let markers = [
        "%22%20",
        "%22%3e",
        "%22>",
        "%27%20",
        "%3ciframe",
        "%3cscript",
        "%3c/html",
        "%3c/body",
        "%20width=",
        "%20height=",
        "%20frameborder=",
        "%20allowfullscreen",
        "%20sandbox=",
        "%20scrolling=",
        "%24%28%27",
        "%24%28%22",
        "%3bfunction%20",
    ];
    let cut_idx = markers.iter().filter_map(|marker| lower.find(marker)).min();
    if let Some(index) = cut_idx {
        value[..index].to_string()
    } else {
        value.to_string()
    }
}

fn extract_first_http_url(text: &str) -> Option<String> {
    let re = Regex::new(r#"https?://[^\s"'<>]+"#).ok()?;
    let matched = re
        .find_iter(text)
        .map(|m| trim_url_punctuation(m.as_str()))
        .find(|candidate| candidate.starts_with("http"));
    matched
}

fn sanitize_playable_url_candidate(value: String) -> String {
    let normalized = value
        .trim()
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("\\u0026", "&");
    let direct =
        extract_first_http_url(&normalized).unwrap_or_else(|| trim_url_punctuation(&normalized));
    trim_url_punctuation(&strip_encoded_url_tail(&direct))
}

fn decode_playable_url_candidate(mut cand: String) -> String {
    if let Some(stripped) = cand.strip_prefix("url=") {
        cand = stripped.to_string();
    } else if let Some(stripped) = cand.strip_prefix("v=") {
        cand = stripped.to_string();
    } else if let Some(idx) = cand.find("url=") {
        cand = cand[idx + 4..].to_string();
    }

    if cand.starts_with("aHR0c") {
        use base64::Engine;
        if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(cand.as_bytes()) {
            if let Ok(utf8) = String::from_utf8(decoded) {
                cand = utf8;
            }
        }
    }

    if cand.len() >= 14 && cand.chars().all(|c| c.is_ascii_hexdigit()) {
        let mut bytes = Vec::new();
        let mut ok = true;
        for i in (0..cand.len()).step_by(2) {
            if let Ok(b) = u8::from_str_radix(&cand[i..i + 2], 16) {
                bytes.push(b);
            } else {
                ok = false;
                break;
            }
        }
        if ok {
            if let Ok(utf8) = String::from_utf8(bytes) {
                if utf8.starts_with("http") {
                    cand = utf8;
                }
            }
        }
    }

    if cand.contains("%3A") || cand.contains("%2F") || cand.contains("%3a") || cand.contains("%2f")
    {
        if let Ok(u) = url::Url::parse(&format!("http://localhost?q={}", cand)) {
            if let Some((_, decoded)) = u.query_pairs().next() {
                if decoded.starts_with("http") {
                    cand = decoded.to_string();
                }
            }
        }
    }

    sanitize_playable_url_candidate(cand)
}

fn extract_playable_url_from_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let pointers = [
            "/url",
            "/data/url",
            "/data/playurl",
            "/data/m3u8",
            "/playurl",
            "/m3u8",
        ];
        for pointer in pointers {
            if let Some(url) = json_val.pointer(pointer).and_then(|v| v.as_str()) {
                let clean = url.trim();
                let decoded = sanitize_playable_url_candidate(decode_playable_url_candidate(
                    clean.to_string(),
                ));
                if decoded.starts_with("http") {
                    return Some(decoded);
                }
            }
        }
    }

    let decoded_trimmed =
        sanitize_playable_url_candidate(decode_playable_url_candidate(trimmed.to_string()));
    if decoded_trimmed.starts_with("http") && looks_like_direct_media_url(&decoded_trimmed) {
        return Some(decoded_trimmed);
    }
    if trimmed.starts_with("http") {
        let sanitized_trimmed = sanitize_playable_url_candidate(trimmed.to_string());
        if sanitized_trimmed.starts_with("http") && looks_like_direct_media_url(&sanitized_trimmed)
        {
            return Some(sanitized_trimmed);
        }
    }

    let normalized = trimmed
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("\\u0026", "&");

    let re = Regex::new(r#"https?://[^\s"'<>]+"#).ok()?;
    let matched = re
        .find_iter(&normalized)
        .map(|m| {
            m.as_str()
                .trim_end_matches(&['\\', '"', '\'', ',', ';'][..])
                .to_string()
        })
        .find_map(|candidate| {
            let decoded = sanitize_playable_url_candidate(decode_playable_url_candidate(candidate));
            if looks_like_direct_media_url(&decoded) {
                Some(decoded)
            } else {
                None
            }
        });

    if matched.is_none() {
        let regex_blind_decoding =
            sanitize_playable_url_candidate(decode_playable_url_candidate(normalized.to_string()));
        if regex_blind_decoding.starts_with("http")
            && looks_like_direct_media_url(&regex_blind_decoding)
        {
            return Some(regex_blind_decoding);
        }
    }

    matched
}

fn looks_like_m3u8_manifest(text: &str) -> bool {
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    trimmed.starts_with("#EXTM3U")
}

fn extract_manifest_payload(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if let Some(index) = normalized.find("#EXTM3U") {
        normalized[index..].to_string()
    } else {
        normalized
    }
}

fn looks_like_expired_wrapped_media_link(text: &str) -> bool {
    let normalized = text.to_ascii_lowercase();
    normalized.contains("链接失效")
        || normalized.contains("请重新获取")
        || normalized.contains("link expired")
        || normalized.contains("expired")
}

fn looks_like_image_segment_line(line: &str) -> bool {
    let lower = line.trim().to_ascii_lowercase();
    if lower.is_empty() || lower.starts_with('#') {
        return false;
    }

    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"]
        .iter()
        .any(|token| lower.contains(token))
}

fn manifest_looks_like_nonvideo_hls(text: &str) -> bool {
    if !looks_like_m3u8_manifest(text) {
        return false;
    }

    let mut media_lines = 0usize;
    let mut image_lines = 0usize;
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        media_lines += 1;
        if looks_like_image_segment_line(line) {
            image_lines += 1;
        }
    }

    media_lines > 0 && image_lines == media_lines
}

fn extract_playable_target_from_wrapped_response(text: &str, target_url: &str) -> Option<String> {
    let normalized = extract_manifest_payload(text);
    if let Some(found) = extract_playable_url_from_text(&normalized) {
        return Some(found);
    }
    if looks_like_m3u8_manifest(&normalized) && !manifest_looks_like_nonvideo_hls(&normalized) {
        let normalized = target_url.trim();
        if normalized.starts_with("http") && !looks_like_image_url(normalized) {
            return Some(normalized.to_string());
        }
    }
    None
}

async fn request_jiexi_text(
    client: &reqwest::Client,
    call_url: &str,
    video_url: &str,
    extra_headers: &Option<std::collections::HashMap<String, String>>,
) -> Result<String, String> {
    let resolved = resolve_media_request(call_url, extra_headers.clone());
    let mut builder = client
        .get(&resolved.url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
        .header("Referer", video_url);
    builder = apply_request_headers(builder, &resolved.headers);

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("Jiexi request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Jiexi service returned HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// Resolve a jiexi/parse service URL.
/// Calls `{jiexi_prefix}{video_page_url}` and extracts the real stream URL from the response.
/// Supports both plain-text URL responses and JSON `{"url":"..."}` responses.
pub async fn resolve_jiexi(
    jiexi_prefix: String,
    video_url: String,
    extra_headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let encoded_video =
        url::form_urlencoded::byte_serialize(video_url.as_bytes()).collect::<String>();
    let call_url = format!("{}{}", jiexi_prefix.trim_end_matches('&'), encoded_video);
    let resolved = resolve_media_request(&call_url, extra_headers.clone());
    let client = build_transport_client(
        &resolved,
        true,
        Duration::from_millis(timeout_ms.unwrap_or(10_000).max(500)),
    )?;
    let text = request_jiexi_text(&client, &call_url, &video_url, &extra_headers).await?;
    if let Some(found) = extract_playable_url_from_text(&text) {
        return Ok(found);
    }

    let trimmed = text.trim().to_string();
    let looks_like_html = trimmed.starts_with("<!") || trimmed.to_lowercase().starts_with("<html");

    if looks_like_html {
        let joiner = if call_url.contains('?') { "&" } else { "?" };
        let variants = [
            format!("{call_url}{joiner}type=json"),
            format!("{call_url}{joiner}format=json"),
            format!("{call_url}{joiner}ajax=1"),
            format!("{call_url}{joiner}api=1"),
            format!("{call_url}{joiner}jx=1&format=json"),
        ];
        for alt in variants {
            if let Ok(alt_text) =
                request_jiexi_text(&client, &alt, &video_url, &extra_headers).await
            {
                if let Some(found) = extract_playable_url_from_text(&alt_text) {
                    return Ok(found);
                }
            }
        }
        return Err("jiexi_needs_browser".to_string());
    }

    Err(format!(
        "Jiexi service did not return a valid URL. Response: {}",
        &trimmed[..trimmed.len().min(200)]
    ))
}

pub async fn resolve_wrapped_media_url(
    target_url: String,
    extra_headers: Option<std::collections::HashMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    let resolved = resolve_media_request(&target_url, extra_headers.clone());
    let client = build_transport_client(
        &resolved,
        true,
        Duration::from_millis(timeout_ms.unwrap_or(10_000).max(500)),
    )?;
    let text = request_jiexi_text(&client, &target_url, &target_url, &extra_headers).await?;
    if let Some(found) = extract_playable_target_from_wrapped_response(&text, &target_url) {
        return Ok(found);
    }
    if looks_like_expired_wrapped_media_link(&text) {
        return Err("wrapped_media_link_expired".to_string());
    }

    let trimmed = text.trim().to_string();
    Err(format!(
        "Wrapped media endpoint did not return a playable URL. Response: {}",
        &trimmed[..trimmed.len().min(200)]
    ))
}

/// Resolve a jiexi/parse service URL using a hidden WebView.
/// This is used for services that require JavaScript execution to obtain the stream URL.
pub async fn resolve_jiexi_webview(
    app: AppHandle,
    jiexi_prefix: String,
    video_url: String,
    timeout_ms: Option<u64>,
    visible: Option<bool>,
    click_actions: Option<Vec<JiexiClickActionInput>>,
) -> Result<String, String> {
    let encoded_video =
        url::form_urlencoded::byte_serialize(video_url.as_bytes()).collect::<String>();
    let target = format!("{}{}", jiexi_prefix.trim_end_matches('&'), encoded_video);
    let target_url = Url::parse(&target).map_err(|e| format!("Invalid jiexi URL: {e}"))?;
    let click_actions_json =
        serde_json::to_string(&click_actions.unwrap_or_default()).map_err(|e| e.to_string())?;

    if let Some(existing) = app.get_webview_window(JIEXI_WORKER_LABEL) {
        let _ = existing.destroy(); // destroy is more definitive than close for background workers
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    let window =
        WebviewWindowBuilder::new(&app, JIEXI_WORKER_LABEL, WebviewUrl::External(target_url))
            .title("Jiexi Worker")
            .visible(visible.unwrap_or(false))
            .resizable(false)
            .skip_taskbar(true)
            .build()
            .map_err(|e| format!("Failed to create jiexi webview: {e}"))?;

    let inject = r##"(() => {{
        if (window.__HALO_JIEXI_ACTIVE__) return;
        window.__HALO_JIEXI_ACTIVE__ = true;
        const clickActions = __HALO_CLICK_ACTIONS__;
        const found = new Set();
        const urlRegex = /https?:\/\/[^\s"'<>]+/ig;
        const looksLikeDirectMediaUrl = (value) => {
            if (!value || typeof value !== "string") return false;
            const lower = value.trim().toLowerCase();
            if (!lower.startsWith("http")) return false;
            if (/\.(png|jpe?g|gif|webp|bmp|ico)(\?|$)/i.test(lower)) return false;
            return lower.includes(".m3u8")
                || lower.includes(".mp4")
                || lower.includes(".flv")
                || lower.includes(".mpd")
                || lower.includes(".m4s")
                || lower.includes(".m2ts")
                || lower.includes(".ts")
                || lower.includes(".webm")
                || lower.includes(".mkv")
                || lower.includes(".mov")
                || lower.includes("mime=video")
                || lower.includes("contenttype=video")
                || lower.includes("type=m3u8")
                || lower.includes("type=mp4")
                || lower.includes("type=flv")
                || lower.includes("type=mpd")
                || lower.includes("video/mp2t");
        };
        const markFound = (u) => {
            if (!u || typeof u !== "string") return;
            if (!u.startsWith("http")) return;
            if (!looksLikeDirectMediaUrl(u)) return;
            if (found.has(u)) return;
            found.add(u);
            document.title = `HALO_URL:${u}`;
        };

        const scanText = (text) => {
            if (!text || typeof text !== "string") return;
            let match;
            const local = new RegExp(urlRegex);
            while ((match = local.exec(text)) !== null) {
                markFound(match[0]);
            }
        };

        const readMediaEl = (el) => {
            try {
                const src = el.currentSrc || el.src || el.getAttribute("src");
                if (src) markFound(src);
            } catch (e) {
                // ignore
            }
        };

        const scanDom = () => {
            try {
                document.querySelectorAll("video, source").forEach(el => readMediaEl(el));
                document.querySelectorAll("script").forEach(el => scanText(el.textContent || ""));
                scanText(document.documentElement?.innerHTML || "");
                if (window.performance && typeof window.performance.getEntriesByType === "function") {
                    const entries = window.performance.getEntriesByType("resource") || [];
                    entries.forEach(e => {
                        if (e && e.name) markFound(String(e.name));
                    });
                }
            } catch (e) {
                // ignore
            }
        };

        const markPlaying = () => {
            try {
                let playing = false;
                document.querySelectorAll("video").forEach(v => {
                    if (v && typeof v.currentTime === "number" && v.currentTime > 0.1) {
                        playing = true;
                    }
                });
                if (playing) {
                    document.title = "HALO_PLAYING";
                }
            } catch (e) {
                // ignore
            }
        };

        const dispatchTrustedClick = (el) => {
            if (!el) return;
            try {
                el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            } catch (e) {
                // ignore
            }
        };

        const resolveActionDocument = (frameSelector) => {
            if (!frameSelector || typeof frameSelector !== "string") return document;
            try {
                const frame = document.querySelector(frameSelector);
                if (frame && frame.contentWindow && frame.contentWindow.document) {
                    return frame.contentWindow.document;
                }
            } catch (e) {
                // ignore cross-origin or missing frame access
            }
            return null;
        };

        const clickByText = (doc, target, index) => {
            if (!doc || !target) return;
            try {
                const nodes = Array.from(doc.querySelectorAll("button, a, div, span"));
                const matched = nodes.filter((el) => {
                    const text = (el.textContent || "").trim().toLowerCase();
                    const cls = (el.className || "").toString().toLowerCase();
                    const id = (el.id || "").toString().toLowerCase();
                    const hay = `${text} ${cls} ${id}`;
                    return hay.includes(String(target).toLowerCase());
                });
                if (typeof index === "number") {
                    dispatchTrustedClick(matched[index] || null);
                    return;
                }
                matched.forEach((el) => dispatchTrustedClick(el));
            } catch (e) {
                // ignore
            }
        };

        const runExtraClick = () => {{
            if (!Array.isArray(clickActions) || clickActions.length === 0) return;
            try {{
                clickActions.forEach((action) => {{
                    if (!action || typeof action !== "object") return;
                    const doc = resolveActionDocument(action.frameSelector);
                    if (!doc) return;
                    if (action.kind === "selector") {{
                        const nodes = Array.from(doc.querySelectorAll(String(action.target || "")));
                        if (typeof action.index === "number") {{
                            dispatchTrustedClick(nodes[action.index] || null);
                            return;
                        }}
                        nodes.forEach((el) => dispatchTrustedClick(el));
                        return;
                    }}
                    if (action.kind === "text") {{
                        clickByText(doc, action.target, action.index);
                    }}
                }});
            }} catch (e) {{
                // ignore
            }}
        }};

        const tryAutoPlay = () => {
            try {
                document.querySelectorAll("video").forEach(v => {
                    if (v && typeof v.play === "function") {
                        v.muted = true;
                        v.play().catch(() => void 0);
                    }
                });
                const selectors = ["button", "a", "div", "span"];
                const playHints = ["play", "播放", "开始", "btn-play", "vjs-big-play-button"];
                const nodes = document.querySelectorAll(selectors.join(","));
                nodes.forEach(el => {
                    const text = (el.textContent || "").trim();
                    const cls = (el.className || "").toString();
                    const id = (el.id || "").toString();
                    const hay = `${text} ${cls} ${id}`.toLowerCase();
                    if (playHints.some(h => hay.includes(h))) {
                        (el).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
                    }
                });
                runExtraClick();
            } catch (e) {
                // ignore
            }
        };

        const hookNetwork = () => {
            try {
                const origFetch = window.fetch;
                window.fetch = function (...args) {
                    try {
                        const first = args[0];
                        if (typeof first === "string") markFound(first);
                        else if (first && typeof first.url === "string") markFound(first.url);
                    } catch (e) { /* ignore */ }
                    const p = origFetch.apply(this, args);
                    try {
                        p.then((resp) => {
                            try {
                                const ct = (resp.headers && resp.headers.get("content-type")) || "";
                                if (ct.includes("m3u8") || ct.includes("json") || ct.includes("text")) {
                                    resp.clone().text().then((text) => scanText(text)).catch(() => void 0);
                                }
                            } catch (e) {
                                // ignore
                            }
                        }).catch(() => void 0);
                    } catch (e) {
                        // ignore
                    }
                    return p;
                };
                const origOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function (method, url) {
                    try { markFound(url); } catch (e) { /* ignore */ }
                    return origOpen.apply(this, arguments);
                };
                const origSend = XMLHttpRequest.prototype.send;
                XMLHttpRequest.prototype.send = function () {
                    try {
                        this.addEventListener("readystatechange", function () {
                            try {
                                if (this.readyState === 4 && typeof this.responseText === "string") {
                                    scanText(this.responseText);
                                }
                            } catch (e) { /* ignore */ }
                        });
                    } catch (e) { /* ignore */ }
                    return origSend.apply(this, arguments);
                };
            } catch (e) {
                // ignore
            }
        };

        const hookAttributes = () => {
            try {
                const origSetAttribute = Element.prototype.setAttribute;
                Element.prototype.setAttribute = function (name, value) {
                    try { if (String(name).toLowerCase() === "src") markFound(value); } catch (e) { /* ignore */ }
                    return origSetAttribute.apply(this, arguments);
                };
                const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
                if (desc && desc.set && desc.get) {
                    Object.defineProperty(HTMLMediaElement.prototype, "src", {
                        get: function () { return desc.get.call(this); },
                        set: function (value) { try { markFound(value); } catch (e) {} return desc.set.call(this, value); }
                    });
                }
            } catch (e) {
                // ignore
            }
        };

        const hookMessages = () => {
            try {
                window.addEventListener("message", (event) => {
                    if (!event) return;
                    const data = event.data;
                    if (typeof data === "string") scanText(data);
                });
            } catch (e) {
                // ignore
            }
        };

        const hookObserver = () => {
            try {
                const observer = new MutationObserver((mutations) => {
                    for (const m of mutations) {
                        if (m.type === "attributes" && m.attributeName === "src") {
                            const t = m.target;
                            if (t && t.getAttribute) {
                                const src = t.getAttribute("src");
                                if (src) markFound(src);
                            }
                        }
                        if (m.addedNodes && m.addedNodes.length) {
                            m.addedNodes.forEach(node => {
                                if (node && node.querySelectorAll) {
                                    node.querySelectorAll("video, source").forEach(el => readMediaEl(el));
                                }
                            });
                        }
                    }
                });
                observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
            } catch (e) {
                // ignore
            }
        };

        hookNetwork();
        hookAttributes();
        hookMessages();
        hookObserver();
        scanDom();
        tryAutoPlay();
        setInterval(() => {
            tryAutoPlay();
            scanDom();
            markPlaying();
        }, 700);
    }})();"##
        .replace("__HALO_CLICK_ACTIONS__", &click_actions_json)
        .replace("{{", "{")
        .replace("}}", "}");

    window
        .eval(inject)
        .map_err(|e| format!("Jiexi inject failed: {e}"))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(25_000));
    loop {
        if Instant::now() >= deadline {
            let _ = window.destroy();
            return Err("jiexi_webview_timeout".to_string());
        }

        let title = window.title().unwrap_or_default();
        if let Some(url) = title.strip_prefix("HALO_URL:") {
            let _ = window.destroy();
            if let Some(found) = extract_playable_url_from_text(url) {
                return Ok(found);
            }
            let sanitized = sanitize_playable_url_candidate(url.to_string());
            return Ok(if sanitized.starts_with("http") {
                sanitized
            } else {
                url.to_string()
            });
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_playable_target_from_wrapped_response, extract_playable_url_from_text,
        looks_like_expired_wrapped_media_link, manifest_looks_like_nonvideo_hls,
    };

    #[test]
    fn extracts_dash_like_url_from_embedded_html() {
        let html =
            r#"<script>const play="https://cdn.example.com/live/index.mpd?token=1";</script>"#;
        assert_eq!(
            extract_playable_url_from_text(html).as_deref(),
            Some("https://cdn.example.com/live/index.mpd?token=1")
        );
    }

    #[test]
    fn extracts_flv_url_from_json_payload() {
        let payload = r#"{"data":{"url":"https://cdn.example.com/stream.flv?auth=1"}}"#;
        assert_eq!(
            extract_playable_url_from_text(payload).as_deref(),
            Some("https://cdn.example.com/stream.flv?auth=1")
        );
    }

    #[test]
    fn skips_image_urls() {
        let payload = r#"<img src="https://cdn.example.com/poster.png">"#;
        assert!(extract_playable_url_from_text(payload).is_none());
    }

    #[test]
    fn trims_encoded_iframe_tail_from_m3u8_url() {
        let payload = "url=http%3A%2F%2Fbeyond.example.com%2F2026-03-22%2Fplay.m3u8%3Fts%3D1774177202-0-0-token%2522%2520width%253D%2522100%2525%2522%2520height%253D%2522100%2525%2522%253E%253C%2Fiframe%253E%253Cscript%253Efunction%2520SUIYI(url)%257B%2524(%2527";
        assert_eq!(
            extract_playable_url_from_text(payload).as_deref(),
            Some("http://beyond.example.com/2026-03-22/play.m3u8?ts=1774177202-0-0-token")
        );
    }

    #[test]
    fn returns_wrapped_target_when_body_is_hls_manifest() {
        let target = "http://wrapper.example.com/api/getM3u8?url=wrapped";
        let body = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5,\nsegment.ts\n";
        assert_eq!(
            extract_playable_target_from_wrapped_response(body, target).as_deref(),
            Some(target)
        );
    }

    #[test]
    fn returns_wrapped_target_when_body_contains_pre_wrapped_hls_manifest() {
        let target = "http://wrapper.example.com/api/getM3u8?url=wrapped";
        let body = "<pre>\n#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5,\nsegment.ts\n</pre>";
        assert_eq!(
            extract_playable_target_from_wrapped_response(body, target).as_deref(),
            Some(target)
        );
    }

    #[test]
    fn rejects_wrapped_target_when_manifest_points_to_images() {
        let target = "http://wrapper.example.com/api/getM3u8?url=wrapped";
        let body = "#EXTM3U\n#EXTINF:10,\nhttps://cdn.example.com/poster-1.png\n#EXTINF:10,\nhttps://cdn.example.com/poster-2.jpg\n";
        assert!(manifest_looks_like_nonvideo_hls(body));
        assert!(extract_playable_target_from_wrapped_response(body, target).is_none());
    }

    #[test]
    fn detects_expired_wrapped_media_pages() {
        let body = "<pre>靓仔链接失效了 请重新获取</pre>";
        assert!(looks_like_expired_wrapped_media_link(body));
    }
}
