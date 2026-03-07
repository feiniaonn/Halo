/*
 * Decompiled with CFR 0.152.
 */
package android.text;

public final class TextUtils {
    private TextUtils() {
    }

    public static boolean isEmpty(CharSequence charSequence) {
        return charSequence == null || charSequence.length() == 0;
    }

    public static String join(CharSequence charSequence, Iterable<?> iterable) {
        StringBuilder stringBuilder = new StringBuilder();
        boolean bl = true;
        for (Object obj : iterable) {
            if (bl) {
                bl = false;
            } else {
                stringBuilder.append(charSequence);
            }
            stringBuilder.append(obj);
        }
        return stringBuilder.toString();
    }

    public static String join(CharSequence charSequence, Object[] objectArray) {
        StringBuilder stringBuilder = new StringBuilder();
        boolean bl = true;
        for (Object object : objectArray) {
            if (bl) {
                bl = false;
            } else {
                stringBuilder.append(charSequence);
            }
            stringBuilder.append(object);
        }
        return stringBuilder.toString();
    }
}

