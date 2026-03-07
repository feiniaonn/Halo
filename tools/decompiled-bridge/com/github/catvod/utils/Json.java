/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.Gson
 *  com.google.gson.GsonBuilder
 *  com.google.gson.JsonElement
 *  com.google.gson.JsonObject
 *  com.google.gson.JsonParser
 *  com.google.gson.JsonSyntaxException
 *  com.google.gson.stream.JsonReader
 */
package com.github.catvod.utils;

import com.github.catvod.crawler.SpiderDebug;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonSyntaxException;
import com.google.gson.stream.JsonReader;
import java.io.Reader;
import java.io.StringReader;
import java.lang.reflect.Type;

public class Json {
    private static Gson gson = new GsonBuilder().setLenient().create();

    public static Gson get() {
        return gson;
    }

    public static JsonElement parse(String string) {
        try {
            JsonReader jsonReader = new JsonReader((Reader)new StringReader(string));
            jsonReader.setLenient(true);
            return JsonParser.parseReader((JsonReader)jsonReader);
        }
        catch (Throwable throwable) {
            return new JsonParser().parse(string);
        }
    }

    public static <T> T parseSafe(String string, Type type) {
        try {
            return (T)gson.fromJson(string, type);
        }
        catch (JsonSyntaxException jsonSyntaxException) {
            SpiderDebug.log("json parse error: " + jsonSyntaxException.getMessage() + "\n " + string);
            return null;
        }
    }

    public static String toJson(Object object) {
        return gson.toJson(object);
    }

    public static JsonObject safeObject(String string) {
        try {
            return JsonParser.parseString((String)string).getAsJsonObject();
        }
        catch (JsonSyntaxException jsonSyntaxException) {
            return new JsonObject();
        }
    }
}

