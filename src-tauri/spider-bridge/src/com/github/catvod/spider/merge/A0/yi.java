package com.github.catvod.spider.merge.A0;

import java.io.IOException;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.AbstractMap;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public abstract class yi {
    public static final Object a = new Object();
    public static OkHttpClient b;
    public static final HashMap c = new HashMap();
    public static OkHttpClient d;

    static {
    }

    public static void e() {
        OkHttpClient client = f();
        if (client == null) {
            return;
        }

        cancelTaggedCalls(client);
    }

    public static OkHttpClient f() {
        synchronized (a) {
            if (b == null) {
                b = buildClient(true);
            }
            return b;
        }
    }

    public static String h(AbstractMap headers) {
        if (headers == null) {
            return null;
        }
        Object lower = headers.get("location");
        if (lower instanceof java.util.List && !((java.util.List) lower).isEmpty()) {
            Object first = ((java.util.List) lower).get(0);
            return first == null ? null : String.valueOf(first);
        }
        Object upper = headers.get("Location");
        if (upper instanceof java.util.List && !((java.util.List) upper).isEmpty()) {
            Object first = ((java.util.List) upper).get(0);
            return first == null ? null : String.valueOf(first);
        }
        return null;
    }

    public static String k(String url, HashMap headers) {
        return m(f(), url, null, headers, null);
    }

    public static String l(String url, HashMap headers, HashMap responseHeaders) {
        return m(f(), url, null, headers, responseHeaders);
    }

    public static String m(
            OkHttpClient client,
            String url,
            String ignoredBody,
            HashMap headers,
            AbstractMap responseHeaders) {
        if (client == null || url == null || url.trim().isEmpty()) {
            return "";
        }

        try (Response response = client.newCall(buildRequest(url, headers)).execute()) {
            if (responseHeaders != null) {
                responseHeaders.clear();
                for (String name : response.headers().names()) {
                    responseHeaders.put(name, response.headers(name));
                }
            }
            return response.body() == null ? "" : response.body().string();
        } catch (IOException ignored) {
            return "";
        }
    }

    public static String n(String url, HashMap headers, AbstractMap responseHeaders) {
        synchronized (a) {
            if (d == null) {
                d = buildClient(false);
            }
        }
        return m(d, url, null, headers, responseHeaders);
    }

    private static Request buildRequest(String url, HashMap headers) {
        Request.Builder builder = new Request.Builder().url(url).get().tag("p_json_parse");
        if (headers != null && !headers.isEmpty()) {
            for (Object entryObject : headers.entrySet()) {
                if (!(entryObject instanceof Map.Entry)) {
                    continue;
                }
                Map.Entry entry = (Map.Entry) entryObject;
                if (entry.getKey() == null || entry.getValue() == null) {
                    continue;
                }
                String key = String.valueOf(entry.getKey()).trim();
                String value = String.valueOf(entry.getValue()).trim();
                if (!key.isEmpty() && !value.isEmpty()) {
                    builder.addHeader(key, value);
                }
            }
        }
        return builder.build();
    }

    private static void cancelTaggedCalls(OkHttpClient client) {
        for (okhttp3.Call call : client.dispatcher().queuedCalls()) {
            Object tag = call.request().tag();
            if ("p_json_parse".equals(tag)) {
                call.cancel();
            }
        }
        for (okhttp3.Call call : client.dispatcher().runningCalls()) {
            Object tag = call.request().tag();
            if ("p_json_parse".equals(tag)) {
                call.cancel();
            }
        }
    }

    private static OkHttpClient buildClient(boolean followRedirects) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
                .readTimeout(10, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .connectTimeout(10, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .followRedirects(followRedirects)
                .followSslRedirects(followRedirects);

        try {
            TrustAllManager trustAll = new TrustAllManager();
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new TrustManager[] { trustAll }, new SecureRandom());
            SSLSocketFactory socketFactory = sslContext.getSocketFactory();
            builder.sslSocketFactory(socketFactory, trustAll);
            builder.hostnameVerifier(new TrustAllHostnameVerifier());
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
