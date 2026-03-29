package android.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.halo.spider.mock.MockSharedPreferences;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * Minimal Application stub for desktop compatibility.
 */
public class Application extends android.content.Context {
    private static final String DEFAULT_PACKAGE_NAME = "com.tauri-app.halo";
    private final File baseDir;
    private final Map<String, SharedPreferences> prefsMap = new HashMap<>();

    public Application() {
        File userHome = new File(System.getProperty("user.home", "."));
        this.baseDir = new File(new File(userHome, ".halo"), "spider_data");
        if (!baseDir.exists()) {
            baseDir.mkdirs();
        }
    }

    public Context getApplicationContext() {
        return this;
    }

    @Override
    public String getPackageName() {
        return DEFAULT_PACKAGE_NAME;
    }

    @Override
    public File getCacheDir() {
        File dir = new File(baseDir, "cache");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @Override
    public File getFilesDir() {
        File dir = new File(baseDir, "files");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @Override
    public SharedPreferences getSharedPreferences(String name, int mode) {
        synchronized (prefsMap) {
            SharedPreferences prefs = prefsMap.get(name);
            if (prefs == null) {
                prefs = new MockSharedPreferences(new File(baseDir, name + ".json"));
                prefsMap.put(name, prefs);
            }
            return prefs;
        }
    }

    @Override
    public File getExternalCacheDir() {
        return getCacheDir();
    }

    @Override
    public File getExternalFilesDir(String type) {
        return getFilesDir();
    }

    @Override
    public File getDir(String name, int mode) {
        File dir = new File(baseDir, name);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    @Override
    public Object getContentResolver() {
        return null;
    }

    @Override
    public Object getAssets() {
        return new android.content.res.AssetManager();
    }

    @Override
    public Object getResources() {
        return new android.content.res.Resources();
    }

    @Override
    public Object getPackageManager() {
        return new android.content.pm.PackageManager();
    }
}
