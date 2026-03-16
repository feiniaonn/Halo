package com.halo.spider;

import com.github.catvod.net.OkHttp;
import com.github.catvod.net.SSLCompat;
import com.github.catvod.net.SSLSocketClient;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.lang.reflect.Field;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

final class App3QCompat {
    private static final String DEFAULT_BASE_URL = "https://qqqys.com";
    private static final String X_CLIENT = "8f3d2a1c7b6e5d4c9a0b1f2e3d4c5b6a";
    private static final String WEB_SIGN = "f65f3a83d6d9ad6f";
    private static final int PLAYER_DECODE_CONNECT_TIMEOUT_MS = 5_000;
    private static final int PLAYER_DECODE_READ_TIMEOUT_MS = 5_000;
    private static final int PLAYER_DECODE_BASE_CANDIDATE_LIMIT = 2;

    private App3QCompat() {
    }

    static Object recoverContentIfNeeded(
            Object spider,
            String methodName,
            List<Object> args,
            Object result) {
        if (spider == null || !looksLikeApp3QSpider(spider) || !supportsMethod(methodName)) {
            return result;
        }
        if (!looksBroken(methodName, result)) {
            return result;
        }

        Object recovered = recoverContent(spider, methodName, args);
        if (recovered != null) {
            System.err.println("DEBUG: App3Q " + methodName + " recovered via web compat");
            return recovered;
        }
        return result;
    }

    static Object preferDirectContentIfNeeded(
            Object spider,
            String methodName,
            List<Object> args) {
        if (spider == null || !looksLikeApp3QSpider(spider) || !supportsMethod(methodName)) {
            return null;
        }

        Object recovered = recoverContent(spider, methodName, args);
        if (recovered != null) {
            System.err.println("DEBUG: App3Q " + methodName + " resolved via direct web compat");
        }
        return recovered;
    }

    static Object recoverContentAfterFailureIfNeeded(
            Object spider,
            String methodName,
            List<Object> args,
            Throwable error) {
        if (spider == null || !looksLikeApp3QSpider(spider) || !supportsMethod(methodName)) {
            return null;
        }

        Object recovered = recoverContent(spider, methodName, args);
        if (recovered != null) {
            String detail = error == null || error.getMessage() == null ? "" : " after " + error.getMessage();
            System.err.println("DEBUG: App3Q " + methodName + " recovered via web compat" + detail);
        }
        return recovered;
    }

    private static boolean looksLikeApp3QSpider(Object spider) {
        String className = spider.getClass().getName();
        return className != null && className.toLowerCase().contains("app3q");
    }

    private static boolean supportsMethod(String methodName) {
        return "homeContent".equals(methodName)
                || "categoryContent".equals(methodName)
                || "searchContent".equals(methodName)
                || "detailContent".equals(methodName)
                || "playerContent".equals(methodName);
    }

    private static boolean looksBroken(String methodName, Object result) {
        if (result == null) {
            return true;
        }
        if (!(result instanceof String)) {
            return false;
        }

        String payload = ((String) result).trim();
        if (payload.isEmpty() || "{}".equals(payload) || "[]".equals(payload)) {
            return true;
        }
        if (!payload.startsWith("{")) {
            return true;
        }

        try {
            JSONObject object = new JSONObject(payload);
            if ("homeContent".equals(methodName)) {
                JSONArray classItems = object.optJSONArray("class");
                JSONArray listItems = object.optJSONArray("list");
                return (classItems == null || classItems.length() == 0)
                        && (listItems == null || listItems.length() == 0);
            }
            if ("detailContent".equals(methodName)) {
                JSONArray listItems = object.optJSONArray("list");
                if (listItems == null || listItems.length() == 0) {
                    return true;
                }
                JSONObject first = listItems.optJSONObject(0);
                return first == null || jsonValueAsString(first.opt("vod_play_url")).isEmpty();
            }

            JSONArray listItems = object.optJSONArray("list");
            return listItems == null || listItems.length() == 0;
        } catch (Throwable ignored) {
            return true;
        }
    }

