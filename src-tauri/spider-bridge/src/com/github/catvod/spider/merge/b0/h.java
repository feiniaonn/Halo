package com.github.catvod.spider.merge.b0;

import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import okhttp3.Headers;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Desktop-safe request wrapper for transformed spider runtimes.
 * The original constructors are overloaded in inconsistent ways across jars, so
 * this replacement infers method/url/body/header ordering heuristically.
 */
public final class h {
    private static final MediaType FORM_MEDIA_TYPE = MediaType.parse("application/x-www-form-urlencoded");

    private final String method;
    private final String url;
    private final String body;
    private final Map<String, String> headers;
    private final Map<String, List<String>> responseHeaders;

    public h(String first, String second, Map<String, String> third) {
        RequestParts parts = resolveThreeArgRequest(first, second, third);
        this.method = parts.method;
        this.url = parts.url;
        this.body = parts.body;
        this.headers = parts.headers;
        this.responseHeaders = null;
    }

    public h(String first, String second, Map<String, String> third, Map<String, List<String>> responseHeaders) {
        RequestParts parts = resolveFourArgRequest(first, second, third, responseHeaders);
        this.method = parts.method;
        this.url = parts.url;
        this.body = parts.body;
        this.headers = parts.headers;
        this.responseHeaders = responseHeaders;
    }

    public h(
            String first,
            String second,
            Map<String, String> third,
            Map<String, String> fourth,
            Map<String, List<String>> responseHeaders) {
        RequestParts parts = resolveFiveArgRequest(first, second, third, fourth, responseHeaders);
        this.method = parts.method;
        this.url = parts.url;
        this.body = parts.body;
        this.headers = parts.headers;
        this.responseHeaders = responseHeaders;
    }

    public h b() {
        return this;
    }

    public i a(OkHttpClient client) {
        if (isInlineJsonPayload(url)) {
            if (responseHeaders != null) {
                responseHeaders.clear();
            }
            return new i(200, url, Collections.emptyMap());
        }

        if (client == null || url.isEmpty()) {
            return new i();
        }

        try (Response response = client.newCall(buildRequest()).execute()) {
            Map<String, List<String>> headerMap = response.headers().toMultimap();
            if (responseHeaders != null) {
                responseHeaders.clear();
                responseHeaders.putAll(headerMap);
            }
            String responseBody = response.body() == null ? "" : response.body().string();
            return new i(response.code(), responseBody, headerMap);
        } catch (IOException error) {
            return new i();
        }
    }

    private Request buildRequest() {
        if (url.isEmpty()) {
            throw new IllegalArgumentException("merge.b0.h normalized empty URL");
        }

        Request.Builder builder = new Request.Builder().url(url);
        if (!headers.isEmpty()) {
            builder.headers(Headers.of(headers));
        }

        if ("GET".equals(method)) {
            builder.get();
            return builder.build();
        }

        RequestBody requestBody = RequestBody.create(FORM_MEDIA_TYPE, body);
        if ("POST".equals(method)) {
            builder.post(requestBody);
        } else {
            builder.method(method, requestBody);
        }
        return builder.build();
    }

    private static RequestParts resolveThreeArgRequest(String first, String second, Map<String, String> third) {
        if (isHttpMethod(first) && looksLikeUrl(second)) {
            return buildRequestParts(first, second, "", third);
        }

        if (looksLikeUrl(second)) {
            String method = second.trim().contains("?") ? "GET" : inferMethodFromBody(first);
            return buildRequestParts(method, second, safeString(first), third);
        }

        return buildRequestParts(inferMethodFromBody(second), first, safeString(second), third);
    }

    private static RequestParts resolveFourArgRequest(
            String first,
            String second,
            Map<String, String> third,
            Map<String, List<String>> ignoredResponseHeaders) {
        if (isHttpMethod(first) && looksLikeUrl(second)) {
            return buildRequestParts(first, second, "", third);
        }

        if (looksLikeUrl(first)) {
            return buildRequestParts(inferMethodFromBody(second), first, safeString(second), third);
        }

        return buildRequestParts(inferMethodFromBody(second), second, safeString(first), third);
    }

    private static RequestParts resolveFiveArgRequest(
            String first,
            String second,
            Map<String, String> third,
            Map<String, String> fourth,
            Map<String, List<String>> ignoredResponseHeaders) {
        if (isHttpMethod(first) && looksLikeUrl(second)) {
            String body = "GET".equals(normalizeMethod(first)) ? "" : encodeForm(third);
            return buildRequestParts(first, second, body, fourth);
        }

        if (looksLikeUrl(first)) {
            return buildRequestParts(inferMethodFromBody(second), first, encodeForm(fourth), third);
        }

        return buildRequestParts(inferMethodFromBody(second), second, encodeForm(third), fourth);
    }

