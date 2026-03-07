package com.halo.spider.mock;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * Concrete implementation of Context for desktop.
 * Stores data in the user's home directory.
 */
public class MockContext extends android.app.Application {
    private final String packageName;
    private final File baseDir;
    private final Map<String, SharedPreferences> prefsMap = new HashMap<>();

    public MockContext(String packageName) {
        super();
        this.packageName = packageName;
        String userHome = System.getProperty("user.home");
        this.baseDir = new File(new File(userHome, ".halo"), "spider_data");
        if (!baseDir.exists()) {
            baseDir.mkdirs();
        }
    }

    public android.content.Context getApplicationContext() {
        return this;
    }

    @Override
    public String getPackageName() {
        return packageName;
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
    public android.content.res.AssetManager getAssets() {
        return new android.content.res.AssetManager();
    }

    @Override
    public android.content.res.Resources getResources() {
        return new android.content.res.Resources();
    }

    @Override
    public Object getPackageManager() {
        return new android.content.pm.PackageManager();
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
}
