/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  okhttp3.Dns
 *  okhttp3.Headers
 *  okhttp3.Interceptor
 *  okhttp3.OkHttpClient
 *  okhttp3.OkHttpClient$Builder
 *  okhttp3.Request
 *  okhttp3.Request$Builder
 *  okhttp3.Response
 */
package com.github.catvod.net;

import com.github.catvod.net.OkRequest;
import com.github.catvod.net.OkResult;
import com.github.catvod.net.OkhttpInterceptor;
import com.github.catvod.net.SSLSocketClient;
import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.Headers;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class OkHttp {
    public static final String POST = "POST";
    public static final String GET = "GET";
    private OkHttpClient client;
    private OkHttpClient shortTimeOutClient;

    public static OkHttp get() {
        return Loader.INSTANCE;
    }

    public static Dns dns() {
        return Dns.SYSTEM;
    }

    public static OkHttpClient client() {
        if (OkHttp.get().client != null) {
            return OkHttp.get().client;
        }
        OkHttp.get().client = OkHttp.getBuilder().build();
        return OkHttp.get().client;
    }

    public static OkHttpClient shortTimeoutClient() {
        if (OkHttp.get().client != null) {
            return OkHttp.get().shortTimeOutClient;
        }
        OkHttp.get().client = OkHttp.getBuilder().callTimeout(Duration.ofSeconds(2L)).build();
        return OkHttp.get().client;
    }

    public static OkHttpClient noRedirect() {
        return OkHttp.client().newBuilder().followRedirects(false).followSslRedirects(false).build();
    }

    public static Response newCall(Request request) throws IOException {
        return OkHttp.client().newCall(request).execute();
    }

    public static Response newCall(String string) throws IOException {
        return OkHttp.client().newCall(new Request.Builder().url(string).build()).execute();
    }

    public static Response newCall(String string, Map<String, String> map) throws IOException {
        return OkHttp.client().newCall(new Request.Builder().url(string).headers(Headers.of(map)).build()).execute();
    }

    public static String string(String string) {
        return OkHttp.string(string, null);
    }

    public static String string(String string, Map<String, String> map) {
        return OkHttp.string(OkHttp.client(), string, null, map);
    }

    public static String string(String string, Map<String, String> map, Map<String, String> map2) {
        return OkHttp.string(OkHttp.client(), string, map, map2);
    }

    public static String string(OkHttpClient okHttpClient, String string, Map<String, String> map) {
        return OkHttp.string(okHttpClient, string, null, map);
    }

    public static String string(OkHttpClient okHttpClient, String string, Map<String, String> map, Map<String, String> map2) {
        return string.startsWith("http") ? new OkRequest(GET, string, map, map2).execute(okHttpClient).getBody() : "";
    }

    public static String post(String string, Map<String, String> map) {
        return OkHttp.post(OkHttp.client(), string, map, null).getBody();
    }

    public static OkResult post(String string, Map<String, String> map, Map<String, String> map2) {
        return OkHttp.post(OkHttp.client(), string, map, map2);
    }

    public static OkResult post(OkHttpClient okHttpClient, String string, Map<String, String> map, Map<String, String> map2) {
        return new OkRequest(POST, string, map, map2).execute(okHttpClient);
    }

    public static String post(String string, String string2) {
        return OkHttp.post(string, string2, null).getBody();
    }

    public static OkResult post(String string, String string2, Map<String, String> map) {
        return OkHttp.post(OkHttp.client(), string, string2, map);
    }

    public static OkResult post(OkHttpClient okHttpClient, String string, String string2, Map<String, String> map) {
        return new OkRequest(POST, string, string2, map).execute(okHttpClient);
    }

    public static OkResult get(String string, Map<String, String> map, Map<String, String> map2) {
        return new OkRequest(GET, string, map, map2).execute(OkHttp.client());
    }

    public static String getLocation(String string, Map<String, String> map) throws IOException {
        return OkHttp.getLocation(OkHttp.noRedirect().newCall(new Request.Builder().url(string).headers(Headers.of(map)).build()).execute().headers().toMultimap());
    }

    public static String getLocation(Map<String, List<String>> map) {
        if (map == null) {
            return null;
        }
        if (map.containsKey("location")) {
            return map.get("location").get(0);
        }
        return null;
    }

    public static OkHttpClient.Builder getBuilder() {
        return new OkHttpClient.Builder().addInterceptor((Interceptor)new OkhttpInterceptor()).dns(OkHttp.dns()).connectTimeout(10L, TimeUnit.SECONDS).readTimeout(8L, TimeUnit.SECONDS).writeTimeout(10L, TimeUnit.SECONDS).sslSocketFactory(SSLSocketClient.getSSLSocketFactory(), SSLSocketClient.getX509TrustManager()).hostnameVerifier(SSLSocketClient.getHostnameVerifier());
    }

    private static class Loader {
        static volatile OkHttp INSTANCE = new OkHttp();

        private Loader() {
        }
    }
}

