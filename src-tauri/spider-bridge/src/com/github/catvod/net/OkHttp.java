package com.github.catvod.net;

import com.halo.spider.RustTransportBridge;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.RequestBody;
import okhttp3.MediaType;
import okhttp3.Headers;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * OkHttp wrapper for CatVod spiders.
 * Provides simple GET/POST helpers with custom headers.
 */
public class OkHttp {

    public static OkHttpClient client;

    static {
        client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .sslSocketFactory(SSLSocketClient.sslSocketFactory(), SSLSocketClient.trustManager())
            .hostnameVerifier(SSLSocketClient.hostnameVerifier())
            .build();
    }

    public static OkHttpClient get() {
        return client;
    }

    private static synchronized OkHttpClient client() {
        return client;
    }

    public static String string(String url, Map<String, String> header) throws IOException {
        OkResult res = get(url, header);
        return res.getBody();
    }


    public static OkResult get(String url, Map<String, String> header) throws IOException {
        return execute(url, header);
    }

    public static OkResult post(String url, String json, Map<String, String> header) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeOkResult(
                        url,
                        "POST",
                        header,
                        json,
                        null,
                        "json",
                        true,
                        15_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: OkHttp unified JSON POST failed for " + url + " -> " + error.getMessage());
            }
        }
        MediaType JSON = MediaType.parse("application/json; charset=utf-8");
        RequestBody body = RequestBody.create(JSON, json);
        OkRequest req = new OkRequest(url, header);
        Request request = req.buildPost(body, null);
        try (Response response = client().newCall(request).execute()) {
            String b = response.body() != null ? response.body().string() : "";
            return new OkResult(response.code(), b, response.headers().toMultimap());
        }
    }

    public static OkResult execute(String url) throws IOException {
        return execute(url, null);
    }

    public static OkResult execute(String url, Map<String, String> header) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeOkResult(url, "GET", header, null, null, null, true, 15_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: OkHttp unified GET failed for " + url + " -> " + error.getMessage());
            }
        }
        OkRequest req = new OkRequest(url, header);
        Request request = req.buildGet(null);
        try (Response response = client().newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            return new OkResult(response.code(), body, response.headers().toMultimap());
        }
    }

    public static String post(String url, Map<String, String> header) throws IOException {
        OkResult res = post(url, "", header);
        return res.getBody();
    }

    public static String post(String url, Map<String, String> params, Map<String, String> header) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeText(
                        url,
                        "POST",
                        header,
                        null,
                        params,
                        "form",
                        true,
                        15_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: OkHttp unified form POST failed for " + url + " -> " + error.getMessage());
            }
        }
        okhttp3.FormBody.Builder builder = new okhttp3.FormBody.Builder();
        if (params != null) {
            for (Map.Entry<String, String> entry : params.entrySet()) {
                builder.add(entry.getKey(), entry.getValue());
            }
        }
        OkRequest req = new OkRequest(url, header);
        Request request = req.buildPost(builder.build(), null);
        try (Response response = client().newCall(request).execute()) {
            return response.body() != null ? response.body().string() : "";
        }
    }

    public static OkResult getEx(String url, Map<String, String> header) throws IOException {
        return get(url, header);
    }

    public static Response newCall(String url) throws IOException {
        if (RustTransportBridge.isEnabled()) {
            try {
                return RustTransportBridge.executeResponse(url, "GET", null, null, null, null, true, 15_000L);
            } catch (IOException error) {
                System.err.println("DEBUG: OkHttp unified response GET failed for " + url + " -> " + error.getMessage());
            }
        }
        Request request = new Request.Builder().url(url).get().build();
        return client().newCall(request).execute();
    }
}
