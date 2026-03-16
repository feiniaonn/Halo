package com.github.catvod.spider;

import java.net.URI;
import java.util.Map;

/**
 * Desktop-compatible proxy runtime.
 * Reads the local bridge service endpoint from environment or system property.
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

    public static String getHostPort() {
        hostPort = resolveHostPort();
        return hostPort;
    }

    public static String hostPort() {
        return getHostPort();
    }

    public static String getAddress() {
        return getHostPort();
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
        return getHostPort() + "/proxy";
    }

    public static void setHostPort(String hp) {
        if (hp != null && !hp.trim().isEmpty()) {
            hostPort = trimTrailingSlash(hp.trim());
        }
    }

    public static void set(int port) {
        if (port > 0) {
            hostPort = "http://127.0.0.1:" + port;
        }
    }

    public static Object[] proxy(Map<String, String> params) throws Exception {
        return null;
    }
}
