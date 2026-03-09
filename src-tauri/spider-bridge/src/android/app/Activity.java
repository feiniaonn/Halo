package android.app;

import android.content.Context;

/**
 * Minimal Activity stub for desktop compatibility.
 */
public class Activity extends android.content.ContextWrapper {
    public Activity() {
        super(new Application());
    }

    public Context getApplicationContext() {
        return getBaseContext();
    }

    public Context getBaseContext() {
        return this;
    }
}
