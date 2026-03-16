package com.github.catvod.spider.merge.E0.d;

import java.io.IOException;
import java.util.HashMap;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public final class d {
    private Request a;
    private String b;

    public d(String url, HashMap<String, String> headers) {
        this.b = url;
        Request.Builder builder = new Request.Builder();
        if (headers != null && !headers.isEmpty()) {
            for (String key : headers.keySet()) {
                builder.addHeader(key, headers.get(key));
            }
        }
        this.a = builder.url(this.b).build();
    }

    public final e a(OkHttpClient client) {
        try {
            Response response = client.newCall(this.a).execute();
            String body = response.body() == null ? "" : response.body().string();
            return new e(body);
        } catch (IOException ignored) {
            return new e();
        }
    }
}
