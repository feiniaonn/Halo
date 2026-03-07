/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.JsonElement
 *  com.google.gson.JsonObject
 *  com.google.gson.annotations.SerializedName
 */
package com.github.catvod.bean;

import com.github.catvod.utils.Json;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.annotations.SerializedName;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class Filter {
    @SerializedName(value="key")
    private String key;
    @SerializedName(value="name")
    private String name;
    @SerializedName(value="value")
    private List<Value> value;

    public Filter(String string, String string2, List<Value> list) {
        this.key = string;
        this.name = string2;
        this.value = list;
    }

    public static LinkedHashMap<String, List<Filter>> fromJson(String string) {
        LinkedHashMap<String, List<Filter>> linkedHashMap = new LinkedHashMap<String, List<Filter>>();
        JsonElement jsonElement = Json.parse(string);
        if (jsonElement == null) {
            return linkedHashMap;
        }
        JsonObject jsonObject = jsonElement.getAsJsonObject();
        for (Map.Entry entry : jsonObject.entrySet()) {
            ArrayList<Filter> arrayList = new ArrayList<Filter>();
            JsonElement jsonElement2 = jsonObject.get((String)entry.getKey());
            if (jsonElement2.isJsonObject()) {
                arrayList.add(Filter.fromJson(jsonElement2));
            } else {
                for (JsonElement jsonElement3 : jsonElement2.getAsJsonArray()) {
                    arrayList.add(Filter.fromJson(jsonElement3));
                }
            }
            linkedHashMap.put((String)entry.getKey(), arrayList);
        }
        return linkedHashMap;
    }

    private static Filter fromJson(JsonElement jsonElement) {
        return (Filter)Json.get().fromJson(jsonElement, Filter.class);
    }

    public static class Value {
        @SerializedName(value="n")
        private String n;
        @SerializedName(value="v")
        private String v;

        public Value(String string) {
            this.n = string;
            this.v = string;
        }

        public Value(String string, String string2) {
            this.n = string;
            this.v = string2;
        }
    }
}