    private static Object recoverContent(Object spider, String methodName, List<Object> args) {
        try {
            Object recovered;
            switch (methodName) {
                case "homeContent":
                    recovered = buildHomeContentPayload(spider);
                    break;
                case "categoryContent":
                    recovered = buildCategoryContentPayload(spider, args);
                    break;
                case "searchContent":
                    recovered = buildSearchContentPayload(spider, args);
                    break;
                case "detailContent":
                    recovered = buildDetailContentPayload(spider, args);
                    break;
                case "playerContent":
                    recovered = buildPlayerContentPayload(spider, args);
                    break;
                default:
                    return null;
            }
            return isUsableRecoveredPayload(methodName, recovered) ? recovered : null;
        } catch (Throwable error) {
            System.err.println("DEBUG: App3Q web compat failed for " + methodName + ": " + error.getMessage());
            return null;
        }
    }

    private static String buildHomeContentPayload(Object spider) throws Exception {
        JSONObject root = requestJson(spider, "/api.php/web/index/home", null);
        JSONObject data = root.optJSONObject("data");
        if (data == null) {
            data = root;
        }

        JSONArray classItems = new JSONArray();
        JSONArray categories = data.optJSONArray("categories");
        if (categories != null) {
            for (int index = 0; index < categories.length(); index += 1) {
                JSONObject item = categories.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                String typeName = jsonValueAsString(item.opt("type_name"));
                String typeId = jsonValueAsString(item.opt("type_id"));
                if (typeId.isEmpty()) {
                    typeId = typeName;
                }
                if (typeId.isEmpty()) {
                    continue;
                }
                if (typeName.isEmpty()) {
                    typeName = typeId;
                }
                classItems.put(new JSONObject()
                        .put("type_id", typeId)
                        .put("type_name", typeName));
            }
        }

        JSONArray recommend = normalizeVodList(data.optJSONArray("recommend"));
        if (recommend.length() == 0 && categories != null) {
            recommend = new JSONArray();
            for (int index = 0; index < categories.length(); index += 1) {
                JSONObject item = categories.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                appendVodItems(recommend, normalizeVodList(item.optJSONArray("videos")));
            }
        }

        System.err.println("DEBUG: App3Q home compat payload class=" + classItems.length()
                + " list=" + recommend.length());
        JSONObject normalized = new JSONObject();
        normalized.put("class", classItems);
        normalized.put("list", recommend);
        return normalized.toString();
    }

    private static String buildCategoryContentPayload(Object spider, List<Object> args) throws Exception {
        String tid = argAsString(args, 0);
        String page = argAsString(args, 1);
        if (page.isEmpty()) {
            page = "1";
        }

        Map<String, String> params = new HashMap<>();
        if (isNumeric(tid)) {
            params.put("type_id", tid);
        } else if (!tid.isEmpty()) {
            params.put("type_name", tid);
        }
        params.put("page", page);

        Map<String, String> filter = argAsStringMap(args, 3);
        String sort = filter.get("sort");
        params.put("sort", sort == null || sort.trim().isEmpty() ? "hits" : sort.trim());
        copyFilterParam(filter, params, "class");
        copyFilterParam(filter, params, "area");
        copyFilterParam(filter, params, "year");

        JSONObject root = requestJson(spider, "/api.php/web/filter/vod", params);
        JSONArray items = normalizeVodList(root.optJSONArray("data"));
        JSONObject normalized = new JSONObject();
        normalized.put("list", items);
        normalized.put("page", parseInteger(page, 1));
        normalized.put("pagecount", parseInteger(jsonValueAsString(root.opt("pageCount")), 0));
        normalized.put("total", parseInteger(jsonValueAsString(root.opt("total")), items.length()));
        return normalized.toString();
    }

    private static String buildSearchContentPayload(Object spider, List<Object> args) throws Exception {
        String keyword = argAsString(args, 0);
        if (keyword.isEmpty()) {
            return "";
        }

        Map<String, String> params = new HashMap<>();
        params.put("wd", keyword);
        params.put("page", "1");
        params.put("limit", "15");

        JSONObject root = requestJson(spider, "/api.php/web/search/index", params);
        JSONObject normalized = new JSONObject();
        normalized.put("list", normalizeVodList(root.optJSONArray("data")));
        return normalized.toString();
    }

