/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  org.apache.commons.lang3.StringUtils
 */
package com.github.catvod.net;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.apache.commons.lang3.StringUtils;

public class OkResult {
    private final int code;
    private final String body;
    private final Map<String, List<String>> resp;

    public OkResult() {
        this.code = 500;
        this.body = "";
        this.resp = new HashMap<String, List<String>>();
    }

    public OkResult(int n, String string, Map<String, List<String>> map) {
        this.code = n;
        this.body = string;
        this.resp = map;
    }

    public int getCode() {
        return this.code;
    }

    public String getBody() {
        return StringUtils.isEmpty((CharSequence)this.body) ? "" : this.body;
    }

    public Map<String, List<String>> getResp() {
        return this.resp;
    }
}

