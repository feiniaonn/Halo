package com.github.catvod.spider;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import com.halo.spider.mock.MockContext;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Desktop-compatible Init shim for spiders that expect Android global state.
 */
public class Init {
    private static volatile Application application;
    private static volatile Activity activity;
    private static final Map<String, Boolean> KEYWORDS_MAP = new ConcurrentHashMap<>();
    private static String g = "";
    public static String h = "";
    public static String i = "";
    public static String j = "";
    public static String k = "";
    public static String l = "";
    public static String m = "";
    public static String n = "";
    public static SharedPreferences d;
    public static String e = "";

    public static final class Loader {
        public static Init a;
    }

    private static Application fallbackApplication() {
        return new MockContext("com.tauri-app.halo");
    }

    private static synchronized Application ensureApplication() {
        if (application == null) {
            application = fallbackApplication();
        }
        if (activity == null) {
            activity = new Activity();
        }
        if (d == null) {
            d = application.getSharedPreferences("halo-spider-init", 0);
        }
        if (Loader.a == null) {
            Loader.a = new Init();
        }
        return application;
    }

    private static synchronized void bindContext(Context context) {
        if (context instanceof Application) {
            application = (Application) context;
        } else if (context != null) {
            try {
                String packageName = context.getPackageName();
                if (packageName != null && !packageName.trim().isEmpty()) {
                    application = new MockContext(packageName.trim());
                }
            } catch (Throwable ignored) {
                application = fallbackApplication();
            }
        }

        Application app = ensureApplication();
        if (application == null) {
            application = app;
        }
        if (d == null) {
            d = application.getSharedPreferences("halo-spider-init", 0);
        }
    }

    public Init() {}

    public static Init get() {
        ensureApplication();
        return Loader.a;
    }

    public static void init(Context context) {
        bindContext(context);
    }

    public static void init(Context context, String ext) {
        bindContext(context);
        e = ext == null ? "" : ext;
    }

    public static void init(Object context) {
        if (context instanceof Context) {
            bindContext((Context) context);
        } else {
            ensureApplication();
        }
    }

    public static void init(Object context, String ext) {
        init(context);
        e = ext == null ? "" : ext;
    }

    public static void init(String ext) {
        ensureApplication();
        e = ext == null ? "" : ext;
    }

    public static Application context() {
        return ensureApplication();
    }

    public static Context getApplicationContext() {
        return ensureApplication().getApplicationContext();
    }

    public static Activity getActivity() {
        ensureApplication();
        return activity;
    }

    public static Activity getConfigActivity() {
        return getActivity();
    }

    public static Map<String, Boolean> getKeywordsMap() {
        return KEYWORDS_MAP;
    }

    public static void Tip() {}

    public static void a() throws IOException {}

    public static void checkPermission() {}

    public static void interceptActivitySch() {}

    public static void interceptActivityStart() {}

    public static void startProxyServer() {}

    public static void startFloatBall() {}

    public static void startGoProxy(Context context) {
        bindContext(context);
    }

    public static void show(String message) {
        if (message != null && !message.trim().isEmpty()) {
            System.err.println("SPIDER_DEBUG: " + message.trim());
        }
    }

    public static void run(Runnable runnable) {
        execute(runnable);
    }

    public static void run(Runnable runnable, int delayMillis) {
        execute(runnable);
    }

    public static void execute(Runnable runnable) {
        if (runnable != null) {
            runnable.run();
        }
    }

    public static void write(File file, InputStream inputStream) {
        if (file == null || inputStream == null) {
            return;
        }
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        byte[] buffer = new byte[8192];
        try (InputStream source = inputStream; FileOutputStream output = new FileOutputStream(file)) {
            int read;
            while ((read = source.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
        } catch (Throwable ignored) {
        }
    }
}
