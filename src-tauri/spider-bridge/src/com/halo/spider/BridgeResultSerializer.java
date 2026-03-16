package com.halo.spider;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;

final class BridgeResultSerializer {
    private BridgeResultSerializer() {
    }

    static String serialize(Object result) {
        if (!(result instanceof Object[])) {
            return result == null ? "" : String.valueOf(result);
        }

        Object[] values = (Object[]) result;
        if (values.length < 3) {
            return result == null ? "" : String.valueOf(result);
        }

        int status = asInt(values[0], 200);
        String mime = asString(values[1], "application/octet-stream");
        String bodyBase64 = readBody(values[2]);
        Map<?, ?> headers = values.length > 3 && values[3] instanceof Map ? (Map<?, ?>) values[3] : null;

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"__haloProxy\":true,");
        sb.append("\"status\":").append(status).append(",");
        sb.append("\"mime\":\"").append(escapeJson(mime)).append("\",");
        sb.append("\"bodyBase64\":\"").append(escapeJson(bodyBase64)).append("\",");
        sb.append("\"headers\":").append(serializeHeaders(headers));
        sb.append("}");
        return sb.toString();
    }

    private static int asInt(Object value, int fallback) {
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static String asString(Object value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? fallback : text;
    }

    private static String readBody(Object value) {
        if (value == null) {
            return "";
        }
        byte[] bytes;
        try {
            if (value instanceof byte[]) {
                bytes = (byte[]) value;
            } else if (value instanceof InputStream) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                InputStream stream = (InputStream) value;
                byte[] chunk = new byte[8192];
                int read;
                while ((read = stream.read(chunk)) != -1) {
                    buffer.write(chunk, 0, read);
                }
                bytes = buffer.toByteArray();
            } else {
                bytes = String.valueOf(value).getBytes(StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
            bytes = String.valueOf(value).getBytes(StandardCharsets.UTF_8);
        }
        return Base64.getEncoder().encodeToString(bytes);
    }

    private static String serializeHeaders(Map<?, ?> headers) {
        if (headers == null || headers.isEmpty()) {
            return "{}";
        }

        StringBuilder sb = new StringBuilder();
        sb.append("{");
        boolean first = true;
        for (Map.Entry<?, ?> entry : headers.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            if (!first) {
                sb.append(",");
            }
            first = false;
            sb.append("\"").append(escapeJson(String.valueOf(entry.getKey()))).append("\":");
            sb.append("\"").append(escapeJson(String.valueOf(entry.getValue()))).append("\"");
        }
        sb.append("}");
        return sb.toString();
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        return value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r");
    }
}
