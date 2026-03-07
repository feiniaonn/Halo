package android.content;

import java.io.File;
import android.content.SharedPreferences;

public class ContextWrapper extends Context {
    protected Context mBase;

    public ContextWrapper(Context base) {
        mBase = base;
    }

    @Override public String getPackageName() { return mBase.getPackageName(); }
    @Override public File getCacheDir() { return mBase.getCacheDir(); }
    @Override public File getFilesDir() { return mBase.getFilesDir(); }
    @Override public SharedPreferences getSharedPreferences(String name, int mode) { return mBase.getSharedPreferences(name, mode); }
    @Override public File getExternalCacheDir() { return mBase.getExternalCacheDir(); }
    @Override public File getExternalFilesDir(String type) { return mBase.getExternalFilesDir(type); }
    @Override public File getDir(String name, int mode) { return mBase.getDir(name, mode); }
    @Override public Object getContentResolver() { return mBase.getContentResolver(); }
    @Override public Object getAssets() { return mBase.getAssets(); }
    @Override public Object getResources() { return mBase.getResources(); }
    @Override public Object getPackageManager() { return mBase.getPackageManager(); }
}
