use std::time::{Duration, Instant};

use regex::Regex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use super::{apply_request_headers, build_client, resolve_media_request};

const JIEXI_WORKER_LABEL: &str = "jiexi_worker";

#[derive(Clone, Debug, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiexiClickActionInput {
    pub kind: String,
    pub target: String,
    pub frame_selector: Option<String>,
    pub index: Option<usize>,
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
                if clean.starts_with("http") {
                    return Some(clean.to_string());
                }
            }
        }
    }

    if trimmed.starts_with("http") {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed
        .replace("\\/", "/")
        .replace("&amp;", "&")
        .replace("\\u0026", "&");

    let re = Regex::new(r#"https?://[^\s"'<>]+?(?:\.m3u8|\.mp4)[^\s"'<>]*"#).ok()?;
    re.find(&normalized).map(|m| m.as_str().to_string())
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
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
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
) -> Result<String, String> {
    let encoded_video =
        url::form_urlencoded::byte_serialize(video_url.as_bytes()).collect::<String>();
    let call_url = format!("{}{}", jiexi_prefix.trim_end_matches('&'), encoded_video);
    let client = build_client()?;
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
        let _ = existing.close();
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
        const regex = /https?:\/\/[^\s"'<>]+?\.(m3u8|mp4)(\?[^\s"'<>]*)?/ig;
        const markFound = (u) => {
            if (!u || typeof u !== "string") return;
            if (!u.startsWith("http")) return;
            if (!u.match(regex)) return;
            if (found.has(u)) return;
            found.add(u);
            document.title = `HALO_URL:${u}`;
        };

        const scanText = (text) => {
            if (!text || typeof text !== "string") return;
            let match;
            const local = new RegExp(regex);
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
            let _ = window.close();
            return Err("jiexi_webview_timeout".to_string());
        }

        let title = window.title().unwrap_or_default();
        if let Some(url) = title.strip_prefix("HALO_URL:") {
            let _ = window.close();
            return Ok(url.to_string());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}
