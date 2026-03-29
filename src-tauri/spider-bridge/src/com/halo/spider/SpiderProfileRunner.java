package com.halo.spider;

import java.io.File;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

public final class SpiderProfileRunner {
    private static final String PROFILE_TAG = ">>HALO_PROFILE<<";
    private static final String[] CONTENT_METHOD_NAMES = new String[] {
            "homeContent",
            "categoryContent",
            "detailContent",
            "playerContent",
            "searchContent"
    };

    private SpiderProfileRunner() {
    }

    public static void main(String[] ignoredArgs) {
        java.io.PrintStream originalOut = System.out;
        System.setOut(System.err);

        JSONObject payload;
        try {
            payload = inspectFromEnvironment();
        } catch (Throwable throwable) {
            payload = new JSONObject();
            payload.put("ok", false);
            payload.put("className", "");
            payload.put("hasContextInit", false);
            payload.put("declaresContextInit", false);
            payload.put("hasNonContextInit", false);
            payload.put("hasNativeInit", false);
            payload.put("hasNativeContentMethod", false);
            payload.put("workerReason", "");
            payload.put("nativeMethods", new JSONArray());
            payload.put("initSignatures", new JSONArray());
            payload.put("error", throwable.getClass().getName() + ": " + BridgeRunner.safeMessage(throwable));
            throwable.printStackTrace(System.err);
        }

        originalOut.println(PROFILE_TAG + payload.toString() + PROFILE_TAG);
    }

