package com.github.catvod.spider.merge.J;

/**
 * Desktop-safe replacement for legacy merge.J vod entries.
 * Exposes standard TVBox field names so the desktop frontend can consume
 * results without needing spider-family specific adapters.
 */
public final class i {
    private String a = "";
    private String b = "";
    private String c = "";
    private String d = "";
    private String e = "";
    private String f = "";
    private String g = "";
    private String h = "";
    private String i = "";
    private String j = "";
    private String k = "";
    private String l = "";
    private String m = "";
    private String n = "";

    public String vod_id = "";
    public String vod_name = "";
    public String vod_pic = "";
    public String vod_remarks = "";
    public String type_name = "";
    public String vod_year = "";
    public String vod_area = "";
    public String vod_actor = "";
    public String vod_director = "";
    public String vod_content = "";
    public String vod_play_from = "";
    public String vod_play_url = "";

    public i() {
    }

    public i(String first, String second, String third) {
        l(first);
        m(second);
        n(third);
    }

    public i(String first, String second, String third, String fourth) {
        this(first, second, third);
        q(fourth);
    }

    public i(String first, String second, String third, String fourth, String fifth) {
        this(first, second, third, fourth);
        j(fifth);
    }

    public i(String first, String second, String third, String fourth, boolean ignored) {
        this(first, second, third, fourth);
    }

    public String a() {
        return b;
    }

    public String b() {
        return j;
    }

    public String c() {
        return b;
    }

    public String d() {
        return c;
    }

    public String e() {
        return d;
    }

    public String f() {
        return m;
    }

    public void g(String value) {
        a = safe(value);
        if (vod_actor.isEmpty()) {
            vod_actor = a;
        }
    }

    public void h(String value) {
        h = safe(value);
        if (vod_director.isEmpty()) {
            vod_director = h;
        }
    }

    public void i(String value) {
        g = safe(value);
        if (type_name.isEmpty()) {
            type_name = g;
        }
        if (vod_remarks.isEmpty()) {
            vod_remarks = g;
        }
    }

    public void j(String value) {
        j = safe(value);
        if (vod_content.isEmpty()) {
            vod_content = j;
        }
    }

    public void k(String value) {
        i = safe(value);
        if (vod_area.isEmpty()) {
            vod_area = i;
        }
    }

    public void l(String value) {
        b = safe(value);
        vod_id = b;
    }

    public void m(String value) {
        c = safe(value);
        vod_name = c;
    }

    public void n(String value) {
        d = safe(value);
        vod_pic = d;
    }

    public void o(String value) {
        l = safe(value);
        vod_play_from = l;
    }

    public void p(String value) {
        m = safe(value);
        vod_play_url = m;
    }

    public void q(String value) {
        e = safe(value);
        vod_remarks = e;
    }

    public void r(String value) {
        n = safe(value);
        if (vod_year.isEmpty()) {
            vod_year = n;
        }
    }

    public void s(String value) {
        f = safe(value);
        if (vod_name.isEmpty()) {
            vod_name = f;
        } else if (vod_year.isEmpty()) {
            vod_year = f;
        }
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }
}
