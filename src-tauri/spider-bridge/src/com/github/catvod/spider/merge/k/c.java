package com.github.catvod.spider.merge.k;

import android.text.TextUtils;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import okhttp3.FormBody;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class c {
    private final Map<String, String> a;
    private final Map<String, String> b;
    private final String c;
    private final String d;
    private Request e;
    private String f;
    private Object g;

    private c(
            String method,
            String url,
            String body,
            Map<String, String> params,
            Map<String, String> headers) {
        this.f = url;
        this.d = body;
        this.c = method;
        this.b = params;
        this.a = headers;

        Request.Builder builder = new Request.Builder();
        if ("GET".equals(method) && params != null && !params.isEmpty()) {
            StringBuilder urlBuilder = new StringBuilder();
            urlBuilder.append(this.f);
            urlBuilder.append("?");
            for (String key : params.keySet()) {
                urlBuilder.append(key);
                urlBuilder.append("=");
                urlBuilder.append(params.get(key));
                urlBuilder.append("&");
            }
            String nextUrl = urlBuilder.toString();
            if (nextUrl != null && nextUrl.length() > 1) {
                nextUrl = nextUrl.substring(0, nextUrl.length() - 1);
            }
            this.f = nextUrl;
        }

        if ("POST".equals(this.c)) {
            RequestBody requestBody;
            if (!TextUtils.isEmpty(this.d)) {
                requestBody = RequestBody.create(
                        MediaType.get("application/json; charset=utf-8"),
                        this.d);
            } else {
                FormBody.Builder formBuilder = new FormBody.Builder();
                if (this.b != null) {
                    for (String key : this.b.keySet()) {
                        formBuilder.add(key, this.b.get(key));
                    }
                }
                requestBody = formBuilder.build();
            }
            builder.post(requestBody);
        }

        if (this.a != null && !this.a.isEmpty()) {
            for (String key : this.a.keySet()) {
                String value = this.a.get(key);
                if (key == null || key.trim().isEmpty()) {
                    continue;
                }
                if (value == null || value.trim().isEmpty()) {
                    continue;
                }
                builder.addHeader(key, value);
            }
        }

        if (this.g != null) {
            builder.tag(this.g);
        }

        this.e = builder.url(this.f).build();
    }

    public c(String url, String body, Map<String, String> headers) {
        this("POST", url, body, null, headers);
    }

    public c(String method, String url, Map<String, String> params, Map<String, String> headers) {
        this(method, url, null, params, headers);
    }

    public c(
            String url,
            Map<String, String> params,
            Map<String, String> headers,
            Map<String, List<String>> ignoredResponseHeaders) {
        this("GET", url, null, params, headers);
    }

    public final d a(OkHttpClient client) {
        try {
            Response response = client.newCall(this.e).execute();
            return new d(
                    response.code(),
                    response.body() == null ? "" : response.body().string(),
                    response.headers().toMultimap());
        } catch (IOException ignored) {
            return new d();
        }
    }

    public final c b() {
        this.g = "";
        return this;
    }
}
