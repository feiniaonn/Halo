package com.github.catvod.crawler;

import android.content.Context;
import java.util.HashMap;
import java.util.List;

/**
 * Base Spider interface for CatVod spiders.
 * All spider implementations must extend this class.
 */
public abstract class Spider {
    protected SpiderApi spiderApi;

    public void initApi(SpiderApi spiderApi) {
        this.spiderApi = spiderApi;
    }

    public void init(Context context, String extend) throws Exception {
    }

    public void init(Context context) throws Exception {
    }

    public String homeContent(boolean filter) throws Exception {
        return "";
    }

    public String homeVideoContent() throws Exception {
        return "";
    }

    public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend) throws Exception {
        return "";
    }

    public String detailContent(List<String> ids) throws Exception {
        return "";
    }

    public String searchContent(String key, boolean quick) throws Exception {
        return "";
    }

    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return searchContent(key, quick);
    }

    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        return "";
    }

    public String action(String action) {
        return "";
    }

    public String liveContent(String url) {
        return "";
    }

    public boolean manualVideoCheck() throws Exception {
        return false;
    }

    public boolean isVideoFormat(String url) throws Exception {
        return false;
    }

    public Object[] proxyLocal(java.util.Map<String, String> params) throws Exception {
        return null;
    }

    public static okhttp3.Dns safeDns() {
        return okhttp3.Dns.SYSTEM;
    }

    public boolean isLocal() {
        return false;
    }

    public String getName() {
        return "";
    }

    public String getVersion() {
        return "";
    }

    public void destroy() {
    }
}
