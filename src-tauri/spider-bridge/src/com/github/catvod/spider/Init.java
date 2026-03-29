package com.github.catvod.spider;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import com.github.catvod.crawler.Spider;
import com.halo.spider.mock.MockContext;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Desktop-compatible Init shim for spiders that expect Android global state.
 */
public class Init {
    private static volatile Application application;
    private static volatile Activity activity;
    private static final Map<String, Boolean> KEYWORDS_MAP = new ConcurrentHashMap<>();
    public ClassLoader O0OoO0OoOoOo0oO0oO;
    public Application o0OoO0oO0oOoO0O0oO;
    public final ClassLoader oOo0Oo0oO0Oo0O0Oo0;
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

    public Init() {
        ClassLoader runtimeLoader = currentRuntimeLoader();
        this.oOo0Oo0oO0Oo0O0Oo0 = runtimeLoader != null ? runtimeLoader : Init.class.getClassLoader();
        this.O0OoO0OoOoOo0oO0oO = this.oOo0Oo0oO0Oo0O0Oo0;
        this.o0OoO0oO0oOoO0O0oO = application;
    }

    private static Application fallbackApplication() {
        return new MockContext("com.tauri-app.halo");
    }

    private static synchronized Application ensureApplication() {
        if (application == null) {
            application = fallbackApplication();
        }
        android.app.ActivityThread.attachApplication(application);
        if (activity == null) {
            activity = new Activity(application);
        }
        if (d == null) {
            d = application.getSharedPreferences("halo-spider-init", 0);
        }
        if (Loader.a == null) {
            Loader.a = new Init();
        }
        syncLoaderState();
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
        android.app.ActivityThread.attachApplication(application);
        if (activity == null) {
            activity = new Activity(application);
        }
        if (d == null) {
            d = application.getSharedPreferences("halo-spider-init", 0);
        }
        syncLoaderState();
    }

    private static ClassLoader currentRuntimeLoader() {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (loader != null) {
            return loader;
        }
        if (Loader.a != null && Loader.a.O0OoO0OoOoOo0oO0oO != null) {
            return Loader.a.O0OoO0OoOoOo0oO0oO;
        }
        return Init.class.getClassLoader();
    }

    private static synchronized void syncLoaderState() {
        if (Loader.a == null) {
            Loader.a = new Init();
        }
        Loader.a.o0OoO0oO0oOoO0O0oO = application;
        ClassLoader runtimeLoader = currentRuntimeLoader();
        if (runtimeLoader != null) {
            Loader.a.O0OoO0OoOoOo0oO0oO = runtimeLoader;
        }
    }

    public static Init get() {
        ensureApplication();
        return Loader.a;
    }

    public static void init(Context context) {
        bindContext(context);
        attachDexLoader(context);
    }

    public static void init(Context context, String ext) {
        bindContext(context);
        attachDexLoader(context);
        e = ext == null ? "" : ext;
    }

