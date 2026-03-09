package com.github.catvod.spider.merge.b0;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Desktop-safe response wrapper for transformed spider runtimes.
 */
public final class i {
    private final int code;
    private final String body;
    private final Map<String, List<String>> headers;

    public i() {
        this(0, "", Collections.emptyMap());
    }

    public i(int code, String body) {
        this(code, body, Collections.emptyMap());
    }

    public i(int code, String body, Map<String, List<String>> headers) {
        this.code = code;
        this.body = body == null ? "" : body;
        this.headers = headers == null ? Collections.emptyMap() : headers;
    }

    public String a() {
        return body;
    }

    public int b() {
        return code;
    }

    public Map<String, List<String>> c() {
        return headers;
    }
}
