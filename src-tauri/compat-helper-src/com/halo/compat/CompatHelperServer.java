package com.halo.compat;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class CompatHelperServer {
    private static final long STARTED_AT_MS = System.currentTimeMillis();
    private static final AtomicReference<TraceEntry> LAST_TRACE = new AtomicReference<>(TraceEntry.empty());
    private static final List<HttpServer> SERVERS = new CopyOnWriteArrayList<>();
    private static final List<Integer> DEFAULT_PORTS = Arrays.asList(9966, 1072, 9999);
    private static final List<String> TARGET_KEYS = Arrays.asList(
        "url", "target", "targetUrl", "proxy", "proxyUrl", "siteUrl", "src", "link", "u", "ru"
    );
    private static final Pattern JSON_TARGET_PATTERN = Pattern.compile(
        "\"(url|target|targetUrl|proxy|proxyUrl|siteUrl|src|link|u|ru)\"\\s*:\\s*\"([^\"]+)\"",
        Pattern.CASE_INSENSITIVE
    );

    private CompatHelperServer() {
    }

    public static void main(String[] args) throws Exception {
        List<Integer> ports = parsePorts(System.getenv("HALO_HELPER_PORTS"));
        HttpHandler handler = new CompatHandler(ports);

        for (Integer port : ports) {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            server.createContext("/", handler);
            server.setExecutor(Executors.newCachedThreadPool());
            server.start();
            SERVERS.add(server);
            System.out.println("[CompatHelper] listening on http://127.0.0.1:" + port);
        }

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            for (HttpServer server : SERVERS) {
                try {
                    server.stop(0);
                } catch (Throwable ignored) {
                }
            }
        }));

        Thread.currentThread().join();
    }

    private static List<Integer> parsePorts(String envValue) {
        if (envValue == null || envValue.trim().isEmpty()) {
            return DEFAULT_PORTS;
        }

        List<Integer> ports = new ArrayList<>();
        for (String part : envValue.split(",")) {
            String trimmed = part.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                int port = Integer.parseInt(trimmed);
                if (port > 0 && port <= 65535 && !ports.contains(port)) {
                    ports.add(port);
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return ports.isEmpty() ? DEFAULT_PORTS : ports;
    }

    private static final class CompatHandler implements HttpHandler {
        private final List<Integer> ports;

        private CompatHandler(List<Integer> ports) {
            this.ports = Collections.unmodifiableList(new ArrayList<>(ports));
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            byte[] bodyBytes = readAll(exchange.getRequestBody());
            String method = exchange.getRequestMethod();
            URI uri = exchange.getRequestURI();
            String path = uri.getPath() == null ? "/" : uri.getPath();
            String query = uri.getRawQuery() == null ? "" : uri.getRawQuery();
            int port = exchange.getLocalAddress() != null ? exchange.getLocalAddress().getPort() : 0;

            try {
                if ("/health".equals(path)) {
                    writeJson(exchange, 200, buildHealthJson(this.ports));
                    return;
                }

                if ("/trace/last".equals(path)) {
                    writeJson(exchange, 200, LAST_TRACE.get().toJson());
                    return;
                }

                if ("/trace/reset".equals(path)) {
                    LAST_TRACE.set(TraceEntry.empty());
                    writeJson(exchange, 200, "{\"ok\":true}");
                    return;
                }

                proxy(exchange, port, method, path, query, bodyBytes);
            } catch (Throwable err) {
                TraceEntry trace = TraceEntry.of(
                    port,
                    method,
                    path,
                    query,
                    null,
                    null,
                    err.toString(),
                    snippet(bodyBytes),
                    System.currentTimeMillis()
                );
                LAST_TRACE.set(trace);
                writeJson(exchange, 500, "{\"ok\":false,\"error\":\"" + jsonEscape(err.toString()) + "\"}");
            }
        }
    }

    private static void proxy(
        HttpExchange exchange,
        int port,
        String method,
        String path,
        String query,
        byte[] bodyBytes
    ) throws IOException {
        String targetUrl = resolveTargetUrl(exchange, path, query, bodyBytes);
        if (targetUrl == null) {
            TraceEntry trace = TraceEntry.of(
                port,
                method,
                path,
                query,
                null,
                501,
                "target url not found in request",
                snippet(bodyBytes),
                System.currentTimeMillis()
            );
            LAST_TRACE.set(trace);
            writeJson(exchange, 501, trace.toJson());
            return;
        }

        HttpURLConnection connection = null;
        Integer responseStatus = null;
        try {
            URL url = new URL(targetUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod(normalizeMethod(method));
            copyHeaders(exchange.getRequestHeaders(), connection);

            if (supportsBody(method) && bodyBytes.length > 0) {
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bodyBytes);
                }
            }

            responseStatus = connection.getResponseCode();
            byte[] responseBytes = readConnectionBody(connection);
            Headers responseHeaders = exchange.getResponseHeaders();
            String contentType = connection.getHeaderField("Content-Type");
            if (contentType != null && !contentType.trim().isEmpty()) {
                responseHeaders.set("Content-Type", contentType);
            }
            responseHeaders.set("Access-Control-Allow-Origin", "*");
            exchange.sendResponseHeaders(responseStatus, responseBytes.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(responseBytes);
            }

            LAST_TRACE.set(TraceEntry.of(
                port,
                method,
                path,
                query,
                targetUrl,
                responseStatus,
                null,
                snippet(bodyBytes),
                System.currentTimeMillis()
            ));
        } catch (Throwable err) {
            TraceEntry trace = TraceEntry.of(
                port,
                method,
                path,
                query,
                targetUrl,
                responseStatus,
                err.toString(),
                snippet(bodyBytes),
                System.currentTimeMillis()
            );
            LAST_TRACE.set(trace);
            writeJson(exchange, 502, trace.toJson());
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String resolveTargetUrl(HttpExchange exchange, String path, String query, byte[] bodyBytes) {
        Map<String, String> params = new LinkedHashMap<>();
        params.putAll(parseKeyValuePairs(query));

        String body = new String(bodyBytes, StandardCharsets.UTF_8);
        String contentType = headerValue(exchange.getRequestHeaders(), "Content-Type");
        if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("application/x-www-form-urlencoded")) {
            params.putAll(parseKeyValuePairs(body));
        } else if (contentType != null && contentType.toLowerCase(Locale.ROOT).contains("application/json")) {
            Matcher matcher = JSON_TARGET_PATTERN.matcher(body);
            while (matcher.find()) {
                params.put(matcher.group(1), decode(matcher.group(2)));
            }
        } else if (!body.trim().isEmpty()) {
            params.putAll(parseKeyValuePairs(body));
        }

        for (String key : TARGET_KEYS) {
            String candidate = sanitizeTarget(params.get(key));
            if (candidate != null) {
                return candidate;
            }
        }

        String pathCandidate = extractEncodedUrl(path);
        if (pathCandidate != null) {
            return pathCandidate;
        }

        String queryCandidate = extractEncodedUrl(query);
        if (queryCandidate != null) {
            return queryCandidate;
        }

        String bodyCandidate = extractEncodedUrl(body);
        return sanitizeTarget(bodyCandidate);
    }

    private static Map<String, String> parseKeyValuePairs(String input) {
        if (input == null || input.trim().isEmpty()) {
            return Collections.emptyMap();
        }

        Map<String, String> result = new LinkedHashMap<>();
        String normalized = input.replace('&', '\n').replace(';', '\n');
        for (String part : normalized.split("\n")) {
            if (part.trim().isEmpty()) {
                continue;
            }
            int index = part.indexOf('=');
            String key = index >= 0 ? part.substring(0, index) : part;
            String value = index >= 0 ? part.substring(index + 1) : "";
            result.put(decode(key), decode(value));
        }
        return result;
    }

    private static String extractEncodedUrl(String input) {
        if (input == null || input.trim().isEmpty()) {
            return null;
        }
        String decoded = decode(input);
        for (String candidate : new String[] {decoded, input}) {
            String sanitized = sanitizeTarget(candidate);
            if (sanitized != null) {
                return sanitized;
            }

            int httpIndex = candidate.indexOf("http://");
            if (httpIndex >= 0) {
                return sanitizeTarget(candidate.substring(httpIndex));
            }
            int httpsIndex = candidate.indexOf("https://");
            if (httpsIndex >= 0) {
                return sanitizeTarget(candidate.substring(httpsIndex));
            }
        }
        return null;
    }

    private static String sanitizeTarget(String candidate) {
        if (candidate == null) {
            return null;
        }
        String trimmed = decode(candidate.trim())
            .replace("\\u003d", "=")
            .replace("\\u0026", "&")
            .replace("&amp;", "&");
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed;
        }
        return null;
    }

    private static String decode(String input) {
        try {
            return URLDecoder.decode(input, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return input;
        }
    }

    private static String normalizeMethod(String method) {
        if (method == null) {
            return "GET";
        }
        String upper = method.toUpperCase(Locale.ROOT);
        switch (upper) {
            case "GET":
            case "POST":
            case "PUT":
            case "DELETE":
            case "HEAD":
                return upper;
            default:
                return "GET";
        }
    }

    private static boolean supportsBody(String method) {
        String upper = normalizeMethod(method);
        return "POST".equals(upper) || "PUT".equals(upper);
    }

    private static void copyHeaders(Headers source, HttpURLConnection target) {
        for (Map.Entry<String, List<String>> entry : source.entrySet()) {
            String name = entry.getKey();
            if (name == null) {
                continue;
            }
            String lower = name.toLowerCase(Locale.ROOT);
            if ("host".equals(lower) || "content-length".equals(lower) || "connection".equals(lower)) {
                continue;
            }
            for (String value : entry.getValue()) {
                if (value != null && !value.trim().isEmpty()) {
                    target.addRequestProperty(name, value);
                }
            }
        }
    }

    private static byte[] readConnectionBody(HttpURLConnection connection) throws IOException {
        InputStream stream = null;
        try {
            stream = connection.getInputStream();
        } catch (IOException ignored) {
            stream = connection.getErrorStream();
        }
        return readAll(stream);
    }

    private static byte[] readAll(InputStream stream) throws IOException {
        if (stream == null) {
            return new byte[0];
        }
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String headerValue(Headers headers, String key) {
        if (headers == null || key == null) {
            return null;
        }
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (key.equalsIgnoreCase(entry.getKey()) && !entry.getValue().isEmpty()) {
                return entry.getValue().get(0);
            }
        }
        return null;
    }

    private static String buildHealthJson(List<Integer> ports) {
        return "{\"ok\":true,\"ports\":[" + joinInts(ports) + "],\"startedAtMs\":" + STARTED_AT_MS + "}";
    }

    private static void writeJson(HttpExchange exchange, int statusCode, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=UTF-8");
        headers.set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static String joinInts(List<Integer> values) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                builder.append(',');
            }
            builder.append(values.get(i));
        }
        return builder.toString();
    }

    private static String snippet(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return null;
        }
        String value = new String(bytes, StandardCharsets.UTF_8).trim();
        if (value.isEmpty()) {
            return null;
        }
        return value.length() > 256 ? value.substring(0, 256) : value;
    }

    private static String jsonEscape(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder(value.length() + 16);
        for (char ch : value.toCharArray()) {
            switch (ch) {
                case '\\':
                    builder.append("\\\\");
                    break;
                case '"':
                    builder.append("\\\"");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (ch < 0x20) {
                        builder.append(String.format("\\u%04x", (int) ch));
                    } else {
                        builder.append(ch);
                    }
            }
        }
        return builder.toString();
    }

    private static final class TraceEntry {
        private final int port;
        private final String method;
        private final String path;
        private final String query;
        private final String targetUrl;
        private final Integer responseStatus;
        private final String failure;
        private final String bodySnippet;
        private final long capturedAtMs;

        private TraceEntry(
            int port,
            String method,
            String path,
            String query,
            String targetUrl,
            Integer responseStatus,
            String failure,
            String bodySnippet,
            long capturedAtMs
        ) {
            this.port = port;
            this.method = Objects.toString(method, "");
            this.path = Objects.toString(path, "");
            this.query = Objects.toString(query, "");
            this.targetUrl = targetUrl;
            this.responseStatus = responseStatus;
            this.failure = failure;
            this.bodySnippet = bodySnippet;
            this.capturedAtMs = capturedAtMs;
        }

        private static TraceEntry empty() {
            return new TraceEntry(0, "", "", "", null, null, null, null, 0L);
        }

        private static TraceEntry of(
            int port,
            String method,
            String path,
            String query,
            String targetUrl,
            Integer responseStatus,
            String failure,
            String bodySnippet,
            long capturedAtMs
        ) {
            return new TraceEntry(port, method, path, query, targetUrl, responseStatus, failure, bodySnippet, capturedAtMs);
        }

        private String toJson() {
            return "{"
                + "\"port\":" + port + ","
                + "\"method\":\"" + jsonEscape(method) + "\","
                + "\"path\":\"" + jsonEscape(path) + "\","
                + "\"query\":\"" + jsonEscape(query) + "\","
                + "\"targetUrl\":" + nullable(targetUrl) + ","
                + "\"responseStatus\":" + (responseStatus == null ? "null" : responseStatus) + ","
                + "\"failure\":" + nullable(failure) + ","
                + "\"bodySnippet\":" + nullable(bodySnippet) + ","
                + "\"capturedAtMs\":" + capturedAtMs
                + "}";
        }

        private String nullable(String value) {
            return value == null ? "null" : "\"" + jsonEscape(value) + "\"";
        }
    }
}
