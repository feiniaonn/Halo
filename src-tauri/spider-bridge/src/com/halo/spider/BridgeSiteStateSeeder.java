package com.halo.spider;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

final class BridgeSiteStateSeeder {
    private BridgeSiteStateSeeder() {
    }

    static void seedDefaults(Object spider, String classHint, String ext) {
        if (spider == null || classHint == null) {
            return;
        }

        String normalized = classHint.trim().toLowerCase();
        if (!normalized.contains("xbpq")) {
            seedAppFamilyDefaults(spider, normalized);
            return;
        }

        seedStringFieldIfNull(spider, "c", "DEBUG: Seeded XBPQ default category cache via field c");
        seedStringFieldIfNull(spider, "w", "DEBUG: Seeded XBPQ default request suffix via field w");
        seedStringFieldIfNull(spider, "z", "DEBUG: Seeded XBPQ default cookie/cache token via field z");
        seedJsonFieldIfNull(
                spider,
                "B",
                ext,
                "DEBUG: Seeded XBPQ inline rule-config via field B");
        seedAppFamilyDefaults(spider, normalized);
    }

    private static void seedAppFamilyDefaults(Object spider, String normalized) {
        if (normalized == null || normalized.isEmpty()) {
            return;
        }

        if (normalized.contains("app3q")) {
            seedRandomFieldIfNull(spider, "d", "DEBUG: Seeded app-family Random via field d");
            seedStringFieldIfNull(
                    spider,
                    "a",
                    "https://qqqys.com",
                    "DEBUG: Seeded App3Q default base url via field a");
            seedStringFieldIfNull(
                    spider,
                    "b",
                    String.valueOf(System.currentTimeMillis() / 1000L),
                    "DEBUG: Seeded App3Q default timestamp via field b");
            seedStringFieldIfNull(
                    spider,
                    "c",
                    String.valueOf(new java.util.Random().nextInt(999) + 1),
                    "DEBUG: Seeded App3Q default nonce via field c");
        }

        if (normalized.contains("appjg")) {
            seedMapFieldIfNull(
                    spider,
                    "b",
                    "DEBUG: Seeded AppJg parse-url cache via field b");
            seedMapFieldIfNull(
                    spider,
                    "c",
                    "DEBUG: Seeded AppJg category cache via field c");
        }
    }

    private static void seedStringFieldIfNull(Object spider, String fieldName, String logMessage) {
        seedStringFieldIfNull(spider, fieldName, "", logMessage);
    }

    private static void seedStringFieldIfNull(
            Object spider,
            String fieldName,
            String value,
            String logMessage) {
        try {
            Field field = spider.getClass().getDeclaredField(fieldName);
            if (field.getType() != String.class) {
                return;
            }
            field.setAccessible(true);
            if (field.get(spider) == null) {
                field.set(spider, value == null ? "" : value);
                System.err.println(logMessage);
            }
        } catch (Throwable ignored) {
        }
    }

    private static void seedRandomFieldIfNull(Object spider, String fieldName, String logMessage) {
        try {
            Field field = spider.getClass().getDeclaredField(fieldName);
            if (!java.util.Random.class.isAssignableFrom(field.getType())) {
                return;
            }
            field.setAccessible(true);
            Object target = java.lang.reflect.Modifier.isStatic(field.getModifiers()) ? null : spider;
            if (field.get(target) == null) {
                if (setFieldValue(field, target, new java.util.Random())) {
                    System.err.println(logMessage);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static void seedMapFieldIfNull(Object spider, String fieldName, String logMessage) {
        try {
            Field field = spider.getClass().getDeclaredField(fieldName);
            if (!java.util.Map.class.isAssignableFrom(field.getType())) {
                return;
            }
            field.setAccessible(true);
            Object target = java.lang.reflect.Modifier.isStatic(field.getModifiers()) ? null : spider;
            if (field.get(target) == null) {
                if (setFieldValue(field, target, new java.util.HashMap<>())) {
                    System.err.println(logMessage);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private static void seedJsonFieldIfNull(
            Object spider,
            String fieldName,
            String rawJson,
            String logMessage) {
        String trimmed = rawJson == null ? "" : rawJson.trim();
        if (!trimmed.startsWith("{")) {
            return;
        }

        try {
            Field field = spider.getClass().getDeclaredField(fieldName);
            field.setAccessible(true);
            if (field.get(spider) != null) {
                return;
            }

            Class<?> fieldType = field.getType();
            if (!"org.json.JSONObject".equals(fieldType.getName())) {
                return;
            }

            Constructor<?> constructor = fieldType.getDeclaredConstructor(String.class);
            constructor.setAccessible(true);
            Object jsonObject = constructor.newInstance(trimmed);
            field.set(spider, jsonObject);
            System.err.println(logMessage);
        } catch (Throwable ignored) {
        }
    }

    private static boolean setFieldValue(Field field, Object target, Object value) {
        try {
            field.set(target, value);
            return true;
        } catch (Throwable ignored) {
        }

        try {
            Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
            Field unsafeField = unsafeClass.getDeclaredField("theUnsafe");
            unsafeField.setAccessible(true);
            Object unsafe = unsafeField.get(null);
            Method putObject = unsafeClass.getMethod("putObject", Object.class, long.class, Object.class);

            if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) {
                Method staticFieldBase = unsafeClass.getMethod("staticFieldBase", Field.class);
                Method staticFieldOffset = unsafeClass.getMethod("staticFieldOffset", Field.class);
                Object base = staticFieldBase.invoke(unsafe, field);
                long offset = ((Number) staticFieldOffset.invoke(unsafe, field)).longValue();
                putObject.invoke(unsafe, base, offset, value);
            } else {
                Method objectFieldOffset = unsafeClass.getMethod("objectFieldOffset", Field.class);
                long offset = ((Number) objectFieldOffset.invoke(unsafe, field)).longValue();
                putObject.invoke(unsafe, target, offset, value);
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
