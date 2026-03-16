package com.halo.spider;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.HashMap;
import org.json.JSONArray;
import org.json.JSONObject;

final class YgpCompat {
    private static final String DEFAULT_TYPE_ID = "movlist/";
    private static final String DEFAULT_TYPE_NAME = "\u9884\u544a";

    private YgpCompat() {
    }

    static Object recoverHomeContentIfNeeded(Object spider, Object result) {
        if (spider == null || !looksLikeYgpSpider(spider) || !looksLikeBrokenHomePayload(result)) {
            return result;
        }

        try {
            String payload = buildHomeContentPayload(spider, result);
            if (!payload.isEmpty()) {
                System.err.println("DEBUG: YGP homeContent recovered via bridge compat");
                return payload;
            }
        } catch (Throwable error) {
            System.err.println("DEBUG: YGP compat recovery failed: " + error.getMessage());
        }

        return result;
    }

    private static boolean looksLikeYgpSpider(Object spider) {
        String className = spider.getClass().getName();
        return className != null && className.toLowerCase().endsWith(".ygp");
    }

    private static boolean looksLikeBrokenHomePayload(Object result) {
        if (!(result instanceof String)) {
            return result == null;
        }

        String payload = ((String) result).trim();
        if (payload.isEmpty() || "[]".equals(payload)) {
            return true;
        }
        if (!payload.startsWith("{")) {
            return false;
        }

        try {
            JSONObject object = new JSONObject(payload);
            JSONArray listItems = object.optJSONArray("list");
            return listItems == null || listItems.length() == 0;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String buildHomeContentPayload(Object spider, Object existingResult) throws Exception {
        Method categoryMethod = findCategoryMethod(spider);
        if (categoryMethod == null) {
            return "";
        }

        categoryMethod.setAccessible(true);
        Object rawCategoryPayload = categoryMethod.invoke(
                spider,
                DEFAULT_TYPE_ID,
                "1",
                Boolean.FALSE,
                new HashMap<String, String>());
        String categoryPayload = rawCategoryPayload == null ? "" : String.valueOf(rawCategoryPayload).trim();
        if (categoryPayload.isEmpty() || !categoryPayload.startsWith("{")) {
            return "";
        }

        JSONObject categoryRoot = new JSONObject(categoryPayload);
        JSONArray listItems = categoryRoot.optJSONArray("list");
        if (listItems == null || listItems.length() == 0) {
            return "";
        }

        JSONObject root = new JSONObject();
        root.put("class", buildHomeClasses(existingResult));

        JSONObject filters = readFilters(spider);
        if (filters != null && filters.length() > 0) {
            root.put("filters", filters);
        }

        root.put("list", listItems);
        return root.toString();
    }

    private static Method findCategoryMethod(Object spider) {
        for (Method method : spider.getClass().getMethods()) {
            if (!"categoryContent".equals(method.getName()) || method.getParameterCount() != 4) {
                continue;
            }
            return method;
        }
        return null;
    }

    private static JSONArray buildHomeClasses(Object existingResult) {
        JSONArray classes = extractClassesFromExistingResult(existingResult);
        if (classes != null && classes.length() > 0) {
            return classes;
        }

        JSONArray fallback = new JSONArray();
        fallback.put(new JSONObject()
                .put("type_id", DEFAULT_TYPE_ID)
                .put("type_name", DEFAULT_TYPE_NAME));
        return fallback;
    }

    private static JSONArray extractClassesFromExistingResult(Object existingResult) {
        if (!(existingResult instanceof String)) {
            return null;
        }

        String payload = ((String) existingResult).trim();
        if (!payload.startsWith("{")) {
            return null;
        }

        try {
            JSONObject object = new JSONObject(payload);
            JSONArray classes = object.optJSONArray("class");
            return classes == null ? null : new JSONArray(classes.toString());
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static JSONObject readFilters(Object spider) {
        try {
            Field field = spider.getClass().getDeclaredField("a");
            field.setAccessible(true);
            Object value = field.get(spider);
            if (value instanceof JSONObject) {
                return new JSONObject(((JSONObject) value).toString());
            }
        } catch (Throwable ignored) {
        }
        return null;
    }
}
