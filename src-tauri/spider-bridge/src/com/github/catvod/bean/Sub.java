package com.github.catvod.bean;

import com.google.gson.annotations.SerializedName;

public class Sub {
    @SerializedName("url")
    private String url;
    @SerializedName("name")
    private String name;
    @SerializedName("lang")
    private String lang;
    @SerializedName("format")
    private String format;

    public static Sub create() { return new Sub(); }

    public Sub url(String url) { this.url = url; return this; }
    public Sub name(String name) { this.name = name; return this; }
    public Sub lang(String lang) { this.lang = lang; return this; }
    public Sub format(String format) { this.format = format; return this; }
}