    public static void init(Object context) {
        if (context instanceof Context) {
            bindContext((Context) context);
            attachDexLoader((Context) context);
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

    public static ClassLoader classLoader() {
        return get().oOo0Oo0oO0Oo0O0Oo0;
    }

    public static ClassLoader loader() {
        Init init = get();
        if (init.O0OoO0OoOoOo0oO0oO == null) {
            init.O0OoO0OoOoOo0oO0oO = currentRuntimeLoader();
        }
        return init.O0OoO0OoOoOo0oO0oO;
    }

    public static Spider getSpider(String className) {
        ensureApplication();
        ClassLoader runtimeLoader = loader();
        if (runtimeLoader == null) {
            return null;
        }

        for (String candidate : buildSpiderLookupCandidates(className)) {
            Spider runtimeSpider = invokeDexNativeSpider(runtimeLoader, candidate);
            if (runtimeSpider != null) {
                if (!candidate.equals(className)) {
                    System.err.println("DEBUG: Init.getSpider resolved " + className + " via candidate " + candidate);
                }
                return runtimeSpider;
            }
        }

        return resolveSpiderFallback(runtimeLoader, className);
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

    public static void lj() {
        ensureApplication();
    }

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

    public static Object[] proxyInvoke(Map<String, String> params) {
        try {
            Class<?> dexNativeClass = Class.forName("com.github.catvod.spider.DexNative", true, loader());
            Method method = dexNativeClass.getMethod("proxyInvoke", Object.class, Object.class);
            Object value = method.invoke(null, loader(), params);
            return value instanceof Object[] ? (Object[]) value : null;
        } catch (Throwable ignored) {
            return null;
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

    private static Spider invokeDexNativeSpider(ClassLoader runtimeLoader, String className) {
        try {
            Class<?> dexNativeClass = Class.forName("com.github.catvod.spider.DexNative", true, runtimeLoader);
            Method method = dexNativeClass.getMethod("getSpider", Object.class, String.class);
            Object value = method.invoke(null, runtimeLoader, className);
            if (value instanceof Spider) {
                return (Spider) value;
            }
        } catch (Throwable ignored) {
        }
        return null;
    }

    private static LinkedHashSet<String> buildSpiderLookupCandidates(String className) {
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        if (className == null) {
            return candidates;
        }

        String trimmed = className.trim();
        if (trimmed.isEmpty()) {
            return candidates;
        }

        candidates.add(trimmed);
        int lastDot = trimmed.lastIndexOf('.');
        String simpleName = lastDot >= 0 ? trimmed.substring(lastDot + 1) : trimmed;
        if (!simpleName.isEmpty()) {
            candidates.add(simpleName);
            candidates.add("csp_" + simpleName);

            if (simpleName.endsWith("Amnsr")) {
                String normalized = simpleName.substring(0, simpleName.length() - "Amnsr".length());
                if (!normalized.isEmpty()) {
                    candidates.add(normalized);
                    candidates.add("csp_" + normalized);
                }
            }
            if (simpleName.endsWith("Amns")) {
                String normalized = simpleName.substring(0, simpleName.length() - "Amns".length());
                if (!normalized.isEmpty()) {
                    candidates.add(normalized);
                    candidates.add("csp_" + normalized);
                }
            }
        }

        return candidates;
    }

    private static void attachDexLoader(Context context) {
        try {
            Class<?> dexNativeClass = Class.forName("com.github.catvod.spider.DexNative", true, currentRuntimeLoader());
            Method method = dexNativeClass.getMethod("getLoader", Object.class);
            Object value = method.invoke(null, context);
            if (value instanceof ClassLoader) {
                Init init = get();
                init.O0OoO0OoOoOo0oO0oO = (ClassLoader) value;
            }
        } catch (Throwable ignored) {
        }
    }

    private static Spider resolveSpiderFallback(ClassLoader runtimeLoader, String className) {
        if (runtimeLoader == null || className == null || className.trim().isEmpty()) {
            return null;
        }

        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        int lastDot = className.lastIndexOf('.');
        String packagePrefix = lastDot >= 0 ? className.substring(0, lastDot + 1) : "";
        String simpleName = lastDot >= 0 ? className.substring(lastDot + 1) : className;
        if (simpleName.endsWith("Amnsr")) {
            candidates.add(packagePrefix + simpleName.substring(0, simpleName.length() - "Amnsr".length()));
        }
        if (simpleName.endsWith("Amns")) {
            candidates.add(packagePrefix + simpleName.substring(0, simpleName.length() - "Amns".length()));
        }

        for (String candidate : candidates) {
            try {
                Class<?> delegateClass = Class.forName(candidate, true, runtimeLoader);
                if (!Spider.class.isAssignableFrom(delegateClass)) {
                    continue;
                }
                Constructor<?> constructor = delegateClass.getDeclaredConstructor();
                constructor.setAccessible(true);
                Object value = constructor.newInstance();
                if (value instanceof Spider) {
                    return (Spider) value;
                }
            } catch (Throwable ignored) {
            }
        }

        return null;
    }
}
