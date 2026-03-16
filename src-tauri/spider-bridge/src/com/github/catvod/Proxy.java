package com.github.catvod;

import java.net.URI;

/**
 * Android-compatible CatVod proxy helper used by QuickJS/Python-style runtimes.
 */
public class Proxy {
    private static volatile String hostPort = resolveHostPort();

    private static String resolveHostPort() {
        String env = System.getenv("HALO_PROXY_BASE_URL");
        if (env != null && !env.trim().isEmpty()) {
            return trimTrailingSlash(env.trim());
        }

        String property = System.getProperty("halo.proxy.baseUrl");
        if (property != null && !property.trim().isEmpty()) {
            return trimTrailingSlash(property.trim());
        }

        return "http://127.0.0.1:9966";
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isEmpty()) {
            return "http://127.0.0.1:9966";
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    public static int getPort() {
        try {
            URI uri = URI.create(getHostPort());
            if (uri.getPort() > 0) {
                return uri.getPort();
            }
        } catch (Throwable ignored) {
        }
        return 9966;
    }

    public static String getUrl(boolean local) {
        String base = getHostPort();
        if (local) {
            return "http://127.0.0.1:" + getPort() + "/proxy";
        }
        return base + "/proxy";
    }

    public static void set(int port) {
        if (port > 0) {
            hostPort = "http://127.0.0.1:" + port;
        }
    }

    public static String getHostPort() {
        hostPort = resolveHostPort();
        return hostPort;
    }

    public static void setHostPort(String baseUrl) {
        if (baseUrl != null && !baseUrl.trim().isEmpty()) {
            hostPort = trimTrailingSlash(baseUrl.trim());
        }
    }
}
