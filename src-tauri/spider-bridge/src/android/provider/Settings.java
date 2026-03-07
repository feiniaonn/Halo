package android.provider;

import android.content.ContentResolver;

public class Settings {
    public static class Secure {
        public static final String ANDROID_ID = "android_id";

        public static String getString(Object resolver, String name) {
            if (ANDROID_ID.equals(name)) {
                return "1234567890abcdef";
            }
            return "";
        }
    }
}
