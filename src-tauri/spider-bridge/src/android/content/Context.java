package android.content;

import java.io.File;

/**
 * Minimal Context stub for desktop compatibility.
 */
public abstract class Context {
    public abstract String getPackageName();
    public abstract File getCacheDir();
    public abstract File getFilesDir();
    public abstract SharedPreferences getSharedPreferences(String name, int mode);
    public abstract File getExternalCacheDir();
    public abstract File getExternalFilesDir(String type);
    public abstract File getDir(String name, int mode);
    public abstract Object getContentResolver();
    public abstract Object getAssets();
    public abstract Object getResources();
    public abstract Object getPackageManager();
}
