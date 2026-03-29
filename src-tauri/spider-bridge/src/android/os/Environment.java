package android.os;

import java.io.File;

public final class Environment {
    public static final String MEDIA_MOUNTED = "mounted";
    public static final String DIRECTORY_DOWNLOADS = "Download";
    public static final String DIRECTORY_MOVIES = "Movies";
    public static final String DIRECTORY_PICTURES = "Pictures";

    private Environment() {
    }

    public static File getExternalStorageDirectory() {
        return desktopHome();
    }

    public static File getExternalStoragePublicDirectory(String type) {
        if (type == null || type.trim().isEmpty()) {
            return desktopHome();
        }
        return new File(desktopHome(), type);
    }

    public static File getDownloadCacheDirectory() {
        return new File(desktopHome(), "cache");
    }

    public static String getExternalStorageState() {
        return MEDIA_MOUNTED;
    }

    private static File desktopHome() {
        return new File(System.getProperty("user.home", "."));
    }
}
