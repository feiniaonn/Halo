package com.github.catvod.spider;

import android.content.Context;

/**
 * Global initialization helper for spiders.
 */
public class Init {
    public static void init(Context context) {
        // Placeholder for initializing SQLite, etc.
    }

    public static void execute(Runnable runnable) {
        if (runnable != null) runnable.run();
    }
}
