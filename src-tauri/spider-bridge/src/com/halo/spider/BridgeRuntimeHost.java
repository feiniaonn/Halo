package com.halo.spider;

import android.content.Context;
import java.io.Closeable;
import java.io.File;
import java.lang.reflect.Constructor;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

final class BridgeRuntimeHost {
    private static final Map<String, BridgeSession> SESSION_CACHE = new HashMap<>();

    private BridgeRuntimeHost() {
    }

    static JSONObject executeFromJson(JSONObject params) {
        return execute(buildInvocation(params), true).toJsonObject();
    }

    static void shutdownSessions() {
        synchronized (SESSION_CACHE) {
            for (BridgeSession session : SESSION_CACHE.values()) {
                closeSession(session);
            }
            SESSION_CACHE.clear();
        }
    }

    private static BridgeRunner.BridgeResponse execute(BridgeInvocation invocation, boolean reuseSession) {
        BridgeRunner.BridgeResponse response = new BridgeRunner.BridgeResponse();
        try {
            if (invocation.jarPath.isEmpty()) {
                throw new IllegalArgumentException("jarPath is empty");
            }
            if (invocation.method.isEmpty()) {
                throw new IllegalArgumentException("spiderMethod is empty");
            }
            if (!invocation.proxyBaseUrl.isEmpty()) {
                System.setProperty("halo.proxy.baseUrl", invocation.proxyBaseUrl);
            }
            if (!invocation.libDir.isEmpty()) {
                System.setProperty("spider.lib.dir", invocation.libDir);
            }

            BridgeSession session = reuseSession ? getOrCreateSession(invocation) : createSession(invocation);
            try {
                synchronized (session.monitor) {
                    ClassLoader previousContext = Thread.currentThread().getContextClassLoader();
                    if (session.loader != null) {
                        Thread.currentThread().setContextClassLoader(session.loader);
                    }
                    try {
                        if (session.loader != null) {
                            BridgeRunner.configureProxyRuntime(session.loader, invocation.proxyBaseUrl);
                        }
                        if (!invocation.precallMethods.isEmpty()) {
                            BridgeRunner.invokePrecallMethods(session.spider, invocation.precallMethods);
                        }

                        String displayName = session.isJsBridge ? "JSBridge" : session.spider.getClass().getSimpleName();
                        System.err.println("DEBUG: [BridgeDaemon] Invoking " + displayName + "." + invocation.method + "()");
                        Object result = "init".equals(invocation.method)
                                ? ""
                                : BridgeRunner.invokeMethod(session.spider, invocation.method, invocation.callArgs);

                        response.ok = true;
                        response.className = session.className;
                        response.result = BridgeResultSerializer.serialize(result);
                    } finally {
                        Thread.currentThread().setContextClassLoader(previousContext);
                    }
                }
            } finally {
                if (!reuseSession) {
                    closeSession(session);
                }
            }
        } catch (Throwable throwable) {
            response.ok = false;
            response.error = throwable.getClass().getName() + ": " + BridgeRunner.safeMessage(throwable);
            throwable.printStackTrace(System.err);
        }

        return response;
    }

    private static BridgeInvocation buildInvocation(JSONObject params) {
        BridgeInvocation invocation = new BridgeInvocation();
        invocation.jarPath = params.optString("jarPath", "").trim();
        invocation.siteKey = params.optString("siteKey", "").trim();
        invocation.classHint = params.optString("classHint", "").trim();
        invocation.ext = params.optString("ext", "");
        invocation.method = params.optString("spiderMethod", params.optString("method", "")).trim();
        invocation.compatJars = params.optString("compatJars", "").trim();
        invocation.fallbackJar = params.optString("fallbackJar", "").trim();
        invocation.proxyBaseUrl = params.optString("proxyBaseUrl", "").trim();
        invocation.jsRuntimeRoot = params.optString("jsRuntimeRoot", "").trim();
        invocation.precallMethods = params.optString("precallMethods", "").trim();
        invocation.libDir = params.optString("libDir", "").trim();

        JSONArray args = params.optJSONArray("args");
        if (args != null) {
            for (int index = 0; index < args.length(); index++) {
                JSONObject arg = args.optJSONObject(index);
                if (arg == null) {
                    invocation.callArgs.add(null);
                    continue;
                }
                invocation.callArgs.add(
                        BridgeRunner.decodeArg(
                                arg.optString("type", "string"),
                                arg.optString("value", "")));
            }
        }

        invocation.runtimeKey = buildRuntimeKey(invocation);
        invocation.cacheBucket = invocation.siteKey.isEmpty() ? invocation.runtimeKey : invocation.siteKey;
        return invocation;
    }

