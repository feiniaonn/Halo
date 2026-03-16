package com.halo.spider;

import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

final class BridgeRuntimeSetup {
    private static final String DEFAULT_DOUBAN_CONFIG = "{\"homePage\":\"\"}";
    private static final String DEFAULT_TVBOX_COOKIE = "";

    private BridgeRuntimeSetup() {
    }

    static void ensureDesktopRuntimeFiles(android.content.Context context) {
        if (context == null) {
            return;
        }

        try {
            File filesDir = context.getFilesDir();
            if (filesDir != null && !filesDir.exists()) {
                filesDir.mkdirs();
            }
            File cacheDir = context.getCacheDir();
            if (cacheDir != null && !cacheDir.exists()) {
                cacheDir.mkdirs();
            }

            if (filesDir == null) {
                return;
            }

            File configFile = new File(filesDir, "config.json");
            if (!configFile.exists() || configFile.length() == 0L) {
                Files.writeString(configFile.toPath(), DEFAULT_DOUBAN_CONFIG, StandardCharsets.UTF_8);
                System.err.println("DEBUG: Seeded desktop config file: " + configFile.getAbsolutePath());
            }

            File tvboxDir = new File(filesDir, "TVBox");
            if (!tvboxDir.exists()) {
                tvboxDir.mkdirs();
            }

            File biliCookieFile = new File(tvboxDir, "bili_cookie.txt");
            if (!biliCookieFile.exists()) {
                Files.writeString(biliCookieFile.toPath(), DEFAULT_TVBOX_COOKIE, StandardCharsets.UTF_8);
                System.err.println("DEBUG: Seeded desktop TVBox cookie file: " + biliCookieFile.getAbsolutePath());
            }
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureDesktopRuntimeFiles failed: " + error.getMessage());
        }
    }

