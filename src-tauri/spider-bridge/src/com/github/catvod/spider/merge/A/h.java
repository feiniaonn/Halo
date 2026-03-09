package com.github.catvod.spider.merge.A;

import java.util.HashMap;

/**
 * Desktop-safe replacement for legacy merge.A helpers.
 */
public final class h {
    private h() {
    }

    public static char a(int first, int second, int third, i ignored) {
        return (char) ((first ^ second ^ third) & 0xFFFF);
    }

    public static String b(Class<?> type, StringBuilder builder) {
        String prefix = type == null ? "" : type.getName();
        String suffix = builder == null ? "" : builder.toString();
        return prefix + suffix;
    }

    public static HashMap<String, String> c(String first, String second) {
        HashMap<String, String> headers = new HashMap<>();
        mergePairsInto(headers, first);
        mergePairsInto(headers, second);
        return headers;
    }

    private static void mergePairsInto(HashMap<String, String> output, String raw) {
        if (output == null || raw == null) {
            return;
        }

        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return;
        }

        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            String body = trimmed.substring(1, trimmed.length() - 1);
            for (String pair : body.split(",")) {
                addPair(output, pair);
            }
            return;
        }

        for (String pair : trimmed.split("[&\\n;]")) {
            addPair(output, pair);
        }
    }

    private static void addPair(HashMap<String, String> output, String pair) {
        if (pair == null) {
            return;
        }

        String trimmed = pair.trim();
        if (trimmed.isEmpty()) {
            return;
        }

        int separator = trimmed.indexOf('=');
        if (separator < 0) {
            separator = trimmed.indexOf(':');
        }
        if (separator <= 0) {
            return;
        }

        String key = normalizeToken(trimmed.substring(0, separator));
        String value = normalizeToken(trimmed.substring(separator + 1));
        if (!key.isEmpty()) {
            output.put(key, value);
        }
    }

    private static String normalizeToken(String token) {
        String trimmed = token == null ? "" : token.trim();
        if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length() >= 2) {
            return trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed;
    }
}
