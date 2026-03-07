package android.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;

/**
 * Minimal Application stub for desktop compatibility.
 */
public class Application extends android.content.ContextWrapper {
    public Application() {
        super(null);
    }

    public Context getApplicationContext() {
        return this;
    }

    @Override public String getPackageName() { return ""; }
    @Override public File getCacheDir() { return new File("./cache"); }
    @Override public File getFilesDir() { return new File("./files"); }
    @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) { return null; }
    @Override public File getExternalCacheDir() { return getCacheDir(); }
    @Override public File getExternalFilesDir(String type) { return getFilesDir(); }
    @Override public File getDir(String name, int mode) { return new File("./" + name); }
    @Override public Object getContentResolver() { return null; }
    @Override public Object getAssets() { return new android.content.res.AssetManager(); }
    @Override public Object getResources() { return new android.content.res.Resources(); }
    @Override public Object getPackageManager() { return new android.content.pm.PackageManager(); }
}
