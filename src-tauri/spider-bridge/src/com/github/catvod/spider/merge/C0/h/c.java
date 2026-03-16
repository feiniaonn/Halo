package com.github.catvod.spider.merge.C0.h;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import okhttp3.FormBody;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class c {
    private final Map<String, List<String>> a;
    private final Map<String, String> b;
    private final Map<String, String> c;
    private final String d;
    private final String e;
    private Request f;
    private String g;
    private Object h;

    private c(
            String method,
            String url,
            String body,
            Map<String, String> headers,
            Map<String, String> params,
            Map<String, List<String>> responseHeaders) {
        this.a = responseHeaders;
        this.b = params;
        this.c = sanitizeStringMap(headers);
        this.d = normalizeMethod(method, body, params);
        this.e = url == null ? "" : url.trim();
        this.g = body == null ? "" : body;
        this.h = null;
    }

    c(String methodOrUrl, String urlOrBody, String bodyOrHeaders, Map<String, String> headers) {
        this(
                looksLikeHttpMethod(methodOrUrl) ? methodOrUrl : null,
                looksLikeHttpMethod(methodOrUrl) ? urlOrBody : methodOrUrl,
                looksLikeHttpMethod(methodOrUrl) ? bodyOrHeaders : urlOrBody,
                headers,
                null,
                null);
    }

    c(
            String methodOrUrl,
            String urlOrBody,
            Map<String, String> headersOrParams,
            Map<String, String> paramsOrHeaders,
            Map<String, List<String>> responseHeaders) {
        this(
                looksLikeHttpMethod(methodOrUrl) ? methodOrUrl : null,
                looksLikeHttpMethod(methodOrUrl) ? urlOrBody : methodOrUrl,
                null,
                looksLikeHttpMethod(methodOrUrl) ? headersOrParams : paramsOrHeaders,
                looksLikeHttpMethod(methodOrUrl) ? paramsOrHeaders : headersOrParams,
                responseHeaders);
    }

    public final d a(OkHttpClient client) {
        if (client == null || this.f == null) {
            return new d();
        }

        try (Response response = client.newCall(this.f).execute()) {
            if (this.a != null) {
                this.a.clear();
                this.a.putAll(response.headers().toMultimap());
            }
            String body = response.body() != null ? response.body().string() : "";
            return new d(response.code(), body);
        } catch (IOException ignored) {
            return new d();
        }
    }

    public final c b() {
        this.h = null;
        this.f = buildRequest();
        return this;
    }

    private Request buildRequest() {
        if (this.e.isEmpty()) {
            return null;
        }

        String method = this.d;
        String targetUrl = applyQueryParams(this.e, this.b, method);
        if (targetUrl.isEmpty()) {
            return null;
        }

        Request.Builder builder = new Request.Builder().url(targetUrl);
        Headers headers = buildHeaders(this.c);
        if (headers != null) {
            builder.headers(headers);
        }

        if ("POST".equals(method)) {
            builder.post(buildBody(this.g, this.b, this.c));
        } else {
            builder.get();
        }
        return builder.build();
    }

    private static Headers buildHeaders(Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }

        Map<String, String> sanitized = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            String key = entry.getKey().trim();
            String value = entry.getValue().trim();
            if (key.isEmpty() || value.isEmpty()) {
                continue;
            }
            sanitized.put(key, value);
        }
        if (sanitized.isEmpty()) {
            return null;
        }
        return Headers.of(sanitized);
    }

    private static RequestBody buildBody(
            String body,
            Map<String, String> params,
            Map<String, String> headers) {
        if (body != null && !body.isEmpty()) {
            String contentType = "application/x-www-form-urlencoded; charset=utf-8";
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    if (entry.getKey() != null
                            && "content-type".equalsIgnoreCase(entry.getKey().trim())
                            && entry.getValue() != null
                            && !entry.getValue().trim().isEmpty()) {
                        contentType = entry.getValue().trim();
                        break;
                    }
                }
            }
            if (looksLikeJson(body) && "application/x-www-form-urlencoded; charset=utf-8".equals(contentType)) {
                contentType = "application/json; charset=utf-8";
            }
            return RequestBody.create(MediaType.parse(contentType), body);
        }

        FormBody.Builder formBody = new FormBody.Builder();
        if (params != null) {
            for (Map.Entry<String, String> entry : params.entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null) {
                    continue;
                }
                formBody.add(entry.getKey(), entry.getValue());
            }
        }
        return formBody.build();
    }

    private static String applyQueryParams(String url, Map<String, String> params, String method) {
        if (!"GET".equals(method) || params == null || params.isEmpty()) {
            return url;
        }

        StringBuilder builder = new StringBuilder(url);
        char joiner = url.contains("?") ? '&' : '?';
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            builder.append(joiner);
            builder.append(entry.getKey());
            builder.append('=');
            builder.append(entry.getValue());
            joiner = '&';
        }
        return builder.toString();
    }

    private static Map<String, String> sanitizeStringMap(Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }

        Map<String, String> sanitized = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            sanitized.put(entry.getKey(), entry.getValue());
        }
        return sanitized.isEmpty() ? null : sanitized;
    }

    private static String normalizeMethod(
            String method,
            String body,
            Map<String, String> params) {
        if (looksLikeHttpMethod(method)) {
            return method.trim().toUpperCase();
        }
        if (body != null && !body.isEmpty()) {
            return "POST";
        }
        if (params != null && !params.isEmpty()) {
            return "GET";
        }
        return "GET";
    }

    private static boolean looksLikeHttpMethod(String value) {
        if (value == null) {
            return false;
        }
        String normalized = value.trim().toUpperCase();
        return "GET".equals(normalized)
                || "POST".equals(normalized)
                || "PUT".equals(normalized)
                || "DELETE".equals(normalized)
                || "HEAD".equals(normalized);
    }

    private static boolean looksLikeJson(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.startsWith("{") || trimmed.startsWith("[");
    }
}
