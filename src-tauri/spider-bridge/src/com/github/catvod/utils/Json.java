package com.github.catvod.utils;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/**
 * JSON utility helpers for CatVod spiders.
 */
public class Json {

    private static final Gson gson = new Gson();

    public static JsonObject safeObject(String json) {
        try {
            return JsonParser.parseString(json).getAsJsonObject();
        } catch (Exception e) {
            return new JsonObject();
        }
    }

    public static JsonArray safeArray(String json) {
        try {
            return JsonParser.parseString(json).getAsJsonArray();
        } catch (Exception e) {
            return new JsonArray();
        }
    }

    public static JsonElement parse(String json) {
        try {
            return JsonParser.parseString(json);
        } catch (Exception e) {
            return new JsonObject();
        }
    }

    public static String toJson(Object obj) {
        return gson.toJson(obj);
    }

    public static <T> T decode(String json, Class<T> classOfT) {
        return gson.fromJson(json, classOfT);
    }

    public static boolean valid(String json) {
        try {
            JsonParser.parseString(json);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}