    static void ensureMergeFmHttpRuntime(ClassLoader loader) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> holderClass = Class.forName("com.github.catvod.spider.merge.FM.m.b", true, loader);
            Class<?> runtimeClass = Class.forName("com.github.catvod.spider.merge.FM.m.c", true, loader);
            Field holderField = null;
            for (Field field : holderClass.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && runtimeClass.isAssignableFrom(field.getType())) {
                    holderField = field;
                    break;
                }
            }
            if (holderField == null) {
                return;
            }

            holderField.setAccessible(true);
            Object runtime = holderField.get(null);
            if (runtime == null) {
                Constructor<?> runtimeCtor = runtimeClass.getDeclaredConstructor();
                runtimeCtor.setAccessible(true);
                runtime = runtimeCtor.newInstance();
                holderField.set(null, runtime);
            }

            Object client = buildRuntimeOkHttpClient(loader);
            if (client == null) {
                return;
            }

            for (Field field : runtimeClass.getDeclaredFields()) {
                if (!"okhttp3.OkHttpClient".equals(field.getType().getName())) {
                    continue;
                }
                field.setAccessible(true);
                if (field.get(runtime) == null) {
                    field.set(runtime, client);
                }
            }

            System.err.println("DEBUG: Seeded merge.FM runtime via " + holderClass.getName() + "." + holderField.getName());
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureMergeFmHttpRuntime failed: " + error.getMessage());
        }
    }

    static void ensureMergeKHttpRuntime(ClassLoader loader) {
        ensureStaticOkHttpRuntime(
                loader,
                "com.github.catvod.spider.merge.k.b$a",
                "com.github.catvod.spider.merge.k.b",
                "merge.k");
    }

    static void ensureMergeE0HttpRuntime(ClassLoader loader) {
        ensureStaticOkHttpRuntime(
                loader,
                "com.github.catvod.spider.merge.E0.d.b",
                "com.github.catvod.spider.merge.E0.d.c",
                "merge.E0");
    }

    static void ensureMergeA0HttpRuntime(ClassLoader loader) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> runtimeClass = Class.forName("com.github.catvod.spider.merge.A0.yi", true, loader);
            boolean seeded = false;

            for (Field field : runtimeClass.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers())) {
                    continue;
                }

                field.setAccessible(true);
                Object current = field.get(null);
                if ("java.lang.Object".equals(field.getType().getName()) && current == null) {
                    seeded = forceSetStaticField(field, new Object()) || seeded;
                    continue;
                }

                if (java.util.Map.class.isAssignableFrom(field.getType()) && current == null) {
                    seeded = forceSetStaticField(field, new java.util.HashMap<>()) || seeded;
                }
            }

            if (seeded) {
                System.err.println("DEBUG: Seeded merge.A0 runtime statics via " + runtimeClass.getName());
            }
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensure merge.A0 runtime failed: " + error.getMessage());
        }
    }

    private static boolean forceSetStaticField(Field field, Object value) {
        try {
            field.setAccessible(true);
            field.set(null, value);
            return true;
        } catch (Throwable ignored) {
        }

        try {
            Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
            Field unsafeField = unsafeClass.getDeclaredField("theUnsafe");
            unsafeField.setAccessible(true);
            Object unsafe = unsafeField.get(null);
            Method staticFieldBase = unsafeClass.getMethod("staticFieldBase", Field.class);
            Method staticFieldOffset = unsafeClass.getMethod("staticFieldOffset", Field.class);
            Method putObject = unsafeClass.getMethod("putObject", Object.class, long.class, Object.class);
            Object base = staticFieldBase.invoke(unsafe, field);
            long offset = ((Number) staticFieldOffset.invoke(unsafe, field)).longValue();
            putObject.invoke(unsafe, base, offset, value);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static void ensureStaticOkHttpRuntime(
            ClassLoader loader,
            String holderClassName,
            String runtimeClassName,
            String runtimeLabel) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> holderClass = Class.forName(holderClassName, true, loader);
            Class<?> runtimeClass = Class.forName(runtimeClassName, true, loader);
            Field holderField = null;
            for (Field field : holderClass.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && runtimeClass.isAssignableFrom(field.getType())) {
                    holderField = field;
                    break;
                }
            }
            if (holderField == null) {
                return;
            }

            holderField.setAccessible(true);
            Object runtime = holderField.get(null);
            if (runtime == null) {
                Constructor<?> runtimeCtor = runtimeClass.getDeclaredConstructor();
                runtimeCtor.setAccessible(true);
                runtime = runtimeCtor.newInstance();
                holderField.set(null, runtime);
            }

            Object client = buildRuntimeOkHttpClient(loader);
            if (client == null) {
                return;
            }

            for (Field field : runtimeClass.getDeclaredFields()) {
                if (!"okhttp3.OkHttpClient".equals(field.getType().getName())) {
                    continue;
                }
                field.setAccessible(true);
                if (field.get(runtime) == null) {
                    field.set(runtime, client);
                }
            }

            System.err.println("DEBUG: Seeded " + runtimeLabel + " runtime via "
                    + holderClass.getName() + "." + holderField.getName());
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensure " + runtimeLabel + " runtime failed: " + error.getMessage());
        }
    }

    private static Object buildRuntimeOkHttpClient(ClassLoader loader) {
        try {
            Class<?> builderClass = Class.forName("okhttp3.OkHttpClient$Builder", true, loader);
            Object builder = builderClass.getDeclaredConstructor().newInstance();
            invokeBuilderMethod(builderClass, builder, "retryOnConnectionFailure", new Class<?>[] { boolean.class }, true);
            invokeBuilderMethod(builderClass, builder, "followRedirects", new Class<?>[] { boolean.class }, true);
            invokeBuilderMethod(builderClass, builder, "followSslRedirects", new Class<?>[] { boolean.class }, true);

            Class<?> timeUnitClass = Class.forName("java.util.concurrent.TimeUnit");
            Object seconds = java.util.concurrent.TimeUnit.SECONDS;
            invokeBuilderMethod(builderClass, builder, "connectTimeout", new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);
            invokeBuilderMethod(builderClass, builder, "readTimeout", new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);
            invokeBuilderMethod(builderClass, builder, "writeTimeout", new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);

            Method buildMethod = builderClass.getMethod("build");
            buildMethod.setAccessible(true);
            return buildMethod.invoke(builder);
        } catch (Throwable error) {
            System.err.println("DEBUG: BridgeRuntimeSetup buildRuntimeOkHttpClient failed: " + error.getMessage());
            return null;
        }
    }

    private static void invokeBuilderMethod(
            Class<?> builderClass,
            Object builder,
            String methodName,
            Class<?>[] parameterTypes,
            Object... args) {
        try {
            Method method = builderClass.getMethod(methodName, parameterTypes);
            method.setAccessible(true);
            method.invoke(builder, args);
        } catch (Throwable ignored) {
        }
    }
}
