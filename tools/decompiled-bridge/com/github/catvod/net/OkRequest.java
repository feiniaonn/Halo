/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  okhttp3.FormBody$Builder
 *  okhttp3.MediaType
 *  okhttp3.OkHttpClient
 *  okhttp3.Request
 *  okhttp3.Request$Builder
 *  okhttp3.RequestBody
 *  okhttp3.Response
 *  org.apache.commons.lang3.StringUtils
 */
package com.github.catvod.net;

import com.github.catvod.crawler.SpiderDebug;
import com.github.catvod.net.OkResult;
import com.github.catvod.utils.Util;
import java.io.IOException;
import java.util.Map;
import okhttp3.FormBody;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.apache.commons.lang3.StringUtils;

class OkRequest {
    private final Map<String, String> header;
    private final Map<String, String> params;
    private final String method;
    private final String json;
    private Request request;
    private String url;
    private Object tag;

    OkRequest(String string, String string2, Map<String, String> map, Map<String, String> map2) {
        this(string, string2, null, map, map2);
    }

    OkRequest(String string, String string2, String string3, Map<String, String> map) {
        this(string, string2, string3, null, map);
    }

    private OkRequest(String string, String string2, String string3, Map<String, String> map, Map<String, String> map2) {
        this.url = string2;
        this.json = string3;
        this.method = string;
        this.params = map;
        this.header = map2;
        this.getInstance();
    }

    public OkRequest tag(Object object) {
        this.tag = object;
        return this;
    }

    private void getInstance() {
        Request.Builder builder = new Request.Builder();
        if (this.method.equals("GET") && this.params != null) {
            this.setParams();
        }
        if (this.method.equals("POST")) {
            builder.post(this.getRequestBody());
        }
        if (this.header != null) {
            for (String string : this.header.keySet()) {
                builder.addHeader(string, this.header.get(string));
            }
        }
        if (this.tag != null) {
            builder.tag(this.tag);
        }
        this.request = builder.url(this.url).build();
    }

    private RequestBody getRequestBody() {
        if (!StringUtils.isEmpty((CharSequence)this.json)) {
            return RequestBody.create((MediaType)MediaType.get((String)"application/json; charset=utf-8"), (String)this.json);
        }
        FormBody.Builder builder = new FormBody.Builder();
        if (this.params != null) {
            for (String string : this.params.keySet()) {
                builder.add(string, this.params.get(string));
            }
        }
        return builder.build();
    }

    private void setParams() {
        this.url = this.url + "?";
        for (String string : this.params.keySet()) {
            this.url = this.url.concat(string + "=" + this.params.get(string) + "&");
        }
        this.url = Util.substring(this.url);
    }

    public OkResult execute(OkHttpClient okHttpClient) {
        OkResult okResult;
        block8: {
            Response response = okHttpClient.newCall(this.request).execute();
            try {
                okResult = new OkResult(response.code(), response.body().string(), response.headers().toMultimap());
                if (response == null) break block8;
            }
            catch (Throwable throwable) {
                try {
                    if (response != null) {
                        try {
                            response.close();
                        }
                        catch (Throwable throwable2) {
                            throwable.addSuppressed(throwable2);
                        }
                    }
                    throw throwable;
                }
                catch (IOException iOException) {
                    SpiderDebug.log("request fail path:" + iOException.getMessage());
                    throw new RuntimeException("Network request failed: " + iOException.getMessage(), iOException);
                }
            }
            response.close();
        }
        return okResult;
    }
}

