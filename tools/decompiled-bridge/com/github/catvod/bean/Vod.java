/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.Gson
 *  com.google.gson.annotations.SerializedName
 */
package com.github.catvod.bean;

import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;
import java.lang.invoke.CallSite;
import java.util.ArrayList;
import java.util.List;

public class Vod {
    @SerializedName(value="type_name")
    private String typeName;
    @SerializedName(value="vod_id")
    private String vodId;
    @SerializedName(value="vod_name")
    private String vodName;
    @SerializedName(value="vod_pic")
    private String vodPic;
    @SerializedName(value="vod_remarks")
    private String vodRemarks;
    @SerializedName(value="vod_year")
    private String vodYear;
    @SerializedName(value="vod_area")
    private String vodArea;
    @SerializedName(value="vod_actor")
    private String vodActor;
    @SerializedName(value="vod_director")
    private String vodDirector;
    @SerializedName(value="vod_content")
    private String vodContent;
    @SerializedName(value="vod_play_from")
    private String vodPlayFrom;
    @SerializedName(value="vod_play_url")
    private String vodPlayUrl;
    @SerializedName(value="vod_tag")
    private String vodTag;
    @SerializedName(value="style")
    private Style style;

    public static Vod objectFrom(String string) {
        Vod vod = (Vod)new Gson().fromJson(string, Vod.class);
        return vod == null ? new Vod() : vod;
    }

    public Vod() {
    }

    public Vod(String string, String string2, String string3) {
        this.setVodId(string);
        this.setVodName(string2);
        this.setVodPic(string3);
    }

    public Vod(String string, String string2, String string3, String string4) {
        this.setVodId(string);
        this.setVodName(string2);
        this.setVodPic(string3);
        this.setVodRemarks(string4);
    }

    public Vod(String string, String string2, String string3, String string4, Style style) {
        this.setVodId(string);
        this.setVodName(string2);
        this.setVodPic(string3);
        this.setVodRemarks(string4);
        this.setStyle(style);
    }

    public Vod(String string, String string2, String string3, String string4, boolean bl) {
        this.setVodId(string);
        this.setVodName(string2);
        this.setVodPic(string3);
        this.setVodRemarks(string4);
        this.setVodTag(bl ? "folder" : "file");
    }

    public void setTypeName(String string) {
        this.typeName = string;
    }

    public void setVodId(String string) {
        this.vodId = string;
    }

    public void setVodName(String string) {
        this.vodName = string;
    }

    public void setVodPic(String string) {
        this.vodPic = string;
    }

    public void setVodRemarks(String string) {
        this.vodRemarks = string;
    }

    public void setVodYear(String string) {
        this.vodYear = string;
    }

    public void setVodArea(String string) {
        this.vodArea = string;
    }

    public void setVodActor(String string) {
        this.vodActor = string;
    }

    public void setVodDirector(String string) {
        this.vodDirector = string;
    }

    public void setVodContent(String string) {
        this.vodContent = string;
    }

    public String getVodContent() {
        return this.vodContent;
    }

    public void setVodPlayFrom(String string) {
        this.vodPlayFrom = string;
    }

    public void setVodPlayUrl(String string) {
        this.vodPlayUrl = string;
    }

    public String getVodPlayUrl() {
        return this.vodPlayUrl;
    }

    public void setVodTag(String string) {
        this.vodTag = string;
    }

    public void setStyle(Style style) {
        this.style = style;
    }

    public static class Style {
        @SerializedName(value="type")
        private String type;
        @SerializedName(value="ratio")
        private Float ratio;

        public static Style rect() {
            return Style.rect(0.75f);
        }

        public static Style rect(float f) {
            return new Style("rect", Float.valueOf(f));
        }

        public static Style oval() {
            return new Style("oval", Float.valueOf(1.0f));
        }

        public static Style full() {
            return new Style("full");
        }

        public static Style list() {
            return new Style("list");
        }

        public Style(String string) {
            this.type = string;
        }

        public Style(String string, Float f) {
            this.type = string;
            this.ratio = f;
        }
    }

    public static class VodPlayBuilder {
        private List<String> vodPlayFrom = new ArrayList<String>();
        private List<String> vodPlayUrl = new ArrayList<String>();

        public VodPlayBuilder append(String string, List<PlayUrl> list) {
            this.vodPlayFrom.add(string);
            this.vodPlayUrl.add(this.toPlayUrlStr(list));
            return this;
        }

        public BuildResult build() {
            BuildResult buildResult = new BuildResult();
            buildResult.vodPlayFrom = String.join((CharSequence)"$$$", this.vodPlayFrom);
            buildResult.vodPlayUrl = String.join((CharSequence)"$$$", this.vodPlayUrl);
            return buildResult;
        }

        private String toPlayUrlStr(List<PlayUrl> list) {
            ArrayList<CallSite> arrayList = new ArrayList<CallSite>();
            for (PlayUrl playUrl : list) {
                arrayList.add((CallSite)((Object)(playUrl.name.replace("m3u8", "") + "$" + playUrl.url)));
            }
            return String.join((CharSequence)"#", arrayList);
        }

        public static class BuildResult {
            public String vodPlayFrom;
            public String vodPlayUrl;
        }

        public static class PlayUrl {
            public String flag;
            public String name;
            public String url;
        }
    }
}

