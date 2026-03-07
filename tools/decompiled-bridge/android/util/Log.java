/*
 * Decompiled with CFR 0.152.
 */
package android.util;

public final class Log {
    private Log() {
    }

    public static int d(String string, String string2) {
        System.out.println(string + ": " + string2);
        return 0;
    }

    public static int i(String string, String string2) {
        System.out.println(string + ": " + string2);
        return 0;
    }

    public static int w(String string, String string2) {
        System.err.println(string + ": " + string2);
        return 0;
    }

    public static int e(String string, String string2) {
        System.err.println(string + ": " + string2);
        return 0;
    }
}