    private static RequestParts buildRequestParts(
            String method,
            String rawUrl,
            String body,
            Map<String, String> headers) {
        Map<String, String> sanitizedHeaders = sanitizeHeaders(headers);
        String normalizedUrl = normalizeUrl(rawUrl, sanitizedHeaders);
        return new RequestParts(normalizeMethod(method), normalizedUrl, safeString(body), sanitizedHeaders);
    }

    private static Map<String, String> sanitizeHeaders(Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, String> sanitized = new HashMap<>();
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() == null) {
                continue;
            }
            String key = entry.getKey().trim();
            if (key.isEmpty()) {
                continue;
            }
            sanitized.put(key, entry.getValue() == null ? "" : entry.getValue().trim());
        }
        return sanitized;
    }

    private static String normalizeMethod(String rawMethod) {
        String trimmed = safeString(rawMethod).trim().toUpperCase(Locale.ROOT);
        return trimmed.isEmpty() ? "GET" : trimmed;
    }

    private static String inferMethodFromBody(String body) {
        return safeString(body).trim().isEmpty() ? "GET" : "POST";
    }

    private static boolean isHttpMethod(String value) {
        String normalized = safeString(value).trim().toUpperCase(Locale.ROOT);
        return "GET".equals(normalized)
                || "POST".equals(normalized)
                || "PUT".equals(normalized)
                || "DELETE".equals(normalized)
                || "PATCH".equals(normalized)
                || "HEAD".equals(normalized)
                || "OPTIONS".equals(normalized);
    }

    private static boolean looksLikeUrl(String value) {
        String trimmed = safeString(value).trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        if (isInlineJsonPayload(trimmed)) {
            return false;
        }
        if (trimmed.startsWith("//") || trimmed.startsWith("/") || trimmed.startsWith("?")) {
            return true;
        }
        String lower = trimmed.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://")
                || lower.startsWith("https://")
                || lower.startsWith("http:/")
                || lower.startsWith("https:/")
                || trimmed.indexOf('.') > 0;
    }

    private static String normalizeUrl(String rawUrl, Map<String, String> headers) {
        String trimmed = safeString(rawUrl).trim();
        if (trimmed.isEmpty()) {
            return "";
        }
        if (isInlineJsonPayload(trimmed)) {
            return trimmed;
        }

        String normalized = trimmed.replace("\\/", "/");
        if (normalized.startsWith("http:/") && !normalized.startsWith("http://")) {
            normalized = "http://" + normalized.substring("http:/".length());
        } else if (normalized.startsWith("https:/") && !normalized.startsWith("https://")) {
            normalized = "https://" + normalized.substring("https:/".length());
        }

        if (normalized.startsWith("//")) {
            return "https:" + normalized;
        }

        if (hasHttpScheme(normalized)) {
            return normalized;
        }

        String base = firstNonEmptyHeader(headers, "Referer", "Origin", "Base-Url", "BaseUrl");
        if (!base.isEmpty()) {
            try {
                HttpUrl resolved = HttpUrl.get(base).resolve(normalized);
                if (resolved != null) {
                    return resolved.toString();
                }
            } catch (IllegalArgumentException ignored) {
            }
        }

        if (looksLikeHostOnly(normalized)) {
            return "https://" + normalized;
        }

        System.err.println("DEBUG: merge.b0.h unresolved URL raw=" + trimmed + " base=" + base);
        return normalized;
    }

    private static boolean hasHttpScheme(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static boolean looksLikeHostOnly(String value) {
        return value.indexOf("://") < 0 && value.indexOf('.') > 0 && !value.startsWith("/");
    }

    private static boolean isInlineJsonPayload(String value) {
        String trimmed = safeString(value).trim();
        return trimmed.startsWith("{") || trimmed.startsWith("[");
    }

    private static String firstNonEmptyHeader(Map<String, String> headers, String... names) {
        if (headers == null || headers.isEmpty()) {
            return "";
        }

        for (String name : names) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) {
                    String value = safeString(entry.getValue()).trim();
                    if (!value.isEmpty()) {
                        return value;
                    }
                }
            }
        }
        return "";
    }

    private static String encodeForm(Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey() == null || entry.getKey().trim().isEmpty()) {
                continue;
            }
            if (builder.length() > 0) {
                builder.append('&');
            }
            builder.append(entry.getKey().trim()).append('=').append(safeString(entry.getValue()).trim());
        }
        return builder.toString();
    }

    private static String safeString(String value) {
        return value == null ? "" : value;
    }

    private static final class RequestParts {
        private final String method;
        private final String url;
        private final String body;
        private final Map<String, String> headers;

        private RequestParts(String method, String url, String body, Map<String, String> headers) {
            this.method = method;
            this.url = url;
            this.body = body;
            this.headers = headers;
        }
    }
}
