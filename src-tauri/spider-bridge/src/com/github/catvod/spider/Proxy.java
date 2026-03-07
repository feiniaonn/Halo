package com.github.catvod.spider;

/**
 * Stub Proxy class for desktop compatibility.
 * Provides host/port info for local proxy server.
 */
public class Proxy {
    private static String hostPort = "http://127.0.0.1:9966";

    public static String getHostPort() {
        return hostPort;
    }

    public static void setHostPort(String hp) {
        hostPort = hp;
    }

    public static Object[] proxy(java.util.Map<String, String> params) throws Exception {
        return null;
    }
}
