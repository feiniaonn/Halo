package com.github.catvod.spider.merge.E0.d;

import java.util.HashMap;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

public final class c {
    private static volatile OkHttpClient a;

    public c() {
    }

    public static OkHttpClient a() {
        if (a != null) {
            return a;
        }

        synchronized (c.class) {
            if (a == null) {
                a = new OkHttpClient.Builder()
                        .retryOnConnectionFailure(true)
                        .followRedirects(true)
                        .followSslRedirects(true)
                        .connectTimeout(30L, TimeUnit.SECONDS)
                        .readTimeout(30L, TimeUnit.SECONDS)
                        .writeTimeout(30L, TimeUnit.SECONDS)
                        .build();
            }
        }

        return a;
    }

    public static String b(String url, HashMap headers) {
        if (url == null || !url.startsWith("http")) {
            return "";
        }

        try {
            return new d(url, headers).a(a()).a();
        } catch (Throwable ignored) {
            return "";
        }
    }
}
