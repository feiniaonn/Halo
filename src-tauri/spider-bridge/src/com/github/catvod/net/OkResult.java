package com.github.catvod.net;

import java.util.List;
import java.util.Map;

public class OkResult {
    private int code;
    private String body;
    private Map<String, List<String>> headers;

    public OkResult(int code, String body, Map<String, List<String>> headers) {
        this.code = code;
        this.body = body;
        this.headers = headers;
    }

    public int getCode() {
        return code;
    }

    public String getBody() {
        return body != null ? body : "";
    }

    public Map<String, List<String>> getHeaders() {
        return headers;
    }
}