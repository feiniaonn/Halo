/*
 * Decompiled with CFR 0.152.
 */
package com.github.catvod.crawler;

public class SpiderDebug {
    public static void log(Object object) {
        System.err.println("SPIDER_DEBUG: " + String.valueOf(object));
    }

    public static void log(String string) {
        System.err.println("SPIDER_DEBUG: " + string);
    }

    public static void log(Throwable throwable) {
        System.err.println("SPIDER_DEBUG_ERROR:");
        throwable.printStackTrace(System.err);
    }
}