    private static String buildDetailContentPayload(Object spider, List<Object> args) throws Exception {
        String vodId = firstListValue(args, 0);
        if (vodId.isEmpty()) {
            return "";
        }

        Map<String, String> params = new HashMap<>();
        params.put("vod_id", vodId);
        JSONObject root = requestJson(spider, "/api.php/web/vod/get_detail", params);
        JSONArray data = root.optJSONArray("data");
        if (data == null || data.length() == 0) {
            return "";
        }

        JSONObject item = data.optJSONObject(0);
        if (item == null) {
            return "";
        }

        String vodName = jsonValueAsString(item.opt("vod_name"));
        JSONArray list = new JSONArray();
        list.put(new JSONObject()
                .put("vod_id", vodId)
                .put("vod_name", vodName)
                .put("vod_pic", jsonValueAsString(item.opt("vod_pic")))
                .put("vod_year", jsonValueAsString(item.opt("vod_year")))
                .put("vod_area", jsonValueAsString(item.opt("vod_area")))
                .put("vod_actor", jsonValueAsString(item.opt("vod_actor")))
                .put("vod_director", jsonValueAsString(item.opt("vod_director")))
                .put("vod_content", jsonValueAsString(item.opt("vod_content")).trim())
                .put("vod_remarks", jsonValueAsString(item.opt("vod_remarks")))
                .put("type_name", jsonValueAsString(item.opt("type_name")))
                .put("vod_class", jsonValueAsString(item.opt("vod_class")))
                .put("vod_play_from", buildPlayFrom(jsonValueAsString(item.opt("vod_play_from")), root.optJSONArray("vodplayer")))
                .put("vod_play_url", buildPlayUrl(
                        jsonValueAsString(item.opt("vod_play_from")),
                        jsonValueAsString(item.opt("vod_play_url")),
                        root.optJSONArray("vodplayer"),
                        vodName)));

        return new JSONObject().put("list", list).toString();
    }

    private static String buildPlayerContentPayload(Object spider, List<Object> args) throws Exception {
        String encodedId = argAsString(args, 1);
        if (encodedId.isEmpty()) {
            return "";
        }

        String[] parts = encodedId.split("@");
        String targetUrl = parts.length > 0 ? parts[0].trim() : encodedId.trim();
        String source = parts.length > 1 ? parts[1].trim() : argAsString(args, 0);
        String resolvedBaseUrl = trimTrailingSlash(readBaseUrl(spider));
        if (resolvedBaseUrl.isEmpty()) {
            resolvedBaseUrl = DEFAULT_BASE_URL;
        }
        Map<String, String> playerHeaders = buildPlayerHeaders(resolvedBaseUrl, buildAppHeaders(spider));
        if (targetUrl.isEmpty()) {
            return "";
        }

        if (looksLikeDirectMediaUrl(targetUrl)) {
            return buildPlayerPayloadForUrl(targetUrl, playerHeaders, false);
        }

        String decodedUrl = requestAppDecodedUrl(spider, targetUrl, source);
        if (decodedUrl.isEmpty()) {
            System.err.println("DEBUG: App3Q player compat falling back to parse target=" + summarizeUrl(targetUrl));
            return buildPlayerPayloadForUrl(targetUrl, playerHeaders, true);
        }

        System.err.println("DEBUG: App3Q player compat source=" + source + " resolved=" + summarizeUrl(decodedUrl));
        return buildPlayerPayloadForUrl(decodedUrl, playerHeaders, !looksLikeDirectMediaUrl(decodedUrl));
    }

