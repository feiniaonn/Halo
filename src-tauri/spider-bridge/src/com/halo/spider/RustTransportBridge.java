package com.halo.spider;

import com.github.catvod.net.OkResult;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import okhttp3.Headers;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

public final class RustTransportBridge {
    private RustTransportBridge() {
    }

    public static boolean isEnabled() {
        return readBoolean("HALO_UNIFIED_REQUEST_POLICY_V1", true);
    }

    public static OkResult executeOkResult(
            String url,
            String method,
            Map<String, String> headers,
            String body,
            Map<String, String> formBody,
            String postType,
            boolean followRedirects,
            long timeoutMs)
            throws IOException {
        TransportResponse response =
                execute(url, method, headers, body, formBody, postType, followRedirects, timeoutMs);
        return new OkResult(response.statusCode, response.bodyText, response.headers);
    }

    public static String executeText(
            String url,
            String method,
            Map<String, String> headers,
            String body,
            Map<String, String> formBody,
            String postType,
            boolean followRedirects,
            long timeoutMs)
            throws IOException {
        return executeOkResult(url, method, headers, body, formBody, postType, followRedirects, timeoutMs)
                .getBody();
    }

    public static String executeLocation(
            String url,
            Map<String, String> headers,
            boolean followRedirects,
            long timeoutMs)
            throws IOException {
        TransportResponse response =
                execute(url, "GET", headers, null, null, null, followRedirects, timeoutMs);
        List<String> values = response.headers.get("location");
        if (values == null || values.isEmpty()) {
            values = response.headers.get("Location");
        }
        return values == null || values.isEmpty() ? null : values.get(0);
    }

    public static Response executeResponse(
            String url,
            String method,
            Map<String, String> headers,
            String body,
            Map<String, String> formBody,
            String postType,
            boolean followRedirects,
            long timeoutMs)
            throws IOException {
        TransportResponse response =
                execute(url, method, headers, body, formBody, postType, followRedirects, timeoutMs);
        Request request = new Request.Builder().url(response.finalUrl).method(method, null).build();
        Headers.Builder headersBuilder = new Headers.Builder();
        for (Map.Entry<String, List<String>> entry : response.headers.entrySet()) {
            if (entry.getKey() == null) {
                continue;
            }
            for (String value : entry.getValue()) {
                headersBuilder.add(entry.getKey(), value == null ? "" : value);
            }
        }
        String contentType = "";
        List<String> contentTypes = response.headers.get("content-type");
        if (contentTypes == null || contentTypes.isEmpty()) {
            contentTypes = response.headers.get("Content-Type");
        }
        if (contentTypes != null && !contentTypes.isEmpty() && contentTypes.get(0) != null) {
            contentType = contentTypes.get(0);
        }
        return new Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(response.statusCode)
                .message(response.statusCode == 0 ? "transport_error" : "")
                .headers(headersBuilder.build())
                .body(ResponseBody.create(MediaType.parse(contentType), response.bodyBytes))
                .build();
    }

    public static TransportResponse execute(
            String url,
            String method,
            Map<String, String> headers,
            String body,
            Map<String, String> formBody,
            String postType,
            boolean followRedirects,
            long timeoutMs)
            throws IOException {
        if (!isEnabled()) {
            throw new IOException("Rust transport bridge disabled");
        }
        String baseUrl = getBaseUrl();
        if (baseUrl.isEmpty()) {
            throw new IOException("Rust transport bridge base URL unavailable");
        }

        JSONObject payload = new JSONObject();
        payload.put("url", url == null ? "" : url);
        payload.put("requestId", buildRequestId(url, method));
        payload.put("source", "java-bridge");

        JSONObject options = new JSONObject();
        options.put("method", method == null || method.trim().isEmpty() ? "GET" : method.trim());
        options.put("redirect", followRedirects ? 1 : 0);
        options.put("timeout", timeoutMs <= 0 ? 10000 : timeoutMs);
        if (headers != null && !headers.isEmpty()) {
            options.put("headers", new JSONObject(headers));
        }
        if (formBody != null && !formBody.isEmpty()) {
            options.put("data", new JSONObject(formBody));
        }
        if (body != null) {
            options.put("body", body);
        }
        if (postType != null && !postType.trim().isEmpty()) {
            options.put("postType", postType.trim());
        }
        payload.put("options", options);

        byte[] requestBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(baseUrl + "/transport").openConnection();
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setConnectTimeout((int) Math.max(1L, timeoutMs));
            connection.setReadTimeout((int) Math.max(1L, timeoutMs));
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(requestBytes.length);

            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBytes);
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String bodyText = stream == null
                    ? ""
                    : new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException("Rust transport bridge returned HTTP " + statusCode + ": " + bodyText);
            }
            JSONObject json = new JSONObject(bodyText);
            if (!json.optString("error").trim().isEmpty()) {
                throw new IOException(json.optString("error"));
            }
            return TransportResponse.fromJson(json);
        } catch (IOException error) {
            throw error;
        } catch (Exception error) {
            throw new IOException("Rust transport bridge failed: " + error.getMessage(), error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static boolean readBoolean(String name, boolean defaultValue) {
        String env = System.getenv(name);
        if (env == null || env.trim().isEmpty()) {
            env = System.getProperty(name, "");
        }
        if (env == null || env.trim().isEmpty()) {
            return defaultValue;
        }
        String normalized = env.trim().toLowerCase();
        if (normalized.equals("0") || normalized.equals("false") || normalized.equals("off")) {
            return false;
        }
        if (normalized.equals("1") || normalized.equals("true") || normalized.equals("on")) {
            return true;
        }
        return defaultValue;
    }

    private static String getBaseUrl() {
        String value = System.getProperty("halo.proxy.baseUrl", "").trim();
        if (value.endsWith("/proxy")) {
            value = value.substring(0, value.length() - "/proxy".length());
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private static String buildRequestId(String url, String method) {
        return (method == null ? "GET" : method.trim()) + ":" + (url == null ? "" : url);
    }

    public static final class TransportResponse {
        public final int statusCode;
        public final String finalUrl;
        public final byte[] bodyBytes;
        public final String bodyText;
        public final Map<String, List<String>> headers;

        private TransportResponse(
                int statusCode,
                String finalUrl,
                byte[] bodyBytes,
                String bodyText,
                Map<String, List<String>> headers) {
            this.statusCode = statusCode;
            this.finalUrl = finalUrl == null ? "" : finalUrl;
            this.bodyBytes = bodyBytes == null ? new byte[0] : bodyBytes;
            this.bodyText = bodyText == null ? "" : bodyText;
            this.headers = headers == null ? Collections.emptyMap() : headers;
        }

        static TransportResponse fromJson(JSONObject json) {
            String bodyBase64 = json.optString("bodyBase64", "");
            byte[] bodyBytes = bodyBase64.isEmpty()
                    ? new byte[0]
                    : Base64.getDecoder().decode(bodyBase64);
            Map<String, List<String>> headers = new HashMap<>();
            JSONObject headersJson = json.optJSONObject("headers");
            if (headersJson != null) {
                for (String key : headersJson.keySet()) {
                    String value = headersJson.optString(key, "");
                    List<String> items = new ArrayList<>();
                    items.add(value);
                    headers.put(key, items);
                }
            }
            String bodyText = new String(bodyBytes, StandardCharsets.UTF_8);
            return new TransportResponse(
                    json.optInt("status", 0),
                    json.optString("url", ""),
                    bodyBytes,
                    bodyText,
                    headers);
        }
    }
}
