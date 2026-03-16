package com.halo.spider;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import org.json.JSONArray;
import org.json.JSONObject;

final class AppQiCompat {
    private AppQiCompat() {
    }

    static Object recoverHomeContentIfNeeded(Object spider, Object result) {
        if (spider == null || !looksLikeAppQiSpider(spider) || !looksLikeEmptyHomePayload(result)) {
            return result;
        }

        try {
            String payload = buildHomeContentPayload(spider);
            if (!payload.isEmpty()) {
                System.err.println("DEBUG: AppQi homeContent recovered via bridge compat");
                return payload;
            }
        } catch (Throwable error) {
            System.err.println("DEBUG: AppQi compat recovery failed: " + error.getMessage());
        }

        return result;
    }

    private static boolean looksLikeAppQiSpider(Object spider) {
        String className = spider.getClass().getName();
        return className != null && className.toLowerCase().contains("appqi");
    }

    private static boolean looksLikeEmptyHomePayload(Object result) {
        if (!(result instanceof String)) {
            return result == null;
        }

        String payload = ((String) result).trim();
        if (payload.isEmpty()) {
            return true;
        }
        if (!payload.startsWith("{")) {
            return false;
        }

        try {
            JSONObject object = new JSONObject(payload);
            JSONArray classItems = object.optJSONArray("class");
            JSONArray listItems = object.optJSONArray("list");
            JSONObject filters = object.optJSONObject("filters");
            return (classItems == null || classItems.length() == 0)
                    && (listItems == null || listItems.length() == 0)
                    && (filters == null || filters.length() == 0);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String buildHomeContentPayload(Object spider) throws Exception {
        Method requestMethod = spider.getClass().getDeclaredMethod("a", String.class, String.class);
        requestMethod.setAccessible(true);
        String initMethod = readStringField(spider, "h", "initV120");
        String path = "/qijiappapi.index/" + initMethod;
        Object rawPayload = requestMethod.invoke(spider, path, "{}");
        String payload = rawPayload == null ? "" : String.valueOf(rawPayload).trim();
        if (payload.isEmpty()) {
            return "";
        }

        JSONObject root = new JSONObject(payload);
        JSONArray classItems = new JSONArray();
        JSONObject filters = new JSONObject();

        JSONArray typeList = root.optJSONArray("type_list");
        if (typeList != null) {
            for (int index = 0; index < typeList.length(); index += 1) {
                JSONObject item = typeList.optJSONObject(index);
                if (item == null) {
                    continue;
                }

                String typeId = jsonValueAsString(item.opt("type_id"));
                String typeName = jsonValueAsString(item.opt("type_name"));
                if (typeId.isEmpty() && typeName.isEmpty()) {
                    continue;
                }

                if (typeId.isEmpty()) {
                    typeId = typeName;
                }
                if (typeName.isEmpty()) {
                    typeName = typeId;
                }

                classItems.put(new JSONObject()
                        .put("type_id", typeId)
                        .put("type_name", typeName));

                JSONArray filterItems = buildFilterItems(item.optJSONArray("filter_type_list"));
                if (filterItems.length() > 0) {
                    filters.put(typeId, filterItems);
                }
            }
        }

        JSONObject normalized = new JSONObject();
        normalized.put("class", classItems);
        normalized.put("filters", filters);
        normalized.put("list", buildRecommendItems(root.optJSONArray("recommend_list")));
        return normalized.toString();
    }

    private static JSONArray buildFilterItems(JSONArray source) {
        JSONArray result = new JSONArray();
        if (source == null) {
            return result;
        }

        for (int index = 0; index < source.length(); index += 1) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) {
                continue;
            }

            String key = jsonValueAsString(item.opt("name"));
            if (!"class".equals(key) && !"area".equals(key) && !"lang".equals(key)
                    && !"year".equals(key) && !"sort".equals(key)) {
                continue;
            }

            JSONArray values = item.optJSONArray("list");
            if (values == null || values.length() == 0) {
                continue;
            }

            JSONArray normalizedValues = new JSONArray();
            for (int valueIndex = 0; valueIndex < values.length(); valueIndex += 1) {
                String value = jsonValueAsString(values.opt(valueIndex));
                if (value.isEmpty()) {
                    continue;
                }
                normalizedValues.put(new JSONObject()
                        .put("name", value)
                        .put("value", value));
            }

            if (normalizedValues.length() > 0) {
                result.put(new JSONObject()
                        .put("key", key)
                        .put("name", key)
                        .put("value", normalizedValues));
            }
        }

        return result;
    }

    private static JSONArray buildRecommendItems(JSONArray source) {
        JSONArray result = new JSONArray();
        if (source == null) {
            return result;
        }

        for (int index = 0; index < source.length(); index += 1) {
            JSONObject item = source.optJSONObject(index);
            if (item == null) {
                continue;
            }

            String vodId = pickString(item,
                    "vod_id", "vodId", "id", "ids", "sid", "nextlink", "url");
            String vodName = pickString(item,
                    "vod_name", "vodName", "name", "title", "vod_title", "vodTitle");
            if (vodId.isEmpty() && vodName.isEmpty()) {
                continue;
            }

            if (vodId.isEmpty()) {
                vodId = vodName;
            }
            if (vodName.isEmpty()) {
                vodName = vodId;
            }

            JSONObject normalized = new JSONObject()
                    .put("vod_id", vodId)
                    .put("vod_name", vodName)
                    .put("vod_pic", pickString(item,
                            "vod_pic", "vodPic", "pic", "img", "image", "cover", "thumb", "poster"))
                    .put("vod_remarks", pickString(item,
                            "vod_remarks", "vodRemarks", "remarks", "remark", "note",
                            "vod_note", "vodNote", "conerMemo", "detailMemo", "shorthand"));
            result.put(normalized);
        }

        return result;
    }

    private static String pickString(JSONObject item, String... keys) {
        for (String key : keys) {
            String value = jsonValueAsString(item.opt(key));
            if (!value.isEmpty()) {
                return value;
            }
        }
        return "";
    }

    private static String readStringField(Object spider, String fieldName, String fallback) {
        try {
            Field field = spider.getClass().getDeclaredField(fieldName);
            field.setAccessible(true);
            Object value = field.get(spider);
            String current = jsonValueAsString(value);
            return current.isEmpty() ? fallback : current;
        } catch (Throwable ignored) {
            return fallback;
        }
    }

    private static String jsonValueAsString(Object value) {
        if (value == null || JSONObject.NULL.equals(value)) {
            return "";
        }
        if (value instanceof String) {
            return ((String) value).trim();
        }
        if (value instanceof Number || value instanceof Boolean) {
            return String.valueOf(value);
        }
        return String.valueOf(value).trim();
    }
}