    private static JSONObject requestJson(Object spider, String path, Map<String, String> params) throws Exception {
        List<String> baseCandidates = buildBaseUrlCandidates(readBaseUrl(spider));
        Throwable lastError = null;
        for (String baseUrl : baseCandidates) {
            String url = buildUrl(baseUrl, path, params);
            try {
                String payload = requestTextWithFallback(url, buildHeaders());
                if (payload == null || payload.trim().isEmpty()) {
                    throw new IllegalStateException("App3Q web compat returned empty payload");
                }
                JSONObject root = new JSONObject(payload);
                int code = root.optInt("code", 0);
                if (code != 200) {
                    throw new IllegalStateException("App3Q web compat returned code " + code + ": " + root.optString("msg"));
                }
                return root;
            } catch (Throwable error) {
                lastError = error;
                System.err.println("DEBUG: App3Q web compat request failed for " + url + ": " + error.getMessage());
            }
        }

        if (lastError instanceof Exception) {
            throw (Exception) lastError;
        }
        throw new IllegalStateException("App3Q web compat request failed without explicit error");
    }

    private static boolean isUsableRecoveredPayload(String methodName, Object recovered) {
        if (!(recovered instanceof String)) {
            return recovered != null;
        }

        String payload = ((String) recovered).trim();
        if (payload.isEmpty() || "{}".equals(payload) || "[]".equals(payload)) {
            return false;
        }
        if (!payload.startsWith("{")) {
            return true;
        }

        try {
            JSONObject object = new JSONObject(payload);
            if ("homeContent".equals(methodName)) {
                return hasItems(object.optJSONArray("class"))
                        || hasItems(object.optJSONArray("list"))
                        || object.optJSONObject("filters") != null;
            }
            if ("detailContent".equals(methodName)) {
                return hasItems(object.optJSONArray("list"));
            }
            if ("playerContent".equals(methodName)) {
                return !jsonValueAsString(object.opt("url")).isEmpty()
                        || parseInteger(jsonValueAsString(object.opt("parse")), 0) == 1
                        || parseInteger(jsonValueAsString(object.opt("jx")), 0) == 1;
            }
            return object.has("list");
        } catch (Throwable ignored) {
            return true;
        }
    }

    private static boolean hasItems(JSONArray array) {
        return array != null && array.length() > 0;
    }

    private static void appendVodItems(JSONArray target, JSONArray items) {
        if (target == null || items == null) {
            return;
        }
        for (int index = 0; index < items.length(); index += 1) {
            Object item = items.opt(index);
            if (item != null) {
                target.put(item);
            }
        }
    }

    private static Map<String, String> buildHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", "application/json");
        headers.put("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
        headers.put("Referer", DEFAULT_BASE_URL + "/");
        headers.put("X-Client", X_CLIENT);
        headers.put("web-sign", WEB_SIGN);
        return headers;
    }

    private static List<String> buildBaseUrlCandidates(String baseUrl) {
        Set<String> ordered = new LinkedHashSet<>();
        addBaseUrlCandidate(ordered, baseUrl);
        addBaseUrlCandidate(ordered, DEFAULT_BASE_URL);
        addBaseUrlCandidate(ordered, "https://www.qqqys.com");
        return new ArrayList<>(ordered);
    }

    private static void addBaseUrlCandidate(Set<String> ordered, String value) {
        String normalized = trimTrailingSlash(value);
        if (!normalized.isEmpty()) {
            ordered.add(normalized);
        }
    }

    private static String requestTextWithFallback(String url, Map<String, String> headers) throws Exception {
        IOException primaryError = null;
        try {
            return OkHttp.string(url, headers);
        } catch (IOException error) {
            primaryError = error;
            System.err.println("DEBUG: App3Q OkHttp fallback triggered for " + url + ": " + error.getMessage());
        }

        IOException directError = null;
        try {
            return requestViaUrlConnection(url, headers, false);
        } catch (IOException error) {
            directError = error;
            System.err.println("DEBUG: App3Q URLConnection request failed for " + url + ": " + error.getMessage());
        }

        try {
            return requestViaUrlConnection(url, headers, true);
        } catch (IOException legacyTlsError) {
            if (directError != null) {
                legacyTlsError.addSuppressed(directError);
            }
            if (primaryError != null) {
                legacyTlsError.addSuppressed(primaryError);
            }
            throw legacyTlsError;
        }
    }

