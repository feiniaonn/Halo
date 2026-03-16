use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use tokio::process::Command;

#[derive(Debug, Clone)]
pub(crate) struct SpiderProxyBridgeContext {
    pub java_bin: PathBuf,
    pub java_home: PathBuf,
    pub bridge_jar: PathBuf,
    pub libs_root: Option<PathBuf>,
    pub spider_jar: PathBuf,
    pub site_key: String,
    pub class_hint: String,
    pub resolved_ext: String,
    pub compat_jars: Vec<PathBuf>,
    pub fallback_jar: Option<PathBuf>,
    pub prefer_compat_runtime: bool,
    pub proxy_base_url: String,
}

#[derive(Debug, Clone)]
pub(crate) struct SpiderProxyBridgeResponse {
    pub status: u16,
    pub mime: String,
    pub body: Vec<u8>,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct BridgeEnvelope {
    ok: bool,
    #[serde(default)]
    result: serde_json::Value,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize)]
struct ProxyPayload {
    #[serde(rename = "__haloProxy", default)]
    halo_proxy: bool,
    status: u16,
    #[serde(default)]
    mime: String,
    #[serde(rename = "bodyBase64", default)]
    body_base64: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy().to_string();
    if value.starts_with("\\\\?\\") {
        value[4..].to_string()
    } else {
        value
    }
}

fn encode_map_arg(values: &HashMap<String, String>) -> String {
    let engine = base64::engine::general_purpose::STANDARD;
    let mut pairs = values
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    pairs.sort_by(|(left, _), (right, _)| left.cmp(right));
    pairs
        .into_iter()
        .map(|(key, value)| format!("{}:{}", engine.encode(key), engine.encode(value)))
        .collect::<Vec<_>>()
        .join(",")
}

fn build_classpath(context: &SpiderProxyBridgeContext) -> String {
    let cp_separator = if cfg!(windows) { ";" } else { ":" };
    let mut classpath_parts = Vec::new();
    classpath_parts.push(clean_path(&context.bridge_jar));

    if let Some(libs_root) = context.libs_root.as_ref() {
        let preferred_lang3 = libs_root.join("commons-lang3.jar");
        if preferred_lang3.exists() {
            classpath_parts.push(clean_path(&preferred_lang3));
        }
        classpath_parts.push(clean_path(&libs_root.join("*")));
    }

    classpath_parts.join(cp_separator)
}

fn parse_bridge_stdout(stdout: &str) -> Result<BridgeEnvelope, String> {
    let start_tag = ">>HALO_RESPONSE<<";
    let end_tag = ">>HALO_RESPONSE<<";
    let Some(start_idx) = stdout.find(start_tag) else {
        return Err("proxy bridge did not emit start delimiter".to_string());
    };
    let Some(end_idx) = stdout.rfind(end_tag) else {
        return Err("proxy bridge did not emit end delimiter".to_string());
    };
    if start_idx + start_tag.len() >= end_idx {
        return Err("proxy bridge emitted empty payload".to_string());
    }

    let payload = stdout[start_idx + start_tag.len()..end_idx].trim();
    serde_json::from_str::<BridgeEnvelope>(payload)
        .map_err(|err| format!("parse proxy bridge envelope failed: {err}"))
}

fn decode_proxy_payload(result: serde_json::Value) -> Result<SpiderProxyBridgeResponse, String> {
    let parsed = serde_json::from_value::<ProxyPayload>(result)
        .map_err(|err| format!("parse proxy bridge payload failed: {err}"))?;
    if !parsed.halo_proxy {
        return Err("proxy bridge returned a non-proxy payload".to_string());
    }

    let mime = if parsed.mime.trim().is_empty() {
        "application/octet-stream".to_string()
    } else {
        parsed.mime
    };
    let body = if parsed.body_base64.trim().is_empty() {
        Vec::new()
    } else {
        base64::engine::general_purpose::STANDARD
            .decode(parsed.body_base64.trim())
            .map_err(|err| format!("decode proxy body failed: {err}"))?
    };

    Ok(SpiderProxyBridgeResponse {
        status: parsed.status,
        mime,
        body,
        headers: parsed.headers,
    })
}

pub(crate) async fn execute_proxy_bridge(
    context: &SpiderProxyBridgeContext,
    params: &HashMap<String, String>,
) -> Result<SpiderProxyBridgeResponse, String> {
    let classpath = build_classpath(context);
    let arg_value = encode_map_arg(params);
    let compat_classpath = context
        .compat_jars
        .iter()
        .filter(|path| path.is_file())
        .map(|path| clean_path(path))
        .collect::<Vec<_>>()
        .join(if cfg!(windows) { ";" } else { ":" });
    let lib_dir = crate::spider_compat::get_native_lib_dir(&context.spider_jar);

    let mut cmd = Command::new(&context.java_bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.arg("-Dfile.encoding=UTF-8")
        .arg("-Dsun.stdout.encoding=UTF-8")
        .arg("-Dsun.stderr.encoding=UTF-8")
        .arg(format!("-Dspider.lib.dir={}", clean_path(&lib_dir)))
        .arg("-Xmx256m")
        .arg("-cp")
        .arg(&classpath)
        .arg("com.halo.spider.BridgeRunnerCompat")
        .env("JAVA_HOME", &context.java_home)
        .env("HALO_JAR_PATH", clean_path(&context.spider_jar))
        .env("HALO_SITE_KEY", &context.site_key)
        .env("HALO_CLASS_HINT", &context.class_hint)
        .env("HALO_EXT", &context.resolved_ext)
        .env("HALO_METHOD", "proxy")
        .env("HALO_PROXY_BASE_URL", &context.proxy_base_url)
        .env("HALO_PRECALL_METHODS", "")
        .env("HALO_COMPAT_JARS", &compat_classpath)
        .env(
            "HALO_PREFER_COMPAT_RUNTIME",
            if context.prefer_compat_runtime {
                "1"
            } else {
                "0"
            },
        )
        .env("HALO_ARG_COUNT", "1")
        .env("HALO_ARG_0_TYPE", "map")
        .env("HALO_ARG_0_VALUE", arg_value);

    if let Some(fallback) = context.fallback_jar.as_ref() {
        cmd.env("HALO_FALLBACK_JAR", clean_path(fallback));
    }

    cmd.kill_on_drop(true);

    let output = tokio::time::timeout(Duration::from_secs(45), cmd.output())
        .await
        .map_err(|_| "proxy bridge timed out after 45s".to_string())?
        .map_err(|err| format!("spawn proxy bridge failed: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(format!(
            "proxy bridge exited with code {}{}",
            output.status.code().unwrap_or(-1),
            if stderr.is_empty() {
                String::new()
            } else {
                format!(": {stderr}")
            }
        ));
    }

    if !stderr.is_empty() {
        crate::spider_cmds::append_spider_debug_log(&format!(
            "[SpiderProxyBridge] stderr for {}: {}",
            context.site_key, stderr
        ));
    }

    let envelope = parse_bridge_stdout(&stdout)?;
    if !envelope.ok {
        return Err(if envelope.error.trim().is_empty() {
            "proxy bridge returned failure without an error message".to_string()
        } else {
            envelope.error
        });
    }

    decode_proxy_payload(envelope.result)
}
