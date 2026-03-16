package com.github.catvod.spider.merge.c;

import com.google.gson.annotations.SerializedName;

public final class e {
    @SerializedName("type_name")
    private String a;

    @SerializedName("vod_id")
    private String b;

    @SerializedName("vod_name")
    private String c;

    @SerializedName("vod_pic")
    private String d;

    @SerializedName("vod_remarks")
    private String e;

    @SerializedName("vod_year")
    private String f;

    @SerializedName("vod_area")
    private String g;

    @SerializedName("vod_actor")
    private String h;

    @SerializedName("vod_director")
    private String i;

    @SerializedName("vod_content")
    private String j;

    @SerializedName("vod_play_from")
    private String k;

    @SerializedName("vod_play_url")
    private String l;

    @SerializedName("vod_tag")
    private String m;

    @SerializedName("action")
    private String n;

    @SerializedName("style")
    private a o;

    public static final class a {
    }

    public e() {
    }

    public e(String vodId, String vodName, String vodPic) {
        this(vodId, vodName, vodPic, null);
    }

    public e(String vodId, String vodName, String vodPic, String vodRemarks) {
        this.b = vodId;
        this.c = vodName;
        this.d = vodPic;
        this.e = vodRemarks;
    }

    public e(String vodId, String vodName, String vodPic, String vodRemarks, String typeName) {
        this(vodId, vodName, vodPic, vodRemarks);
        this.a = typeName;
    }

    public e(String vodId, String vodName, String vodPic, String vodRemarks, boolean ignored) {
        this(vodId, vodName, vodPic, vodRemarks);
    }

    public final String a() {
        return b;
    }

    public final String b() {
        return c;
    }

    public final String c() {
        return l;
    }

    public final void d(a style) {
        this.o = style;
    }

    public final void e(String typeName) {
        this.a = typeName;
    }

    public final void f(String vodActor) {
        this.h = vodActor;
    }

    public final String g() {
        return l;
    }

    public final void g(String vodArea) {
        this.g = vodArea;
    }

    public final void h(String vodContent) {
        this.j = vodContent;
    }

    public final void i(String vodDirector) {
        this.i = vodDirector;
    }

    public final void j(String vodId) {
        this.b = vodId;
    }

    public final void k(String vodName) {
        this.c = vodName;
    }

    public final void l(String vodPic) {
        this.d = vodPic;
    }

    public final void m(String vodPlayFrom) {
        this.k = vodPlayFrom;
    }

    public final void n(String vodPlayUrl) {
        this.l = vodPlayUrl;
    }

    public final void o(String vodRemarks) {
        this.e = vodRemarks;
    }

    public final void p(String vodTag) {
        this.m = vodTag;
    }

    public final void q(String vodYear) {
        this.f = vodYear;
    }
}
