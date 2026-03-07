/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  okhttp3.Dns
 */
package com.github.catvod.crawler;

import android.content.Context;
import java.util.HashMap;
import java.util.List;
import okhttp3.Dns;

public class Spider {
    public String siteKey;

    public String action(String string) throws Exception {
        return "";
    }

    public String detailContent(List<String> list) throws Exception {
        return "";
    }

    public void destroy() throws Exception {
    }

    public String homeContent(boolean bl) throws Exception {
        return "";
    }

    public String homeVideoContent() throws Exception {
        return "";
    }

    public void init(Object object) throws Exception {
    }

    public void init(Object object, String string) throws Exception {
        this.init(object);
    }

    public void init(Context context) throws Exception {
        this.init((Object)context);
    }

    public void init(Context context, String string) throws Exception {
        this.init((Object)context, string);
    }

    public void init(String string) throws Exception {
    }

    public boolean isVideoFormat(String string) throws Exception {
        return false;
    }

    public String liveContent(String string) throws Exception {
        return "";
    }

    public boolean manualVideoCheck() throws Exception {
        return false;
    }

    public String playerContent(String string, String string2, List<String> list) throws Exception {
        return "";
    }

    public String searchContent(String string, boolean bl) throws Exception {
        return "";
    }

    public String searchContent(String string, boolean bl, String string2) throws Exception {
        return "";
    }

    public String categoryContent(String string, String string2, boolean bl, HashMap<String, String> hashMap) throws Exception {
        return "";
    }

    public static Dns safeDns() {
        return Dns.SYSTEM;
    }
}

