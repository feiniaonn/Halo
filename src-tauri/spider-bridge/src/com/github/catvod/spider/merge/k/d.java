package com.github.catvod.spider.merge.k;

import java.util.Collections;
import java.util.List;
import java.util.Map;

public final class d {
    private final int a;
    private final String b;
    private final Map<String, List<String>> c;

    public d() {
        this(0, "", Collections.emptyMap());
    }

    public d(int code, String body, Map<String, List<String>> headers) {
        this.a = code;
        this.b = body == null ? "" : body;
        this.c = headers == null ? Collections.emptyMap() : headers;
    }

    public final String a() {
        return this.b;
    }

    public final int b() {
        return this.a;
    }

    public final Map<String, List<String>> c() {
        return this.c;
    }
}
