package android.app;

import android.content.Context;

/**
 * Minimal Activity stub for desktop compatibility.
 */
public class Activity extends android.content.ContextWrapper {
    public Activity() {
        this(ActivityThread.currentApplication());
    }

    public Activity(Context baseContext) {
        super(baseContext == null ? ActivityThread.currentApplication() : baseContext);
    }

    public Context getApplicationContext() {
        return ActivityThread.currentApplication();
    }

    public Application getApplication() {
        return ActivityThread.currentApplication();
    }

    public Context getBaseContext() {
        return mBase == null ? ActivityThread.currentApplication() : mBase;
    }
}