    private static String buildRuntimeKey(BridgeInvocation invocation) {
        StringBuilder builder = new StringBuilder();
        builder.append(invocation.jarPath).append('|');
        builder.append(invocation.siteKey).append('|');
        builder.append(invocation.classHint).append('|');
        builder.append(hashText(invocation.ext)).append('|');
        builder.append(invocation.compatJars).append('|');
        builder.append(invocation.fallbackJar).append('|');
        builder.append(invocation.proxyBaseUrl).append('|');
        builder.append(invocation.jsRuntimeRoot).append('|');
        builder.append(invocation.libDir);
        return builder.toString();
    }

    private static String hashText(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder(bytes.length * 2);
            for (byte value : bytes) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Throwable ignored) {
            return Integer.toHexString(text.hashCode());
        }
    }

    private static BridgeSession getOrCreateSession(BridgeInvocation invocation) throws Exception {
        synchronized (SESSION_CACHE) {
            BridgeSession existing = SESSION_CACHE.get(invocation.cacheBucket);
            if (existing != null && invocation.runtimeKey.equals(existing.runtimeKey)) {
                return existing;
            }
            if (existing != null) {
                closeSession(existing);
            }
            BridgeSession created = createSession(invocation);
            SESSION_CACHE.put(invocation.cacheBucket, created);
            return created;
        }
    }

    private static BridgeSession createSession(BridgeInvocation invocation) throws Exception {
        List<java.net.URL> urls = new ArrayList<>();

        File bridgeFile = new File(BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        File bridgeDir = bridgeFile.getParentFile();

        File classesDir = new File(bridgeDir, "classes");
        if (classesDir.exists()) {
            urls.add(classesDir.toURI().toURL());
        }

        File libDir = new File(invocation.jarPath).getParentFile();
        if (libDir != null && libDir.exists()) {
            libDir = new File(libDir, "libs");
        }
        if (libDir != null && libDir.exists() && libDir.isDirectory()) {
            File[] libs = libDir.listFiles((dir, name) -> name.endsWith(".jar"));
            if (libs != null) {
                for (File lib : libs) {
                    if (lib.getAbsolutePath().equals(new File(invocation.jarPath).getAbsolutePath())) {
                        continue;
                    }
                    urls.add(lib.toURI().toURL());
                }
                System.err.println("DEBUG: [BridgeDaemon] Discovered " + libs.length + " auxiliary libraries in libs/ directory.");
            }
        }

        List<java.net.URL> compatUrls = BridgeRunner.parseCompatJarUrls(invocation.compatJars);
        File mainSpiderJar = new File(invocation.jarPath);
        File fallbackJar = resolveFallbackJar(invocation, bridgeDir);

        if (fallbackJar != null && BridgeRunner.prefersAnotherdsPrimary(invocation.classHint)) {
            urls.add(fallbackJar.toURI().toURL());
            urls.add(mainSpiderJar.toURI().toURL());
            System.err.println("DEBUG: [BridgeDaemon] Prioritizing anotherds runtime for " + invocation.classHint);
        } else {
            urls.add(mainSpiderJar.toURI().toURL());
            if (fallbackJar != null) {
                urls.add(fallbackJar.toURI().toURL());
            }
        }
        urls.addAll(compatUrls);

        BridgeSession session = new BridgeSession();
        session.runtimeKey = invocation.runtimeKey;
        session.isJsBridge = invocation.jarPath.endsWith(".js");

        if (session.isJsBridge) {
            String jsContent = new String(
                    java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(invocation.jarPath)),
                    StandardCharsets.UTF_8);
            session.spider = new JSBridge(jsContent, invocation.jsRuntimeRoot);
            session.className = "com.halo.spider.JSBridge";
        } else {
            session.loader = new BridgeRunner.SpiderRuntimeClassLoader(
                    urls,
                    BridgeRunner.class.getClassLoader(),
                    BridgeRunner.collectPreferredBridgeClasses(invocation.classHint));
            session.className = BridgeRunner.pickSpiderClassName(
                    invocation.jarPath,
                    invocation.siteKey,
                    invocation.classHint,
                    session.loader);

            Class<?> spiderClass = Class.forName(session.className, true, session.loader);
            BridgeRunner.configureProxyRuntime(session.loader, invocation.proxyBaseUrl);
            Constructor<?> constructor = spiderClass.getDeclaredConstructor();
            constructor.setAccessible(true);
            session.spider = constructor.newInstance();
            BridgeRunner.seedSiteDefaults(session.spider, invocation.classHint, invocation.ext);
        }

        initializeSession(session, invocation);
        return session;
    }

    private static File resolveFallbackJar(BridgeInvocation invocation, File bridgeDir) {
        if (!invocation.fallbackJar.isEmpty()) {
            File explicit = new File(invocation.fallbackJar);
            if (explicit.isFile()) {
                return explicit;
            }
        }
        if (!BridgeRunner.needsAnotherdsFallback(invocation.classHint)) {
            return null;
        }
        return BridgeRunner.resolveAnotherdsFallbackJar(bridgeDir, invocation.jarPath);
    }

    private static void initializeSession(BridgeSession session, BridgeInvocation invocation) throws Exception {
        ClassLoader previousContext = Thread.currentThread().getContextClassLoader();
        if (session.loader != null) {
            Thread.currentThread().setContextClassLoader(session.loader);
        }
        try {
            System.setProperty(
                    "http.agent",
                    "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36");
            Context mockContext = new com.halo.spider.mock.MockContext(invocation.siteKey);
            BridgeRunner.invokeGlobalInit(session.loader, mockContext);
            BridgeRuntimeSetup.ensureDesktopRuntimeFiles(mockContext);
            BridgeRunner.ensureMergeC0HttpRuntime(session.loader);
            BridgeRunner.ensureMergeHttpRuntime(session.loader);
            BridgeRuntimeSetup.ensureMergeFmHttpRuntime(session.loader);
            BridgeRuntimeSetup.ensureMergeKHttpRuntime(session.loader);
            BridgeRuntimeSetup.ensureMergeE0HttpRuntime(session.loader);
            BridgeRuntimeSetup.ensureMergeA0HttpRuntime(session.loader);
            BridgeRunner.ensureMergeZzHttpRuntime(session.loader);
            BridgeRunner.invokeInitApi(session.spider);
            BridgeRunner.invokeInit(session.spider, mockContext, invocation.ext, session.isJsBridge);
        } finally {
            Thread.currentThread().setContextClassLoader(previousContext);
        }
    }

    private static void closeSession(BridgeSession session) {
        if (session == null) {
            return;
        }
        if (session.loader instanceof Closeable) {
            try {
                ((Closeable) session.loader).close();
            } catch (Throwable ignored) {
            }
        }
    }

    private static final class BridgeInvocation {
        String jarPath;
        String siteKey;
        String classHint;
        String ext;
        String method;
        String compatJars;
        String fallbackJar;
        String proxyBaseUrl;
        String jsRuntimeRoot;
        String precallMethods;
        String libDir;
        String runtimeKey;
        String cacheBucket;
        final List<Object> callArgs = new ArrayList<>();
    }

    private static final class BridgeSession {
        final Object monitor = new Object();
        String runtimeKey;
        String className;
        Object spider;
        ClassLoader loader;
        boolean isJsBridge;
    }
}