    private static JSONObject inspectFromEnvironment() throws Exception {
        String jarPath = readEnv("HALO_JAR_PATH", "").trim();
        String siteKey = readEnv("HALO_SITE_KEY", "").trim();
        String classHint = readEnv("HALO_CLASS_HINT", "").trim();
        String compatJars = readEnv("HALO_COMPAT_JARS", "").trim();
        String fallbackJar = readEnv("HALO_FALLBACK_JAR", "").trim();

        if (jarPath.isEmpty()) {
            throw new IllegalArgumentException("HALO_JAR_PATH is empty");
        }

        BridgeRunner.SpiderRuntimeClassLoader loader = buildRuntimeLoader(jarPath, classHint, compatJars, fallbackJar);
        ClassLoader previousContext = Thread.currentThread().getContextClassLoader();
        try {
            Thread.currentThread().setContextClassLoader(loader);
            String className = BridgeRunner.pickSpiderClassName(jarPath, siteKey, classHint, loader);
            return inspectSpiderClass(loader, className, classHint);
        } finally {
            Thread.currentThread().setContextClassLoader(previousContext);
            try {
                loader.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private static BridgeRunner.SpiderRuntimeClassLoader buildRuntimeLoader(
            String jarPath,
            String classHint,
            String compatJars,
            String fallbackJar) throws Exception {
        List<java.net.URL> urls = new ArrayList<>();

        File bridgeFile = new File(BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        File bridgeDir = bridgeFile.getParentFile();

        File classesDir = new File(bridgeDir, "classes");
        if (classesDir.exists()) {
            urls.add(classesDir.toURI().toURL());
        }

        File libsDir = new File(jarPath).getParentFile();
        if (libsDir != null && libsDir.exists()) {
            libsDir = new File(libsDir, "libs");
        }
        if (libsDir != null && libsDir.exists() && libsDir.isDirectory()) {
            File[] libs = libsDir.listFiles((dir, name) -> name.endsWith(".jar"));
            if (libs != null) {
                for (File lib : libs) {
                    if (lib.getAbsolutePath().equals(new File(jarPath).getAbsolutePath())) {
                        continue;
                    }
                    urls.add(lib.toURI().toURL());
                }
            }
        }

        List<java.net.URL> compatUrls = BridgeRunner.parseCompatJarUrls(compatJars);
        File mainSpiderJar = new File(jarPath);
        File resolvedFallbackJar = null;
        if (!fallbackJar.isEmpty()) {
            File explicitFallback = new File(fallbackJar);
            if (explicitFallback.isFile()) {
                resolvedFallbackJar = explicitFallback;
            }
        } else if (BridgeRunner.needsAnotherdsFallback(classHint)) {
            resolvedFallbackJar = BridgeRunner.resolveAnotherdsFallbackJar(bridgeDir, jarPath);
        }

        urls.add(mainSpiderJar.toURI().toURL());
        if (resolvedFallbackJar != null) {
            urls.add(resolvedFallbackJar.toURI().toURL());
        }
        urls.addAll(compatUrls);

        return new BridgeRunner.SpiderRuntimeClassLoader(
                urls,
                BridgeRunner.class.getClassLoader(),
                BridgeRunner.collectPreferredBridgeClasses(classHint));
    }

    private static JSONObject inspectSpiderClass(
            ClassLoader loader,
            String className,
            String classHint) {
        ProfileProbe probe = new ProfileProbe();
        probe.ok = true;
        probe.className = className == null ? "" : className.trim();

        if (probe.className.isEmpty()) {
            probe.ok = false;
            probe.error = "Spider profile runner returned empty class name";
            return probe.toJson();
        }

        try {
            Class<?> spiderClass = Class.forName(probe.className, false, loader);

            for (Method method : spiderClass.getMethods()) {
                if (Modifier.isNative(method.getModifiers())) {
                    probe.nativeMethods.add(methodSignature(method));
                    if ("init".equals(method.getName())) {
                        probe.hasNativeInit = true;
                    }
                    if (isContentMethod(method.getName())) {
                        probe.hasNativeContentMethod = true;
                    }
                }

                if (!"init".equals(method.getName())) {
                    continue;
                }

                String signature = methodSignature(method);
                if (!probe.initSignatures.contains(signature)) {
                    probe.initSignatures.add(signature);
                }
                if (hasContextLikeFirstParameter(method)) {
                    probe.hasContextInit = true;
                } else {
                    probe.hasNonContextInit = true;
                }
            }

            for (Method method : spiderClass.getDeclaredMethods()) {
                if ("init".equals(method.getName()) && hasContextLikeFirstParameter(method)) {
                    probe.declaresContextInit = true;
                    break;
                }
            }

            if (probe.hasNativeInit || probe.hasNativeContentMethod) {
                probe.workerReason = "native spider methods detected via reflection";
            } else if (probe.hasContextInit && !probe.hasNonContextInit) {
                probe.workerReason = "context-only init signature detected";
            } else if (isAmnsFamily(probe.className)) {
                probe.workerReason = "amns-family spider detected";
            } else {
                probe.workerReason = "reflected spider methods successfully";
            }
        } catch (Throwable error) {
            probe.workerReason = "partial profile from class hint after reflective load failure";
            probe.error = error.getClass().getName() + ": " + BridgeRunner.safeMessage(error);
            if (isAmnsFamily(probe.className) || isAmnsFamily(classHint)) {
                probe.hasContextInit = true;
                probe.declaresContextInit = true;
            }
        }

        return probe.toJson();
    }

    private static boolean isContentMethod(String methodName) {
        if (methodName == null) {
            return false;
        }
        for (String candidate : CONTENT_METHOD_NAMES) {
            if (candidate.equals(methodName)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasContextLikeFirstParameter(Method method) {
        Class<?>[] params = method.getParameterTypes();
        return params.length > 0 && isContextLikeType(params[0]);
    }

    private static boolean isContextLikeType(Class<?> type) {
        if (type == null) {
            return false;
        }
        String typeName = type.getName();
        if ("android.content.Context".equals(typeName) || "android.app.Application".equals(typeName)) {
            return true;
        }
        return android.content.Context.class.isAssignableFrom(type)
                || android.app.Application.class.isAssignableFrom(type);
    }

    private static boolean isAmnsFamily(String value) {
        if (value == null || value.trim().isEmpty()) {
            return false;
        }
        String normalized = value.trim().toLowerCase();
        return normalized.endsWith("amns") || normalized.endsWith("amnsr");
    }

    private static String methodSignature(Method method) {
        StringBuilder builder = new StringBuilder();
        builder.append(method.getName()).append("(");
        Class<?>[] params = method.getParameterTypes();
        for (int index = 0; index < params.length; index++) {
            if (index > 0) {
                builder.append(", ");
            }
            builder.append(params[index].getName());
        }
        builder.append(")");
        return builder.toString();
    }

    private static String readEnv(String key, String fallback) {
        String value = System.getenv(key);
        return value == null ? fallback : value;
    }

    private static final class ProfileProbe {
        boolean ok;
        String className = "";
        boolean hasContextInit;
        boolean declaresContextInit;
        boolean hasNonContextInit;
        boolean hasNativeInit;
        boolean hasNativeContentMethod;
        String workerReason = "";
        String error = "";
        final LinkedHashSet<String> nativeMethods = new LinkedHashSet<>();
        final LinkedHashSet<String> initSignatures = new LinkedHashSet<>();

        JSONObject toJson() {
            JSONObject payload = new JSONObject();
            payload.put("ok", ok);
            payload.put("className", className == null ? "" : className);
            payload.put("hasContextInit", hasContextInit);
            payload.put("declaresContextInit", declaresContextInit);
            payload.put("hasNonContextInit", hasNonContextInit);
            payload.put("hasNativeInit", hasNativeInit);
            payload.put("hasNativeContentMethod", hasNativeContentMethod);
            payload.put("workerReason", workerReason == null ? "" : workerReason);
            payload.put("nativeMethods", new JSONArray(new ArrayList<>(nativeMethods)));
            payload.put("initSignatures", new JSONArray(new ArrayList<>(initSignatures)));
            payload.put("error", error == null ? "" : error);
            return payload;
        }
    }
}
