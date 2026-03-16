package com.github.catvod.spider.merge.FM.m;

import com.github.catvod.crawler.Spider;
import com.halo.spider.RustTransportBridge;
import java.io.IOException;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public final class c {
    private static final String DOUBAN_REFERER =
            "https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html";
    private static final String DOUBAN_API_REFERER = "https://api.douban.com/";
    private static final String DOUBAN_USER_AGENT =
            "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36 "
                    + "MicroMessenger/7.0.9.501 NetType/WIFI MiniProgramEnv/Windows WindowsWechat";
    private static volatile OkHttpClient d;
    private static final ThreadLocal<String> LAST_ERROR = new ThreadLocal<>();

    public c() {
    }

    public static OkHttpClient a() {
        OkHttpClient current = d;
        if (current != null) {
            return current;
        }

        synchronized (c.class) {
            if (d == null) {
                d = buildClient(true);
            }
            return d;
        }
    }

    public static String c(String url, Map<String, String> headers) {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeLocation(url, headers, false, 30_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: merge.FM.m.c redirect transport failed for " + url + " -> " + error.getMessage());
            }
        }
        try (Response response = f().newCall(buildGetRequest(url, headers)).execute()) {
            String location = response.header("location");
            if (location == null || location.trim().isEmpty()) {
                location = response.header("Location");
            }
            return location == null ? null : location.trim();
        } catch (IOException ignored) {
            return null;
        }
    }

    public static Response d(String url) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeResponse(url, "GET", null, null, null, null, true, 30_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: merge.FM.m.c response transport failed for " + url + " -> " + error.getMessage());
            }
        }
        return a().newCall(new Request.Builder().url(url).build()).execute();
    }

    public static Response e(String url, Map<String, String> headers) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeResponse(url, "GET", headers, null, null, null, true, 30_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: merge.FM.m.c response+headers transport failed for " + url + " -> " + error.getMessage());
            }
        }
        return a().newCall(buildGetRequest(url, headers)).execute();
    }

    public static OkHttpClient f() {
        return a().newBuilder()
                .followRedirects(false)
                .followSslRedirects(false)
                .build();
    }

    public static String m(String url) {
        return n(url, null);
    }

    public static String consumeLastError() {
        String error = LAST_ERROR.get();
        LAST_ERROR.remove();
        return error == null ? "" : error;
    }

    public static String n(String url, Map<String, String> headers) {
        String trimmed = url == null ? "" : url.trim();
        if (trimmed.isEmpty() || !trimmed.startsWith("http")) {
            LAST_ERROR.remove();
            return "";
        }

        if (RustTransportBridge.isEnabled()) {
            try {
                String body = RustTransportBridge.executeText(
                        trimmed,
                        "GET",
                        headers,
                        null,
                        null,
                        null,
                        true,
                        30_000L);
                LAST_ERROR.remove();
                return body == null ? "" : body;
            } catch (IOException error) {
                String message = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
                LAST_ERROR.set(message);
                System.err.println("DEBUG: merge.FM.m.c unified GET failed for " + trimmed + " -> " + message);
            }
        }

        try (Response response = a().newCall(buildGetRequest(trimmed, headers)).execute()) {
            LAST_ERROR.remove();
            return response.body() == null ? "" : response.body().string();
        } catch (IOException error) {
            String message = error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
            LAST_ERROR.set(message);
            System.err.println("DEBUG: merge.FM.m.c GET failed for " + trimmed + " -> " + message);
            return "";
        }
    }

    private static Request buildGetRequest(String url, Map<String, String> headers) {
        Request.Builder builder = new Request.Builder().url(url);
        applyDoubanDefaultHeaders(url, builder);
        if (headers != null && !headers.isEmpty()) {
            for (Map.Entry<String, String> entry : headers.entrySet()) {
                String key = entry.getKey();
                String value = entry.getValue();
                if (key == null || value == null) {
                    continue;
                }
                String nextKey = key.trim();
                String nextValue = value.trim();
                if (!nextKey.isEmpty() && !nextValue.isEmpty()) {
                    builder.addHeader(nextKey, nextValue);
                }
            }
        }
        return builder.build();
    }

    private static void applyDoubanDefaultHeaders(String url, Request.Builder builder) {
        if (url == null) {
            return;
        }

        String normalized = url.trim().toLowerCase();
        if (!normalized.contains("douban")) {
            return;
        }

        builder.header("Accept", "application/json, text/plain, */*");
        builder.header("User-Agent", DOUBAN_USER_AGENT);

        if (normalized.contains("doubanio.com")) {
            builder.header("Referer", DOUBAN_API_REFERER);
            return;
        }

        if (normalized.contains("frodo.douban.com")) {
            builder.header("Host", "frodo.douban.com");
        }
        builder.header("Referer", DOUBAN_REFERER);
    }

    private static OkHttpClient buildClient(boolean followRedirects) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder();

        Dns dns = Dns.SYSTEM;
        try {
            Dns safeDns = Spider.safeDns();
            if (safeDns != null) {
                dns = safeDns;
            }
        } catch (Throwable ignored) {
        }

        builder.dns(dns)
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .followRedirects(followRedirects)
                .followSslRedirects(followRedirects)
                .hostnameVerifier(new TrustAllHostnameVerifier());

        try {
            SSLSocketFactory socketFactory = new g();
            builder.sslSocketFactory(socketFactory, g.d);
        } catch (Throwable ignored) {
        }

        return builder.build();
    }

    private static final class TrustAllManager implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }

    private static final class TrustAllHostnameVerifier implements HostnameVerifier {
        @Override
        public boolean verify(String hostname, SSLSession session) {
            return true;
        }
    }
}
