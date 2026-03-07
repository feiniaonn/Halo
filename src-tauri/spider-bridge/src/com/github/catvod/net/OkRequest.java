package com.github.catvod.net;

import okhttp3.Headers;
import okhttp3.Request;
import okhttp3.RequestBody;

import java.util.Map;

/**
 * Helper to build OkHttp requests with optional headers.
 */
public class OkRequest {
    private final String url;
    private final Map<String, String> header;

    public OkRequest(String url, Map<String, String> header) {
        this.url = url;
        this.header = header;
    }

    public Request buildGet(String tag) {
        Request.Builder builder = new Request.Builder().url(url).get();
        boolean hasUA = false;
        if (header != null) {
            for (Map.Entry<String, String> entry : header.entrySet()) {
                builder.addHeader(entry.getKey(), entry.getValue());
                if (entry.getKey().equalsIgnoreCase("User-Agent")) hasUA = true;
            }
        }
        if (!hasUA) {
            builder.addHeader("User-Agent", "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36");
        }
        if (tag != null) {
            builder.tag(tag);
        }
        return builder.build();
    }

    public Request buildPost(RequestBody body, String tag) {
        Request.Builder builder = new Request.Builder().url(url).post(body);
        boolean hasUA = false;
        if (header != null) {
            for (Map.Entry<String, String> entry : header.entrySet()) {
                builder.addHeader(entry.getKey(), entry.getValue());
                if (entry.getKey().equalsIgnoreCase("User-Agent")) hasUA = true;
            }
        }
        if (!hasUA) {
            builder.addHeader("User-Agent", "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36");
        }
        if (tag != null) {
            builder.tag(tag);
        }
        return builder.build();
    }
}