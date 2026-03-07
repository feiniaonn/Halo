package com.github.catvod.crawler;

public class SpiderDebug {
    public static void log(Object obj) {
        System.err.println("SPIDER_DEBUG: " + obj);
    }

    public static void log(String str) {
        System.err.println("SPIDER_DEBUG: " + str);
    }

    public static void log(Throwable th) {
        System.err.println("SPIDER_DEBUG_ERROR:");
        th.printStackTrace(System.err);
    }
}
