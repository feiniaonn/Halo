/*
 * Decompiled with CFR 0.152.
 */
package android.util;

public final class Base64 {
    private Base64() {
    }

    public static byte[] decode(String string, int n) {
        return java.util.Base64.getDecoder().decode(string);
    }

    public static String encodeToString(byte[] byArray, int n) {
        return java.util.Base64.getEncoder().encodeToString(byArray);
    }
}

