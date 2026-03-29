package android.app;

import android.content.Context;

/**
 * Minimal ActivityThread stub for desktop compatibility.
 * Some spiders read the host application through ActivityThread globals.
 */
public final class ActivityThread {
    private static final ActivityThread CURRENT = new ActivityThread();
    private static volatile Application application = new com.halo.spider.mock.MockContext("com.tauri-app.halo");

    private ActivityThread() {
    }

    public static ActivityThread currentActivityThread() {
        return CURRENT;
    }

    public static Application currentApplication() {
        return application;
    }

    public static void attachApplication(Application app) {
        if (app != null) {
            application = app;
        }
    }

    public Application getApplication() {
        return application;
    }

    public Context getApplicationContext() {
        return application;
    }

    public Context getSystemContext() {
        return application;
    }
}