    private static String requestTextWithPlayerFallback(String url, Map<String, String> headers) throws Exception {
        IOException directError = null;
        try {
            return requestViaUrlConnection(
                    url,
                    headers,
                    false,
                    PLAYER_DECODE_CONNECT_TIMEOUT_MS,
                    PLAYER_DECODE_READ_TIMEOUT_MS);
        } catch (IOException error) {
            directError = error;
            System.err.println("DEBUG: App3Q player URLConnection request failed for " + url + ": " + error.getMessage());
        }

        IOException legacyError = null;
        try {
            return requestViaUrlConnection(
                    url,
                    headers,
                    true,
                    PLAYER_DECODE_CONNECT_TIMEOUT_MS,
                    PLAYER_DECODE_READ_TIMEOUT_MS);
        } catch (IOException error) {
            legacyError = error;
            System.err.println("DEBUG: App3Q player legacy TLS request failed for " + url + ": " + error.getMessage());
        }

        try {
            return OkHttp.string(url, headers);
        } catch (IOException error) {
            if (legacyError != null) {
                error.addSuppressed(legacyError);
            }
            if (directError != null) {
                error.addSuppressed(directError);
            }
            throw error;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> buildAppHeaders(Object spider) {
        try {
            Method method = spider.getClass().getDeclaredMethod("b");
            method.setAccessible(true);
            Object value = method.invoke(spider);
            if (value instanceof Map) {
                Map<String, String> headers = new HashMap<>();
                Map<Object, Object> source = (Map<Object, Object>) value;
                for (Map.Entry<Object, Object> entry : source.entrySet()) {
                    String key = jsonValueAsString(entry.getKey());
                    String current = jsonValueAsString(entry.getValue());
                    if (!key.isEmpty()) {
                        headers.put(key, current);
                    }
                }
                return headers;
            }
        } catch (Throwable error) {
            System.err.println("DEBUG: App3Q app header reflection failed: " + error.getMessage());
        }
        return new HashMap<>();
    }

    private static Map<String, String> buildPlayerHeaders(String baseUrl, Map<String, String> appHeaders) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", "*/*");
        headers.put(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

        String normalizedBaseUrl = trimTrailingSlash(baseUrl);
        if (!normalizedBaseUrl.isEmpty()) {
            headers.put("Referer", normalizedBaseUrl + "/");
            headers.put("Origin", normalizedBaseUrl);
        }

        if (appHeaders != null) {
            for (Map.Entry<String, String> entry : appHeaders.entrySet()) {
                String key = jsonValueAsString(entry.getKey()).trim();
                String value = jsonValueAsString(entry.getValue()).trim();
                if (key.isEmpty() || value.isEmpty()) {
                    continue;
                }
                if ("user-agent".equalsIgnoreCase(key)) {
                    headers.put("User-Agent", value);
                } else if ("referer".equalsIgnoreCase(key)) {
                    headers.put("Referer", value);
                } else if ("origin".equalsIgnoreCase(key)) {
                    headers.put("Origin", value);
                } else {
                    headers.put(key, value);
                }
            }
        }

        return headers;
    }

    private static String solveAppChallenge(Object spider, String challenge) {
        if (challenge == null || challenge.trim().isEmpty()) {
            return "";
        }
        try {
            Method method = spider.getClass().getDeclaredMethod("c", String.class);
            method.setAccessible(true);
            Object value = method.invoke(spider, challenge);
            return jsonValueAsString(value);
        } catch (Throwable error) {
            System.err.println("DEBUG: App3Q challenge reflection failed: " + error.getMessage());
            return "";
        }
    }

    private static String requestAppDecodedUrl(Object spider, String targetUrl, String source) throws Exception {
        List<String> baseCandidates = buildBaseUrlCandidates(readBaseUrl(spider));
        Map<String, String> headers = buildAppHeaders(spider);
        Throwable lastError = null;
        int candidateCount = Math.min(baseCandidates.size(), PLAYER_DECODE_BASE_CANDIDATE_LIMIT);
        for (int index = 0; index < candidateCount; index += 1) {
            String baseUrl = baseCandidates.get(index);
            try {
                return requestAppDecodedUrl(baseUrl, headers, spider, targetUrl, source, null);
            } catch (Throwable error) {
                lastError = error;
                System.err.println("DEBUG: App3Q app decode failed for base " + baseUrl + ": " + error.getMessage());
            }
        }

        if (lastError instanceof Exception) {
            throw (Exception) lastError;
        }
        throw new IllegalStateException("App3Q app decode failed without explicit error");
    }

    private static String requestAppDecodedUrl(
            String baseUrl,
            Map<String, String> headers,
            Object spider,
            String targetUrl,
            String source,
            String token) throws Exception {
        Map<String, String> params = new HashMap<>();
        params.put("url", targetUrl);
        if (source != null && !source.trim().isEmpty()) {
            params.put("vodFrom", source.trim());
        }
        if (token != null && !token.trim().isEmpty()) {
            params.put("token", token.trim());
        }

        String requestUrl = buildUrl(baseUrl, "/api.php/app/decode/url/", params);
        String payload = requestTextWithPlayerFallback(requestUrl, headers);
        if (payload == null || payload.trim().isEmpty()) {
            throw new IllegalStateException("App3Q app decode returned empty payload");
        }

        JSONObject root = new JSONObject(payload);
        int code = root.optInt("code", -1);
        if (code == 200) {
            return jsonValueAsString(root.opt("data"));
        }
        if (code == 2 && (token == null || token.trim().isEmpty())) {
            String challengeToken = solveAppChallenge(spider, root.optString("challenge"));
            if (!challengeToken.isEmpty()) {
                return requestAppDecodedUrl(baseUrl, headers, spider, targetUrl, source, challengeToken);
            }
        }
        throw new IllegalStateException("App3Q app decode returned code " + code + ": " + root.optString("msg"));
    }

    private static String requestViaUrlConnection(String url, Map<String, String> headers, boolean forceLegacyTls)
            throws IOException {
        return requestViaUrlConnection(url, headers, forceLegacyTls, 15_000, 15_000);
    }

    private static String requestViaUrlConnection(
            String url,
            Map<String, String> headers,
            boolean forceLegacyTls,
            int connectTimeoutMs,
            int readTimeoutMs)
            throws IOException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(connectTimeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    if (entry.getKey() == null || entry.getKey().trim().isEmpty()) {
                        continue;
                    }
                    String headerValue = entry.getValue() == null ? "" : entry.getValue();
                    connection.setRequestProperty(entry.getKey(), headerValue);
                }
            }
            if (forceLegacyTls && connection instanceof HttpsURLConnection) {
                HttpsURLConnection secure = (HttpsURLConnection) connection;
                secure.setSSLSocketFactory(new SSLCompat(SSLSocketClient.sslSocketFactory()));
                secure.setHostnameVerifier(SSLSocketClient.hostnameVerifier());
            }

            int statusCode = connection.getResponseCode();
            InputStream stream = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String payload = readStreamAsText(stream);
            if (statusCode < 200 || statusCode >= 300) {
                throw new IOException("HTTP " + statusCode + ": " + compactErrorBody(payload));
            }
            return payload;
        } catch (IOException error) {
            String mode = forceLegacyTls ? "legacy-tls" : "direct";
            throw new IOException("URLConnection " + mode + " failed: " + error.getMessage(), error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readStreamAsText(InputStream stream) throws IOException {
        if (stream == null) {
            return "";
        }
        try (InputStream input = stream) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String compactErrorBody(String payload) {
        if (payload == null) {
            return "";
        }
        String normalized = payload.replaceAll("\\s+", " ").trim();
        if (normalized.length() <= 120) {
            return normalized;
        }
        return normalized.substring(0, 120) + "...";
    }

    private static String buildUrl(String baseUrl, String path, Map<String, String> params) throws Exception {
        StringBuilder builder = new StringBuilder();
        builder.append(baseUrl);
        if (path != null) {
            builder.append(path);
        }

        if (params == null || params.isEmpty()) {
            return builder.toString();
        }

        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            String key = entry.getKey();
            String value = entry.getValue();
            if (key == null || key.trim().isEmpty() || value == null || value.trim().isEmpty()) {
                continue;
            }
            builder.append(first ? "?" : "&");
            first = false;
            builder.append(URLEncoder.encode(key, StandardCharsets.UTF_8.name()));
            builder.append("=");
            builder.append(URLEncoder.encode(value, StandardCharsets.UTF_8.name()));
        }
        return builder.toString();
    }

    private static boolean looksLikeDirectMediaUrl(String value) {
        if (value == null) {
            return false;
        }
        String normalized = value.trim().toLowerCase();
        if (!normalized.startsWith("http")) {
            return false;
        }
        return normalized.matches(".*(m3u8|mp4|flv|avi|mov|mkv).*");
    }

    private static String buildPlayerPayloadForUrl(
            String url,
            Map<String, String> headers,
            boolean forceParse) {
        if (url == null || url.trim().isEmpty()) {
            return "";
        }
        String normalized = url.trim();
        JSONObject payload = new JSONObject();
        payload.put("parse", forceParse ? 1 : (looksLikeDirectMediaUrl(normalized) ? 0 : 1));
        payload.put("jx", 0);
        payload.put("url", normalized);
        payload.put("header", new JSONObject(headers == null ? new HashMap<>() : headers));
        return payload.toString();
    }

    private static String summarizeUrl(String url) {
        if (url == null) {
            return "";
        }
        String current = url.trim();
        if (current.length() <= 96) {
            return current;
        }
        return current.substring(0, 96) + "...";
    }

    private static String buildPlayFrom(String rawPlayFrom, JSONArray vodPlayer) {
        String[] sources = splitGroups(rawPlayFrom);
        if (sources.length == 0) {
            return "";
        }

        Map<String, String> aliases = readVodPlayerAliases(vodPlayer);
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < sources.length; index += 1) {
            String source = sources[index];
            if (source.isEmpty()) {
                continue;
            }
            if (builder.length() > 0) {
                builder.append("$$$");
            }
            String alias = aliases.get(source);
            builder.append(alias == null || alias.trim().isEmpty() ? source : alias.trim());
        }
        return builder.toString();
    }

    private static String buildPlayUrl(
            String rawPlayFrom,
            String rawPlayUrl,
            JSONArray vodPlayer,
            String vodName) {
        String[] sources = splitGroups(rawPlayFrom);
        String[] groups = splitGroups(rawPlayUrl);
        if (groups.length == 0) {
            return "";
        }

        StringBuilder payload = new StringBuilder();
        for (int groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
            String group = groups[groupIndex];
            if (group == null || group.trim().isEmpty()) {
                continue;
            }
            String source = groupIndex < sources.length ? sources[groupIndex] : "";
            String[] episodes = group.split("#");
            StringBuilder groupBuilder = new StringBuilder();
            for (int episodeIndex = 0; episodeIndex < episodes.length; episodeIndex += 1) {
                String episode = episodes[episodeIndex];
                int splitAt = episode.indexOf('$');
                if (splitAt <= 0 || splitAt >= episode.length() - 1) {
                    continue;
                }

                String title = episode.substring(0, splitAt).trim();
                String url = episode.substring(splitAt + 1).trim();
                if (title.isEmpty() || url.isEmpty()) {
                    continue;
                }

                String index = extractDigits(title);
                if (index.isEmpty()) {
                    index = "1";
                }
                if (groupBuilder.length() > 0) {
                    groupBuilder.append("#");
                }
                groupBuilder.append(title)
                        .append("$")
                        .append(url)
                        .append("@")
                        .append(source)
                        .append("@")
                        .append(vodName == null ? "" : vodName)
                        .append("@")
                        .append(index);
            }

            if (groupBuilder.length() == 0) {
                continue;
            }
            if (payload.length() > 0) {
                payload.append("$$$");
            }
            payload.append(groupBuilder);
        }
        return payload.toString();
    }

    private static Map<String, String> readVodPlayerAliases(JSONArray vodPlayer) {
        Map<String, String> aliases = new HashMap<>();
        if (vodPlayer == null) {
            return aliases;
        }

        for (int index = 0; index < vodPlayer.length(); index += 1) {
            JSONObject item = vodPlayer.optJSONObject(index);
            if (item == null) {
                continue;
            }
            String from = jsonValueAsString(item.opt("from"));
            if (from.isEmpty()) {
                continue;
            }
            String show = jsonValueAsString(item.opt("show"));
            aliases.put(from, show.isEmpty() ? from : show);
        }
        return aliases;
    }

    private static JSONArray normalizeVodList(JSONArray source) {
        JSONArray result = new JSONArray();
        if (source == null) {
            return result;
        }

        for (int index = 0; index < source.length(); index += 1) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) {
                continue;
            }

            String vodId = jsonValueAsString(item.opt("vod_id"));
            String vodName = jsonValueAsString(item.opt("vod_name"));
            if (vodId.isEmpty() && vodName.isEmpty()) {
                continue;
            }

            if (vodId.isEmpty()) {
                vodId = vodName;
            }
            if (vodName.isEmpty()) {
                vodName = vodId;
            }

            result.put(new JSONObject()
                    .put("vod_id", vodId)
                    .put("vod_name", vodName)
                    .put("vod_pic", jsonValueAsString(item.opt("vod_pic")))
                    .put("vod_remarks", jsonValueAsString(item.opt("vod_remarks"))));
        }
        return result;
    }

    private static String readBaseUrl(Object spider) {
        try {
            Field field = spider.getClass().getDeclaredField("a");
            field.setAccessible(true);
            Object value = field.get(spider);
            String current = jsonValueAsString(value);
            if (!current.isEmpty()) {
                return trimTrailingSlash(current);
            }
        } catch (Throwable ignored) {
        }
        return DEFAULT_BASE_URL;
    }

    private static String trimTrailingSlash(String value) {
        String current = value == null ? "" : value.trim();
        while (current.endsWith("/")) {
            current = current.substring(0, current.length() - 1);
        }
        return current.isEmpty() ? DEFAULT_BASE_URL : current;
    }

    private static void copyFilterParam(Map<String, String> source, Map<String, String> target, String key) {
        String value = source.get(key);
        if (value != null && !value.trim().isEmpty()) {
            target.put(key, value.trim());
        }
    }

    private static String[] splitGroups(String value) {
        if (value == null || value.trim().isEmpty()) {
            return new String[0];
        }
        return value.split("\\$\\$\\$");
    }

    private static String extractDigits(String value) {
        return value == null ? "" : value.replaceAll("\\D+", "").trim();
    }

    private static String argAsString(List<Object> args, int index) {
        if (args == null || index < 0 || index >= args.size()) {
            return "";
        }
        return jsonValueAsString(args.get(index));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, String> argAsStringMap(List<Object> args, int index) {
        if (args == null || index < 0 || index >= args.size()) {
            return new HashMap<>();
        }
        Object value = args.get(index);
        if (!(value instanceof Map)) {
            return new HashMap<>();
        }

        Map<String, String> result = new HashMap<>();
        Map<Object, Object> source = (Map<Object, Object>) value;
        for (Map.Entry<Object, Object> entry : source.entrySet()) {
            String key = jsonValueAsString(entry.getKey());
            String current = jsonValueAsString(entry.getValue());
            if (!key.isEmpty()) {
                result.put(key, current);
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    private static String firstListValue(List<Object> args, int index) {
        if (args == null || index < 0 || index >= args.size()) {
            return "";
        }
        Object value = args.get(index);
        if (value instanceof List) {
            List<Object> items = (List<Object>) value;
            return items.isEmpty() ? "" : jsonValueAsString(items.get(0));
        }
        return jsonValueAsString(value);
    }

    private static boolean isNumeric(String value) {
        return value != null && value.matches("\\d+");
    }

    private static int parseInteger(String value, int fallback) {
        if (value == null || value.trim().isEmpty()) {
            return fallback;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static String jsonValueAsString(Object value) {
        if (value == null || JSONObject.NULL.equals(value)) {
            return "";
        }
        if (value instanceof String) {
            return ((String) value).trim();
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        return String.valueOf(value).trim();
    }
}
