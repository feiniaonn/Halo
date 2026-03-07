/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.Gson
 *  com.google.gson.JsonElement
 *  com.google.gson.annotations.SerializedName
 *  com.google.gson.reflect.TypeToken
 *  org.json.JSONObject
 */
package com.github.catvod.bean;

import com.github.catvod.bean.Class;
import com.github.catvod.bean.Filter;
import com.github.catvod.bean.Sub;
import com.github.catvod.bean.Vod;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

public class Result {
    @SerializedName(value="class")
    private List<Class> classes;
    @SerializedName(value="list")
    private List<Vod> list;
    @SerializedName(value="filters")
    private LinkedHashMap<String, List<Filter>> filters;
    @SerializedName(value="header")
    private String header;
    @SerializedName(value="format")
    private String format;
    @SerializedName(value="msg")
    private String msg;
    @SerializedName(value="danmaku")
    private String danmaku;
    @SerializedName(value="url")
    private Object url;
    @SerializedName(value="subs")
    private List<Sub> subs;
    @SerializedName(value="parse")
    private int parse;
    @SerializedName(value="jx")
    private int jx;
    @SerializedName(value="page")
    private Integer page;
    @SerializedName(value="pagecount")
    private Integer pagecount;
    @SerializedName(value="limit")
    private Integer limit;
    @SerializedName(value="total")
    private Integer total;

    public static Result objectFrom(String string) {
        return (Result)new Gson().fromJson(string, Result.class);
    }

    public static String string(Integer n, Integer n2, Integer n3, Integer n4, List<Vod> list) {
        return Result.get().page(n, n2, n3, n4).vod(list).string();
    }

    public static String string(List<Class> list, List<Vod> list2, LinkedHashMap<String, List<Filter>> linkedHashMap) {
        return Result.get().classes(list).vod(list2).filters(linkedHashMap).string();
    }

    public static String string(List<Class> list, List<Vod> list2, JSONObject jSONObject) {
        return Result.get().classes(list).vod(list2).filters(jSONObject).string();
    }

    public static String string(List<Class> list, List<Vod> list2, JsonElement jsonElement) {
        return Result.get().classes(list).vod(list2).filters(jsonElement).string();
    }

    public static String string(List<Class> list, LinkedHashMap<String, List<Filter>> linkedHashMap) {
        return Result.get().classes(list).filters(linkedHashMap).string();
    }

    public static String string(List<Class> list, JsonElement jsonElement) {
        return Result.get().classes(list).filters(jsonElement).string();
    }

    public static String string(List<Class> list, JSONObject jSONObject) {
        return Result.get().classes(list).filters(jSONObject).string();
    }

    public static String string(List<Class> list, List<Vod> list2) {
        return Result.get().classes(list).vod(list2).string();
    }

    public static String string(List<Vod> list) {
        return Result.get().vod(list).string();
    }

    public static String string(Vod vod) {
        return Result.get().vod(vod).string();
    }

    public static Result get() {
        return new Result();
    }

    public static String error(String string) {
        return Result.get().vod(Collections.emptyList()).msg(string).string();
    }

    public Result msg(String string) {
        this.msg = string;
        return this;
    }

    public Result classes(List<Class> list) {
        this.classes = list;
        return this;
    }

    public Result vod(List<Vod> list) {
        this.list = list;
        return this;
    }

    public Result vod(Vod vod) {
        this.list = Collections.singletonList(vod);
        return this;
    }

    public Result filters(LinkedHashMap<String, List<Filter>> linkedHashMap) {
        this.filters = linkedHashMap;
        return this;
    }

    public Result filters(JSONObject jSONObject) {
        if (jSONObject == null) {
            return this;
        }
        Type type = new TypeToken<LinkedHashMap<String, List<Filter>>>(this){}.getType();
        this.filters = (LinkedHashMap)new Gson().fromJson(jSONObject.toString(), type);
        return this;
    }

    public Result filters(JsonElement jsonElement) {
        if (jsonElement == null) {
            return this;
        }
        Type type = new TypeToken<LinkedHashMap<String, List<Filter>>>(this){}.getType();
        this.filters = (LinkedHashMap)new Gson().fromJson(jsonElement.toString(), type);
        return this;
    }

    public Result header(Map<String, String> map) {
        if (map.isEmpty()) {
            return this;
        }
        this.header = new Gson().toJson(map);
        return this;
    }

    public Result parse() {
        this.parse = 1;
        return this;
    }

    public Result parse(int n) {
        this.parse = n;
        return this;
    }

    public Result jx() {
        this.jx = 1;
        return this;
    }

    public Result url(String string) {
        this.url = string;
        return this;
    }

    public Result url(List<String> list) {
        this.url = list;
        return this;
    }

    public Result danmaku(String string) {
        this.danmaku = string;
        return this;
    }

    public Result format(String string) {
        this.format = string;
        return this;
    }

    public Result subs(List<Sub> list) {
        this.subs = list;
        return this;
    }

    public Result dash() {
        this.format = "application/dash+xml";
        return this;
    }

    public Result m3u8() {
        this.format = "application/x-mpegURL";
        return this;
    }

    public Result rtsp() {
        this.format = "application/x-rtsp";
        return this;
    }

    public Result octet() {
        this.format = "application/octet-stream";
        return this;
    }

    public Result page() {
        return this.page(1, 1, 0, 1);
    }

    public Result page(int n, int n2, int n3, int n4) {
        this.page = n > 0 ? n : Integer.MAX_VALUE;
        this.limit = n3 > 0 ? n3 : Integer.MAX_VALUE;
        this.total = n4 > 0 ? n4 : Integer.MAX_VALUE;
        this.pagecount = n2 > 0 ? n2 : Integer.MAX_VALUE;
        return this;
    }

    public List<Vod> getList() {
        return this.list == null ? Collections.emptyList() : this.list;
    }

    public Object getUrl() {
        return this.url;
    }

    public String string() {
        return this.toString();
    }

    public List<Class> getClasses() {
        return this.classes;
    }

    public String toString() {
        String string = new Gson().newBuilder().disableHtmlEscaping().create().toJson((Object)this);
        System.err.println("DEBUG: Result.toString() generated: [" + string + "]");
        return string;
    }

    public static class UrlBuilder {
        private List<String> urlList = new ArrayList<String>();

        public UrlBuilder add(String string, String string2) {
            this.urlList.add(string);
            this.urlList.add(string2);
            return this;
        }

        public List<String> build() {
            return this.urlList;
        }
    }
}

