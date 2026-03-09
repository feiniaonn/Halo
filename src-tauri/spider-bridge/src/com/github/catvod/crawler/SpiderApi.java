package com.github.catvod.crawler;

import com.github.catvod.net.OkHttp;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/**
 * Minimal SpiderApi compatibility layer for legacy spiders such as XBPQ.
 */
public class SpiderApi {
    private final String hostPort;

    public SpiderApi() {
        this(resolveHostPort());
    }

    public SpiderApi(String hostPort) {
        this.hostPort = hostPort == null || hostPort.trim().isEmpty()
            ? "http://127.0.0.1:9966"
            : hostPort.trim();
    }

    public void log(String message) {
        if (message != null && !message.trim().isEmpty()) {
            SpiderDebug.log(message);
        }
    }

    public String getPort() {
        try {
            URI uri = URI.create(normalizeBaseUrl());
            int port = uri.getPort();
            if (port > 0) {
                return String.valueOf(port);
            }
        } catch (Exception ignored) {
        }

        String digits = hostPort.replaceAll("^.*:(\\d+).*$", "$1");
        return digits.equals(hostPort) ? "" : digits;
    }

    public String getAddress(boolean trailingSlash) {
        String base = normalizeBaseUrl();
        if (trailingSlash && !base.endsWith("/")) {
            return base + "/";
        }
        if (!trailingSlash && base.endsWith("/")) {
            return base.substring(0, base.length() - 1);
        }
        return base;
    }

    public String webParse(String url, String body) {
        try {
            return performRequest(url, body, null, null);
        } catch (Exception exception) {
            SpiderDebug.log(exception);
            return "";
        }
    }

    public String multiReq(JsonArray requests) {
        JsonArray responses = new JsonArray();
        if (requests == null) {
            return responses.toString();
        }

        for (JsonElement element : requests) {
            if (element == null || element.isJsonNull()) {
                responses.add("");
                continue;
            }

            try {
                JsonObject request = element.isJsonObject() ? element.getAsJsonObject() : null;
                if (request == null) {
                    responses.add("");
                    continue;
                }

                String url = pickString(request, "url", "link", "uri");
                String body = pickString(request, "body", "data", "postData");
                String method = pickString(request, "method", "type");
                Map<String, String> headers = extractHeaders(request);
                responses.add(performRequest(url, body, headers, method));
            } catch (Exception exception) {
                SpiderDebug.log(exception);
                responses.add("");
            }
        }

        return responses.toString();
    }

    private String performRequest(
        String url,
        String body,
        Map<String, String> headers,
        String method
    ) throws Exception {
        String target = normalizeTargetUrl(url);
        if (target.isEmpty()) {
            return "";
        }

        Map<String, String> requestHeaders = headers == null ? new HashMap<>() : new HashMap<>(headers);
        if (!requestHeaders.containsKey("User-Agent")) {
            requestHeaders.put(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            );
        }

        boolean usePost = body != null && !body.isEmpty();
        if (method != null && !method.trim().isEmpty()) {
            usePost = "post".equalsIgnoreCase(method.trim());
        }

        if (usePost) {
            return OkHttp.post(target, body == null ? "" : body, requestHeaders).getBody();
        }
        return OkHttp.string(target, requestHeaders);
    }

    private static Map<String, String> extractHeaders(JsonObject request) {
        JsonElement element = request.get("headers");
        if ((element == null || !element.isJsonObject()) && request.get("header") != null) {
            element = request.get("header");
        }
        if (element == null || !element.isJsonObject()) {
            return null;
        }

        Map<String, String> headers = new HashMap<>();
        for (Map.Entry<String, JsonElement> entry : element.getAsJsonObject().entrySet()) {
            if (entry.getValue() == null || entry.getValue().isJsonNull()) {
                continue;
            }
            headers.put(entry.getKey(), entry.getValue().getAsString());
        }
        return headers;
    }

    private static String pickString(JsonObject request, String... keys) {
        for (String key : keys) {
            JsonElement element = request.get(key);
            if (element != null && !element.isJsonNull()) {
                String value = element.getAsString();
                if (value != null && !value.trim().isEmpty()) {
                    return value.trim();
                }
            }
        }
        return "";
    }

    private String normalizeBaseUrl() {
        return hostPort.endsWith("/") ? hostPort : hostPort + "/";
    }

    private String normalizeTargetUrl(String url) {
        if (url == null) {
            return "";
        }
        String trimmed = url.trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed;
        }
        if (trimmed.startsWith("/")) {
            return getAddress(true) + trimmed.substring(1);
        }
        return getAddress(true) + trimmed;
    }

    private static String resolveHostPort() {
        try {
            Class<?> proxyClass = Class.forName("com.github.catvod.spider.Proxy");
            Object value = proxyClass.getMethod("getHostPort").invoke(null);
            if (value instanceof String) {
                String hostPort = ((String) value).trim();
                if (!hostPort.isEmpty()) {
                    return hostPort;
                }
            }
        } catch (Throwable ignored) {
        }
        return "http://127.0.0.1:9966";
    }
}
