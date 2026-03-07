package com.github.catvod.bean;

import com.google.gson.annotations.SerializedName;

public class Filter {
    @SerializedName("key")
    private String key;
    @SerializedName("name")
    private String name;
    @SerializedName("value")
    private java.util.List<Value> value;

    public Filter(String key, String name, java.util.List<Value> value) {
        this.key = key;
        this.name = name;
        this.value = value;
    }

    public static class Value {
        @SerializedName("n")
        private String n;
        @SerializedName("v")
        private String v;

        public Value(String n, String v) {
            this.n = n;
            this.v = v;
        }
    }
}