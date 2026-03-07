/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.annotations.SerializedName
 */
package com.github.catvod.bean;

import com.google.gson.annotations.SerializedName;

public class Sub {
    @SerializedName(value="url")
    private String url;
    @SerializedName(value="name")
    private String name;
    @SerializedName(value="lang")
    private String lang;
    @SerializedName(value="format")
    private String format;

    public static Sub create() {
        return new Sub();
    }

    public Sub name(String string) {
        this.name = string;
        return this;
    }

    public Sub url(String string) {
        this.url = string;
        return this;
    }

    public Sub lang(String string) {
        this.lang = string;
        return this;
    }

    public Sub format(String string) {
        this.format = string;
        return this;
    }

    public Sub ext(String string) {
        switch (string) {
            case "vtt": {
                return this.format("text/vtt");
            }
            case "ass": 
            case "ssa": {
                return this.format("text/x-ssa");
            }
        }
        return this.format("application/x-subrip");
    }
}

