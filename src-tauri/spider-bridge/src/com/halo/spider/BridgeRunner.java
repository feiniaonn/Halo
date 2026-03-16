package com.halo.spider;
import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import org.json.JSONArray;
import org.json.JSONObject;

public final class BridgeRunner {
    private static final Base64.Decoder BASE64_DECODER = Base64.getDecoder();

    private BridgeRunner() {
    }

    static final class BridgeResponse {
        boolean ok;
        String result;
        String className;
        String error;

        String toJson() {
            StringBuilder sb = new StringBuilder();
            sb.append("{");
            sb.append("\"ok\":").append(ok).append(",");
            sb.append("\"className\":\"").append(className == null ? "" : escapeJson(className)).append("\",");

            String resultStr = result == null ? "{}" : result;
            if (resultStr.startsWith("{") || resultStr.startsWith("[")) {
                sb.append("\"result\":").append(resultStr).append(",");
            } else {
                sb.append("\"result\":\"").append(escapeJson(resultStr)).append("\",");
            }

            sb.append("\"error\":\"").append(error == null ? "" : escapeJson(error)).append("\"");
            sb.append("}");
            return sb.toString();
        }

        JSONObject toJsonObject() {
            JSONObject payload = new JSONObject();
            payload.put("ok", ok);
            payload.put("className", className == null ? "" : className);
            payload.put("error", error == null ? "" : error);

            String resultStr = result == null ? "{}" : result;
            if (resultStr.startsWith("{") || resultStr.startsWith("[")) {
                try {
                    payload.put("result", new org.json.JSONTokener(resultStr).nextValue());
                    return payload;
                } catch (Throwable ignored) {
                }
            }
            payload.put("result", resultStr);
            return payload;
        }
    }

    static final class SpiderRuntimeClassLoader extends java.net.URLClassLoader {
        private final java.util.Set<String> preferredBridgeClasses;

        SpiderRuntimeClassLoader(
                List<java.net.URL> urls,
                ClassLoader parent,
                java.util.Set<String> preferredBridgeClasses) {
            super(urls.toArray(new java.net.URL[0]), parent);
            this.preferredBridgeClasses = preferredBridgeClasses == null
                    ? java.util.Collections.emptySet()
                    : preferredBridgeClasses;
        }

        @Override
        public Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
            synchronized (getClassLoadingLock(name)) {
                Class<?> loaded = findLoadedClass(name);
                if (loaded == null && shouldPreferBridgeOverride(name, preferredBridgeClasses)) {
                    try {
                        loaded = getParent().loadClass(name);
                        System.err.println("DEBUG: Using bridge override for " + name);
                    } catch (ClassNotFoundException ignored) {
                        // Fall through to child resolution.
                    }
                }
                if (loaded == null && shouldLoadCatvodRuntimeFirst(name)) {
                    try {
                        loaded = findClass(name);
                    } catch (ClassNotFoundException ignored) {
                        // Fall back to the normal parent-first chain below.
                    }
                }
                if (loaded == null) {
                    loaded = super.loadClass(name, false);
                }
                if (resolve) {
                    resolveClass(loaded);
                }
                return loaded;
            }
        }

        @Override
        protected Class<?> findClass(String name) throws ClassNotFoundException {
            try {
                return super.findClass(name);
            } catch (ClassFormatError | UnsatisfiedLinkError error) {
                System.err.println(
                        "DEBUG: Skipping malformed class (ClassFormatError): " + name + " 鈫?" + error.getMessage());
                throw new ClassNotFoundException("Skipped due to ClassFormatError: " + name, error);
            }
        }
    }

    public static void main(String[] ignoredArgs) {
        // Shadow System.out to avoid spider logs polluting the result channel
        java.io.PrintStream originalOut = System.out;
        System.setOut(System.err);

        BridgeResponse response = new BridgeResponse();
        try {
            String jarPath = readEnv("HALO_JAR_PATH", "");
            String siteKey = readEnv("HALO_SITE_KEY", "");
            String classHint = readEnv("HALO_CLASS_HINT", "");
            String ext = readEnv("HALO_EXT", "");
            String method = readEnv("HALO_METHOD", "").trim();
            String proxyBaseUrl = readEnv("HALO_PROXY_BASE_URL", "").trim();
            List<Object> callArgs = readCallArgs();

            if (!proxyBaseUrl.isEmpty()) {
                System.setProperty("halo.proxy.baseUrl", proxyBaseUrl);
            }

            // Intercept internal logs manually if needed

            if (jarPath.isEmpty()) {
                throw new IllegalArgumentException("HALO_JAR_PATH is empty");
            }
            if (method.isEmpty()) {
                throw new IllegalArgumentException("HALO_METHOD is empty");
            }

            List<java.net.URL> urls = new java.util.ArrayList<>();

            // Auto-load common libraries and classes folder
            try {
                java.io.File bridgeFile = new java.io.File(
                        BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
                java.io.File bridgeDir = bridgeFile.getParentFile();

                // 1. Add classes folder (priority for loose .class files)
                java.io.File classesDir = new java.io.File(bridgeDir, "classes");
                if (classesDir.exists()) {
                    urls.add(classesDir.toURI().toURL());
                }

                // 2. Add libs (priority over target jar to override broken bundled SDK classes)
                // Look for libs/ directory next to the main jarPath
                java.io.File libDir = new java.io.File(jarPath).getParentFile();
                if (libDir != null && libDir.exists()) {
                    libDir = new java.io.File(libDir, "libs");
                }
                if (libDir != null && libDir.exists() && libDir.isDirectory()) {
                    java.io.File[] libs = libDir.listFiles((dir, name) -> name.endsWith(".jar"));
                    if (libs != null) {
                        for (java.io.File lib : libs) {
                            // Skip the main jar if it happens to be in the libs directory
                            if (lib.getAbsolutePath().equals(new java.io.File(jarPath).getAbsolutePath()))
                                continue;
                            urls.add(lib.toURI().toURL());
                        }
                        System.err.println(
                                "DEBUG: Discovered " + libs.length + " auxiliary libraries in libs/ directory.");
                    }
                }

                java.util.List<java.net.URL> compatUrls = parseCompatJarUrls(readEnv("HALO_COMPAT_JARS", ""));
                java.io.File mainSpiderJar = new java.io.File(jarPath);
                java.io.File fallbackJar = null;

                // 3. Resolve hint-specific fallback spider jar when needed.
                if (needsAnotherdsFallback(classHint)) {
                    fallbackJar = resolveAnotherdsFallbackJar(bridgeDir, jarPath);
                    if (fallbackJar != null) {
                        System.err.println("DEBUG: Resolved hint fallback jar for " + classHint + ": "
                                + fallbackJar.getAbsolutePath());
                    }
                }

                // 4. Add site runtime jars in the preferred order.
                if (fallbackJar != null && prefersAnotherdsPrimary(classHint)) {
                    urls.add(fallbackJar.toURI().toURL());
                    urls.add(mainSpiderJar.toURI().toURL());
                    System.err.println("DEBUG: Prioritizing anotherds runtime for " + classHint);
                } else {
                    urls.add(mainSpiderJar.toURI().toURL());
                    if (fallbackJar != null) {
                        urls.add(fallbackJar.toURI().toURL());
                    }
                }

                // Keep compat jars after the site jar so site-local runtimes win when both
                // define the same CatVod classes. Missing base classes still resolve here.
                urls.addAll(compatUrls);
            } catch (Throwable e) {
                System.err.println("DEBUG: Error discovering libs/fallbacks: " + e.getMessage());
            }

            Object spider;
            ClassLoader loader = null;
            boolean isJsBridge = jarPath.endsWith(".js");

            if (isJsBridge) {
                String jsContent = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(jarPath)), StandardCharsets.UTF_8);
                spider = new JSBridge(jsContent, readEnv("HALO_JS_RUNTIME_ROOT", ""));
                response.className = "com.halo.spider.JSBridge";
            } else {
                loader = new SpiderRuntimeClassLoader(
                        urls,
                        BridgeRunner.class.getClassLoader(),
                        collectPreferredBridgeClasses(classHint));
                /* legacy URLClassLoader override retained for reference
                    @Override
                    protected Class<?> findClass(String name) throws ClassNotFoundException {
                        try {
                            return super.findClass(name);
                        } catch (ClassFormatError | UnsatisfiedLinkError e) {
                            System.err.println(
                                    "DEBUG: Skipping malformed class (ClassFormatError): " + name + " 鈫?" + e.getMessage());
                            throw new ClassNotFoundException("Skipped due to ClassFormatError: " + name, e);
                        }
                    }
                }; */

                String className = pickSpiderClassName(jarPath, siteKey, classHint, loader);
                response.className = className;

                Class<?> spiderClass = Class.forName(className, true, loader);
                configureProxyRuntime(loader, proxyBaseUrl);
                Constructor<?> constructor = spiderClass.getDeclaredConstructor();
                constructor.setAccessible(true);
                spider = constructor.newInstance();
                seedSiteDefaults(spider, classHint, ext);
            }

            // Set context classloader so coerceArg can resolve Gson types from the spider JAR
            ClassLoader prevCtx = Thread.currentThread().getContextClassLoader();
            if (loader != null) {
                Thread.currentThread().setContextClassLoader(loader);
            }
            try {
                System.setProperty("http.agent", "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36");
                android.content.Context mockContext = new com.halo.spider.mock.MockContext(siteKey);
                invokeGlobalInit(loader, mockContext);
                BridgeRuntimeSetup.ensureDesktopRuntimeFiles(mockContext);
                ensureMergeC0HttpRuntime(loader);
                ensureMergeHttpRuntime(loader);
                BridgeRuntimeSetup.ensureMergeFmHttpRuntime(loader);
                BridgeRuntimeSetup.ensureMergeKHttpRuntime(loader);
                BridgeRuntimeSetup.ensureMergeE0HttpRuntime(loader);
                BridgeRuntimeSetup.ensureMergeA0HttpRuntime(loader);
                ensureMergeZzHttpRuntime(loader);
                invokeInitApi(spider);
                invokeInit(spider, mockContext, ext, isJsBridge);
                invokePrecallMethods(spider, readEnv("HALO_PRECALL_METHODS", ""));

                String displayName = isJsBridge ? "JSBridge" : spider.getClass().getSimpleName();
                System.err.println("DEBUG: [Bridge] Invoking " + displayName + "." + method + "()");
                Object result = "init".equals(method) ? "" : invokeMethod(spider, method, callArgs);

                String resultStr = BridgeResultSerializer.serialize(result);

                response.ok = true;
                response.result = resultStr;
            } finally {
                Thread.currentThread().setContextClassLoader(prevCtx);
            }
        } catch (Throwable throwable) {
            response.ok = false;
            response.error = throwable.getClass().getName() + ": " + safeMessage(throwable);
            throwable.printStackTrace(System.err);
        }
        originalOut.println(">>HALO_RESPONSE<<" + response.toJson() + ">>HALO_RESPONSE<<");
    }

    static String safeMessage(Throwable throwable) {
        StringBuilder sb = new StringBuilder();
        Throwable current = throwable;
        int depth = 0;
        boolean hasJsonError = false;
        while (current != null && depth < 3) {
            String msg = current.getMessage();
            if (msg != null && !msg.isEmpty()) {
                if (sb.length() > 0)
                    sb.append(" -> ");
                sb.append(current.getClass().getSimpleName()).append(": ").append(msg);
                if (msg.contains("must begin with '{'")) {
                    hasJsonError = true;
                }
            }
            current = current.getCause();
            depth++;
        }
        if (sb.length() == 0) {
            return throwable.getClass().getSimpleName() + ": unknown error";
        }
        String finalMsg = sb.toString().replace('\n', ' ').replace('\r', ' ');
        if (hasJsonError) {
            return finalMsg + " | NOTE: Target API returned non-JSON (likely 403 Forbidden HTML).";
        }
        return finalMsg;
    }

    private static String readEnv(String key, String fallback) {
        String value = System.getenv(key);
        return value == null ? fallback : value;
    }

    private static boolean readEnvFlag(String key) {
        String value = readEnv(key, "").trim();
        return "1".equals(value) || "true".equalsIgnoreCase(value) || "yes".equalsIgnoreCase(value);
    }

    static List<java.net.URL> parseCompatJarUrls(String rawList) {
        if (rawList == null || rawList.trim().isEmpty()) {
            return Collections.emptyList();
        }

        List<java.net.URL> urls = new ArrayList<>();
        for (String entry : rawList.split(java.io.File.pathSeparator)) {
            String trimmed = entry == null ? "" : entry.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            try {
                urls.add(new java.io.File(trimmed).toURI().toURL());
            } catch (Throwable error) {
                System.err.println("DEBUG: Failed to add compat jar to URLClassLoader: " + trimmed + " -> "
                        + error.getMessage());
            }
        }
        return urls;
    }

    private static List<Object> readCallArgs() {
        int count = 0;
        try {
            count = Integer.parseInt(readEnv("HALO_ARG_COUNT", "0"));
        } catch (NumberFormatException ignored) {
            count = 0;
        }
        if (count <= 0) {
            return Collections.emptyList();
        }

        List<Object> result = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            String type = readEnv("HALO_ARG_" + i + "_TYPE", "null");
            String value = readEnv("HALO_ARG_" + i + "_VALUE", "");
            result.add(decodeArg(type, value));
        }
        return result;
    }

    static Object decodeArg(String type, String encoded) {
        switch (type) {
            case "null":
                return null;
            case "bool":
                return Boolean.parseBoolean(encoded);
            case "number":
                try {
                    if (encoded.contains(".")) {
                        return Double.parseDouble(encoded);
                    }
                    return Long.parseLong(encoded);
                } catch (NumberFormatException ignored) {
                    return 0L;
                }
            case "string":
                return encoded;
            case "list":
                return decodeList(encoded);
            case "map":
                return decodeMap(encoded);
            default:
                return encoded;
        }
    }

    private static List<String> decodeList(String encoded) {
        if (encoded == null || encoded.isEmpty()) {
            return new ArrayList<>();
        }
        String[] parts = encoded.split(",");
        List<String> out = new ArrayList<>(parts.length);
        for (String part : parts) {
            if (part == null || part.isEmpty()) {
                continue;
            }
            out.add(fromBase64(part));
        }
        return out;
    }

    private static Map<String, String> decodeMap(String encoded) {
        Map<String, String> out = new HashMap<>();
        if (encoded == null || encoded.isEmpty()) {
            return out;
        }
        String[] parts = encoded.split(",");
        for (String part : parts) {
            if (part == null || part.isEmpty()) {
                continue;
            }
            int splitAt = part.indexOf(':');
            if (splitAt <= 0 || splitAt >= part.length() - 1) {
                continue;
            }
            String k = fromBase64(part.substring(0, splitAt));
            String v = fromBase64(part.substring(splitAt + 1));
            if (!k.isEmpty()) {
                out.put(k, v);
            }
        }
        return out;
    }

    private static String fromBase64(String raw) {
        try {
            return new String(BASE64_DECODER.decode(raw), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return raw;
        }
    }

    private static String normalizeToken(String text) {
        if (text == null) {
            return "";
        }
        return text.replaceAll("[^A-Za-z0-9]", "").toLowerCase();
    }

    private static List<String> splitHints(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return Collections.emptyList();
        }
        String[] parts = raw.split("[,;|\\n\\r\\t ]+");
        List<String> out = new ArrayList<>();
        for (String part : parts) {
            if (part != null && !part.trim().isEmpty()) {
                out.add(part.trim());
            }
        }
        return out;
    }

    static String pickSpiderClassName(
            String jarPath,
            String siteKey,
            String classHint,
            ClassLoader loader)
            throws Exception {
        String token = normalizeToken(siteKey);

        classHint = remapPreferredClassHint(classHint);

        List<String> hintCandidates = splitHints(classHint);
        String preferredClassHint = classHint == null ? "" : classHint.trim();
        String preferredSimpleName = "";
        if (preferredClassHint.startsWith("csp_") && preferredClassHint.length() > 4) {
            preferredSimpleName = preferredClassHint.substring(4);
        }
        String bestClass = null;
        int bestScore = Integer.MIN_VALUE;
        List<String> allClassNames = new java.util.ArrayList<>();

        // Collect all JARs to scan: the primary JAR + everything in libs/
        List<File> jarsToScan = new ArrayList<>();
        jarsToScan.add(new File(jarPath));
        try {
            java.io.File bridgeFile = new java.io.File(
                    BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            jarsToScan.add(bridgeFile); // <--- Add self scanner for embedded spiders!
            java.io.File libsDir = new java.io.File(bridgeFile.getParentFile(), "libs");
            if (libsDir.exists() && libsDir.isDirectory()) {
                java.io.File[] libFiles = libsDir.listFiles((dir, name) -> name.endsWith(".jar"));
                if (libFiles != null) {
                    for (File f : libFiles)
                        jarsToScan.add(f);
                }
            }

            if (needsAnotherdsFallback(classHint)) {
                java.io.File fallbackJar = resolveAnotherdsFallbackJar(bridgeFile.getParentFile(), jarPath);
                if (fallbackJar != null) {
                    jarsToScan.add(fallbackJar);
                    System.err.println("DEBUG: Added hint fallback jar to class scan: " + fallbackJar.getAbsolutePath());
                }
            }
        } catch (Exception ignored) {
        }

        for (File jarFileObj : jarsToScan) {
            try (JarFile jarFile = new JarFile(jarFileObj)) {
                java.util.Enumeration<JarEntry> entries = jarFile.entries();
                while (entries.hasMoreElements()) {
                    JarEntry entry = entries.nextElement();
                    String name = entry.getName();
                    if (!name.endsWith(".class")) {
                        continue;
                    }
                    String className = name.substring(0, name.length() - 6).replace('/', '.');
                    allClassNames.add(className);

                    int sep = className.lastIndexOf('.');
                    String simpleByName = sep >= 0 ? className.substring(sep + 1) : className;

                    // If classHint already points to an exact class, trust it first.
                    if (!preferredClassHint.isEmpty()) {
                        if (className.equalsIgnoreCase(preferredClassHint)
                                || (!preferredSimpleName.isEmpty()
                                        && simpleByName.equalsIgnoreCase(preferredSimpleName))) {
                            return className;
                        }
                    }

                    Class<?> cls;
                    try {
                        cls = Class.forName(className, false, loader);
                    } catch (Throwable ignored) {
                        continue;
                    }
                    if (cls.isInterface() || Modifier.isAbstract(cls.getModifiers())) {
                        continue;
                    }

                    int score = 0;
                    String simpleName;
                    try {
                        simpleName = cls.getSimpleName();
                    } catch (Throwable t) {
                        continue;
                    }
                    String simpleToken = normalizeToken(simpleName);

                    for (String hint : hintCandidates) {
                        if (className.equalsIgnoreCase(hint) || simpleName.equalsIgnoreCase(hint)) {
                            score += 10000;
                        } else if (hint.startsWith("csp_") && simpleName.equalsIgnoreCase(hint.substring(4))) {
                            score += 8000;
                        } else {
                            String hintToken = normalizeToken(hint);
                            if (!hintToken.isEmpty()) {
                                if (normalizeToken(className).contains(hintToken) || simpleToken.contains(hintToken)) {
                                    score += 500;
                                }
                            }
                        }
                    }

                    if (!token.isEmpty()) {
                        if (simpleToken.equals(token)) {
                            score += 2000;
                        } else if (simpleToken.contains(token) || token.contains(simpleToken)) {
                            score += 800;
                        }
                    }

                    try {
                        Class<?> spiderInterface = Class.forName("com.github.catvod.crawler.Spider", false, loader);
                        if (spiderInterface.isAssignableFrom(cls)) {
                            score += 1000;
                        }
                    } catch (Throwable ignored) {
                    }
                    if (className.contains("$")) {
                        score -= 500;
                    }
                    if (className.contains(".spider.")) {
                        score += 100;
                    }

                    if (score > bestScore) {
                        bestScore = score;
                        bestClass = className;
                    }
                }
            } catch (Exception e) {
                // Ignore jar scanning exceptions internally
            }
        }

        if (bestClass == null || bestClass.isEmpty()) {
            if (siteKey != null && (siteKey.endsWith(".js") || (classHint != null && classHint.endsWith(".js")))) {
                for (String name : allClassNames) {
                    if (name.endsWith("Drupy") || name.endsWith("AppJs")) {
                        return name;
                    }
                }
            }
        }

        if (bestClass == null || bestClass.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            sb.append("no spider class matched key: ").append(siteKey).append("\nAvailable classes:\n");
            for (int i = 0; i < Math.min(10, allClassNames.size()); i++) {
                sb.append(" - ").append(allClassNames.get(i)).append("\n");
            }
            if (allClassNames.size() > 10)
                sb.append(" ... and ").append(allClassNames.size() - 10).append(" more");
            throw new IllegalStateException(sb.toString());
        }

        // When a specific csp_XXX class was requested but no class matched by name
        // (bestScore < 8000 means only the generic Spider-interface bonus was scored),
        // throw "not found" rather than silently returning AppYsV2 or another unrelated class.
        if (!preferredClassHint.isEmpty()
                && preferredClassHint.toLowerCase().startsWith("csp_")
                && bestScore < 8000) {
            throw new IllegalStateException("no spider class matched key: " + siteKey
                    + " (hint=" + preferredClassHint + " not found in JAR; bestScore=" + bestScore + ")");
        }

        return bestClass;
    }

    static boolean needsAnotherdsFallback(String classHint) {
        if (classHint == null) {
            return false;
        }
        String lower = classHint.toLowerCase();
        return lower.contains("apprj")
                || lower.contains("appget")
                || lower.contains("appnox")
                || lower.contains("appqi")
                || lower.contains("appys")
                || lower.contains("appysv2")
                || lower.contains("hxq")
                || lower.contains("jianpian")
                || lower.contains("jpian")
                || lower.contains("douban")
                || lower.contains("ygp")
                || lower.contains("config")
                || lower.contains("localfile")
                || lower.contains("bili")
                || lower.contains("biliys")
                || lower.contains("wwys")
                || lower.contains("saohuo")
                || lower.contains("gz360")
                || lower.contains("liteapple")
                || lower.contains("czsapp")
                || lower.contains("sp360")
                || lower.contains("kugou")
                || lower.contains("xbpq");
    }

    private static String remapPreferredClassHint(String classHint) {
        if (classHint == null) {
            return null;
        }

        String lowerHint = classHint.toLowerCase();
        if (lowerHint.contains("appfox") || lowerHint.contains("appnox")) {
            return "csp_AppYsV2";
        }
        if (lowerHint.contains("jianpian") || lowerHint.contains("jpianamns")) {
            return "com.github.catvod.spider.JianPian";
        }
        return classHint;
    }

    static boolean prefersAnotherdsPrimary(String classHint) {
        if (classHint == null) {
            return false;
        }
        String lower = classHint.toLowerCase();
        return lower.contains("hxq");
    }

    private static boolean shouldLoadCatvodRuntimeFirst(String name) {
        return name != null
                && (name.startsWith("com.github.catvod.spider.")
                        || name.startsWith("com.github.catvod.crawler.")
                        || name.startsWith("com.github.catvod.net.")
                        || name.startsWith("com.github.catvod.bean.")
                        || name.startsWith("com.github.catvod.utils."));
    }

    static java.util.Set<String> collectPreferredBridgeClasses(String classHint) {
        if (classHint == null || classHint.trim().isEmpty()) {
            return java.util.Collections.emptySet();
        }

        java.util.LinkedHashSet<String> preferred = new java.util.LinkedHashSet<>();
        String lower = classHint.toLowerCase();
        if (needsAnotherdsFallback(classHint) || lower.contains("xbpq")) {
            preferred.add("com.github.catvod.spider.Init");
        }
        if (lower.contains("hxq")) {
            preferred.add("com.github.catvod.crawler.Spider");
            preferred.add("com.github.catvod.spider.BaseSpiderAmns");
        }
        if (usesMergeFmHttpRuntimeCompat(lower)) {
            preferred.add("com.github.catvod.spider.merge.FM.m.c");
        }
        if (lower.contains("douban")) {
            preferred.add("com.github.catvod.spider.merge.k.c");
            preferred.add("com.github.catvod.spider.merge.k.d");
        }
        if (usesAppHttpRuntimeCompat(lower)) {
            preferred.add("com.github.catvod.spider.merge.k.c");
            preferred.add("com.github.catvod.spider.merge.k.d");
        }
        if (usesAppCryptoRuntimeCompat(lower)) {
            preferred.add("com.github.catvod.spider.merge.m.a");
        }
        if (usesAppMergeCModelCompat(lower)) {
            preferred.add("com.github.catvod.spider.merge.c.a");
            preferred.add("com.github.catvod.spider.merge.c.e");
        }
        if (usesAppA0RuntimeCompat(lower)) {
            preferred.add("com.github.catvod.spider.merge.A0.yi");
        }
        if (lower.contains("biliys")) {
            preferred.add("com.github.catvod.crawler.Spider");
            preferred.add("com.github.catvod.spider.Spider");
            preferred.add("com.github.catvod.spider.merge.E0.d.c");
            preferred.add("com.github.catvod.spider.merge.E0.d.d");
            preferred.add("com.github.catvod.spider.merge.E0.d.e");
        }
        if (lower.contains("jianpian") || lower.contains("jpian")) {
            preferred.add("com.github.catvod.spider.merge.A.h");
            preferred.add("com.github.catvod.spider.merge.A.i");
            preferred.add("com.github.catvod.spider.merge.J.b");
            preferred.add("com.github.catvod.spider.merge.J.i");
            preferred.add("com.github.catvod.spider.merge.b0.h");
            preferred.add("com.github.catvod.spider.merge.b0.i");
        }
        return preferred;
    }

    private static boolean usesAppHttpRuntimeCompat(String lower) {
        return lower != null
                && (lower.contains("appget")
                        || lower.contains("app3q")
                        || lower.contains("appjg")
                        || lower.contains("appqi"));
    }

    private static boolean usesAppCryptoRuntimeCompat(String lower) {
        return lower != null
                && (lower.contains("appget")
                        || lower.contains("app3q")
                        || lower.contains("appjg")
                        || lower.contains("appqi"));
    }

    private static boolean usesMergeFmHttpRuntimeCompat(String lower) {
        return lower != null
                && (lower.contains("douban")
                        || lower.contains("ygp"));
    }

    private static boolean usesAppMergeCModelCompat(String lower) {
        return lower != null
                && (lower.contains("app3q")
                        || lower.contains("appjg")
                        || lower.contains("appqi")
                        || lower.contains("apprj")
                        || lower.contains("hxq"));
    }

    private static boolean usesAppA0RuntimeCompat(String lower) {
        return lower != null
                && (lower.contains("appysv2")
                        || lower.contains("appfox")
                        || lower.contains("appnox"));
    }

    private static boolean shouldPreferBridgeOverride(String name, java.util.Set<String> preferredBridgeClasses) {
        return name != null && preferredBridgeClasses != null && preferredBridgeClasses.contains(name);
    }

    static void invokeGlobalInit(ClassLoader loader, android.content.Context context) {
        if (loader == null || context == null) {
            return;
        }

        try {
            Class<?> initClass = Class.forName("com.github.catvod.spider.Init", true, loader);
            ensureInitSingleton(initClass, context);
            Method[] methods = initClass.getMethods();
            for (Method method : methods) {
                if (!Modifier.isStatic(method.getModifiers()) || !"init".equals(method.getName())) {
                    continue;
                }

                Class<?>[] params = method.getParameterTypes();
                if (params.length == 1 && isContextLikeType(params[0]) && params[0].isInstance(context)) {
                    method.setAccessible(true);
                    method.invoke(null, context);
                    System.err.println("DEBUG: invokeGlobalInit matched Init.init(" + params[0].getSimpleName() + ")");
                    return;
                }

                if (params.length == 0) {
                    method.setAccessible(true);
                    method.invoke(null);
                    System.err.println("DEBUG: invokeGlobalInit matched Init.init()");
                    return;
                }
            }
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: invokeGlobalInit failed: " + error.getMessage());
            error.printStackTrace(System.err);
        }
    }

    private static void ensureInitSingleton(Class<?> initClass, android.content.Context context) {
        if (initClass == null) {
            return;
        }

        try {
            Method getMethod = initClass.getMethod("get");
            getMethod.setAccessible(true);
            Object current = getMethod.invoke(null);
            Object instance = current;
            if (instance == null) {
                Constructor<?> constructor = initClass.getDeclaredConstructor();
                constructor.setAccessible(true);
                instance = constructor.newInstance();
            }

            for (Class<?> holderClass : collectInitHolderClasses(initClass)) {
                for (java.lang.reflect.Field field : holderClass.getDeclaredFields()) {
                    if (!Modifier.isStatic(field.getModifiers()) || !field.getType().isAssignableFrom(initClass)) {
                        continue;
                    }
                    field.setAccessible(true);
                    if (field.get(null) == null) {
                        field.set(null, instance);
                        System.err.println("DEBUG: Seeded Init singleton via " + holderClass.getName() + "." + field.getName());
                    }
                    break;
                }
            }

            seedInitRuntimeFields(initClass, instance, context);
        } catch (NoSuchMethodException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureInitSingleton failed: " + error.getMessage());
        }
    }

    private static void seedInitRuntimeFields(Class<?> initClass, Object instance, android.content.Context context) {
        if (initClass == null || instance == null || context == null) {
            return;
        }

        try {
            ClassLoader loader = initClass.getClassLoader();
            Class<?> handlerClass = Class.forName("android.os.Handler", true, loader);
            Class<?> looperClass = Class.forName("android.os.Looper", true, loader);
            Class<?> applicationClass = Class.forName("android.app.Application", true, loader);
            Class<?> atomicBooleanClass = Class.forName("java.util.concurrent.atomic.AtomicBoolean", false, loader);
            Class<?> executorServiceClass = Class.forName("java.util.concurrent.ExecutorService", false, loader);

            Method mainLooperMethod = looperClass.getMethod("getMainLooper");
            Object mainLooper = mainLooperMethod.invoke(null);
            Constructor<?> handlerCtor = handlerClass.getDeclaredConstructor(looperClass);
            handlerCtor.setAccessible(true);
            Object handler = handlerCtor.newInstance(mainLooper);

            for (java.lang.reflect.Field field : initClass.getDeclaredFields()) {
                field.setAccessible(true);
                if (field.get(instance) != null) {
                    continue;
                }

                Class<?> fieldType = field.getType();
                if (fieldType == handlerClass) {
                    field.set(instance, handler);
                    System.err.println("DEBUG: Seeded Init handler via field " + field.getName());
                    continue;
                }
                if (applicationClass.isAssignableFrom(fieldType) && fieldType.isInstance(context)) {
                    field.set(instance, context);
                    System.err.println("DEBUG: Seeded Init application via field " + field.getName());
                    continue;
                }
                if (fieldType == atomicBooleanClass) {
                    field.set(instance, new java.util.concurrent.atomic.AtomicBoolean(false));
                    continue;
                }
                if (fieldType == executorServiceClass) {
                    field.set(instance, java.util.concurrent.Executors.newCachedThreadPool());
                }
            }
        } catch (Throwable error) {
            System.err.println("DEBUG: seedInitRuntimeFields failed: " + error.getMessage());
        }
    }

    private static List<Class<?>> collectInitHolderClasses(Class<?> initClass) {
        List<Class<?>> holders = new ArrayList<>();
        try {
            holders.add(Class.forName(initClass.getName() + "$Loader", false, initClass.getClassLoader()));
        } catch (Throwable ignored) {
        }
        try {
            Class<?>[] declared = initClass.getDeclaredClasses();
            if (declared != null) {
                for (Class<?> nested : declared) {
                    holders.add(nested);
                }
            }
        } catch (Throwable ignored) {
        }
        return holders;
    }

    static void ensureMergeHttpRuntime(ClassLoader loader) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> holderClass = Class.forName("com.github.catvod.spider.merge.b0.b", true, loader);
            Class<?> runtimeClass = Class.forName("com.github.catvod.spider.merge.b0.d", true, loader);
            java.lang.reflect.Field holderField = null;
            for (java.lang.reflect.Field field : holderClass.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && runtimeClass.isAssignableFrom(field.getType())) {
                    holderField = field;
                    break;
                }
            }
            if (holderField == null) {
                return;
            }

            holderField.setAccessible(true);
            Object existing = holderField.get(null);
            if (existing != null) {
                return;
            }

            Constructor<?> runtimeCtor = runtimeClass.getDeclaredConstructor();
            runtimeCtor.setAccessible(true);
            Object runtime = runtimeCtor.newInstance();
            Object client = buildRuntimeOkHttpClient(loader);
            if (client == null) {
                return;
            }

            for (java.lang.reflect.Field field : runtimeClass.getDeclaredFields()) {
                if (!"okhttp3.OkHttpClient".equals(field.getType().getName())) {
                    continue;
                }
                field.setAccessible(true);
                if (field.get(runtime) == null) {
                    field.set(runtime, client);
                }
            }

            holderField.set(null, runtime);
            System.err.println("DEBUG: Seeded merge.b0 runtime via " + holderClass.getName() + "." + holderField.getName());
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureMergeHttpRuntime failed: " + error.getMessage());
        }
    }

    static void ensureMergeC0HttpRuntime(ClassLoader loader) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> holderClass = Class.forName("com.github.catvod.spider.merge.C0.h.a", true, loader);
            Class<?> runtimeClass = Class.forName("com.github.catvod.spider.merge.C0.h.b", true, loader);
            java.lang.reflect.Field holderField = null;
            for (java.lang.reflect.Field field : holderClass.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && runtimeClass.isAssignableFrom(field.getType())) {
                    holderField = field;
                    break;
                }
            }
            if (holderField == null) {
                return;
            }

            holderField.setAccessible(true);
            if (holderField.get(null) != null) {
                return;
            }

            Constructor<?> runtimeCtor = runtimeClass.getDeclaredConstructor();
            runtimeCtor.setAccessible(true);
            Object runtime = runtimeCtor.newInstance();
            Object client = buildRuntimeOkHttpClient(loader);
            if (client == null) {
                return;
            }

            for (java.lang.reflect.Field field : runtimeClass.getDeclaredFields()) {
                if (!"okhttp3.OkHttpClient".equals(field.getType().getName())) {
                    continue;
                }
                field.setAccessible(true);
                if (field.get(runtime) == null) {
                    field.set(runtime, client);
                }
            }

            holderField.set(null, runtime);
            System.err.println("DEBUG: Seeded merge.C0 runtime via " + holderClass.getName() + "." + holderField.getName());
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureMergeC0HttpRuntime failed: " + error.getMessage());
        }
    }

    static void ensureMergeZzHttpRuntime(ClassLoader loader) {
        if (loader == null) {
            return;
        }

        try {
            Class<?> holderClass = Class.forName("com.github.catvod.spider.merge.zz.l", true, loader);
            Class<?> runtimeClass = Class.forName("com.github.catvod.spider.merge.zz.m", true, loader);
            java.lang.reflect.Field holderField = null;
            for (java.lang.reflect.Field field : holderClass.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) && runtimeClass.isAssignableFrom(field.getType())) {
                    holderField = field;
                    break;
                }
            }
            if (holderField == null) {
                return;
            }

            holderField.setAccessible(true);
            if (holderField.get(null) != null) {
                return;
            }

            Constructor<?> runtimeCtor = runtimeClass.getDeclaredConstructor();
            runtimeCtor.setAccessible(true);
            Object runtime = runtimeCtor.newInstance();
            Object client = buildRuntimeOkHttpClient(loader);
            if (client != null) {
                for (java.lang.reflect.Field field : runtimeClass.getDeclaredFields()) {
                    if (!"okhttp3.OkHttpClient".equals(field.getType().getName())) {
                        continue;
                    }
                    field.setAccessible(true);
                    if (field.get(runtime) == null) {
                        field.set(runtime, client);
                    }
                }
            }
            holderField.set(null, runtime);
            System.err.println("DEBUG: Seeded merge.zz runtime via " + holderClass.getName() + "." + holderField.getName());
        } catch (ClassNotFoundException ignored) {
        } catch (Throwable error) {
            System.err.println("DEBUG: ensureMergeZzHttpRuntime failed: " + error.getMessage());
        }
    }

    static void seedSiteDefaults(Object spider, String classHint, String ext) {
        BridgeSiteStateSeeder.seedDefaults(spider, classHint, ext);
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
            invokeBuilderMethod(builderClass, builder, "connectTimeout",
                    new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);
            invokeBuilderMethod(builderClass, builder, "readTimeout",
                    new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);
            invokeBuilderMethod(builderClass, builder, "writeTimeout",
                    new Class<?>[] { long.class, timeUnitClass }, 15L, seconds);

            Method buildMethod = builderClass.getMethod("build");
            buildMethod.setAccessible(true);
            return buildMethod.invoke(builder);
        } catch (Throwable error) {
            System.err.println("DEBUG: buildRuntimeOkHttpClient failed: " + error.getMessage());
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

    static void invokeInitApi(Object spider) throws Exception {
        if (spider == null) {
            return;
        }

        Method initApiMethod = null;
        for (Method method : spider.getClass().getMethods()) {
            if ("initApi".equals(method.getName()) && method.getParameterCount() == 1) {
                initApiMethod = method;
                break;
            }
        }

        if (initApiMethod == null) {
            return;
        }

        Object spiderApi = instantiateSpiderApi(initApiMethod.getParameterTypes()[0], spider.getClass().getClassLoader());
        if (spiderApi == null) {
            System.err.println("DEBUG: invokeInitApi skipped because SpiderApi could not be instantiated.");
            return;
        }

        initApiMethod.setAccessible(true);
        initApiMethod.invoke(spider, spiderApi);
    }

    private static Object instantiateSpiderApi(Class<?> spiderApiType, ClassLoader loader) {
        if (spiderApiType == null) {
            return null;
        }

        String hostPort = resolveSpiderHostPort(loader);

        try {
            Constructor<?> constructor = spiderApiType.getDeclaredConstructor(String.class);
            constructor.setAccessible(true);
            return constructor.newInstance(hostPort);
        } catch (Throwable ignored) {
        }

        try {
            Constructor<?> constructor = spiderApiType.getDeclaredConstructor();
            constructor.setAccessible(true);
            return constructor.newInstance();
        } catch (Throwable ignored) {
        }

        return null;
    }

    private static String resolveSpiderHostPort(ClassLoader loader) {
        for (ClassLoader candidate : new ClassLoader[] { loader, BridgeRunner.class.getClassLoader() }) {
            if (candidate == null) {
                continue;
            }

            try {
                Class<?> proxyClass = Class.forName("com.github.catvod.spider.Proxy", true, candidate);
                for (String methodName : new String[] { "getHostPort", "hostPort", "getAddress" }) {
                    try {
                        Method method = proxyClass.getMethod(methodName);
                        method.setAccessible(true);
                        Object value = method.invoke(null);
                        if (value instanceof String) {
                            String hostPort = ((String) value).trim();
                            if (!hostPort.isEmpty()) {
                                return hostPort;
                            }
                        }
                    } catch (NoSuchMethodException ignored) {
                    }
                }
            } catch (Throwable ignored) {
            }
        }

        return "http://127.0.0.1:9966";
    }

    static void configureProxyRuntime(ClassLoader loader, String proxyBaseUrl) {
        if (proxyBaseUrl == null || proxyBaseUrl.trim().isEmpty()) {
            return;
        }

        int proxyPort = 9966;
        try {
            java.net.URI uri = java.net.URI.create(proxyBaseUrl);
            if (uri.getPort() > 0) {
                proxyPort = uri.getPort();
            }
        } catch (Throwable ignored) {
        }

        for (String className : new String[] {
                "com.github.catvod.spider.Proxy",
                "com.github.catvod.Proxy"
        }) {
            try {
                Class<?> proxyClass = Class.forName(className, true, loader);
                try {
                    Method method = proxyClass.getMethod("setHostPort", String.class);
                    method.setAccessible(true);
                    method.invoke(null, proxyBaseUrl);
                } catch (Throwable ignored) {
                }
                try {
                    Method method = proxyClass.getMethod("set", int.class);
                    method.setAccessible(true);
                    method.invoke(null, proxyPort);
                } catch (Throwable ignored) {
                }
            } catch (Throwable ignored) {
            }
        }
    }

    static File resolveAnotherdsFallbackJar(File bridgeDir, String jarPath) {
        String hintedPath = readEnv("HALO_FALLBACK_JAR", "").trim();
        if (!hintedPath.isEmpty()) {
            File hinted = new File(hintedPath);
            if (hinted.isFile()) {
                return hinted;
            }
        }

        List<File> candidates = new ArrayList<>();
        if (bridgeDir != null) {
            candidates.add(new File(new File(bridgeDir, "fallbacks"), "anotherds_spider.jar"));
        }

        if (jarPath != null && !jarPath.trim().isEmpty()) {
            File runningJar = new File(jarPath);
            File runningJarDir = runningJar.getParentFile();
            if (runningJarDir != null) {
                candidates.add(new File(new File(runningJarDir, "fallbacks"), "anotherds_spider.jar"));

                File maybeDebugDir = runningJarDir.getParentFile();
                if (maybeDebugDir != null) {
                    candidates.add(new File(new File(new File(new File(maybeDebugDir, "resources"), "jar"), "fallbacks"),
                            "anotherds_spider.jar"));
                }
            }
        }

        for (File file : candidates) {
            if (file != null && file.isFile()) {
                return file;
            }
        }
        return null;
    }

    private static boolean isContextLikeType(Class<?> type) {
        String name = type.getName();
        return "android.content.Context".equals(name)
                || "android.app.Application".equals(name)
                || name.endsWith(".Context");
    }

    static void invokeInit(Object spider, android.content.Context context, String ext, boolean isJsBridge) throws Exception {
        Method[] methods = spider.getClass().getMethods();
        List<Method> initMethods = new ArrayList<>();
        for (Method method : methods) {
            if ("init".equals(method.getName())) {
                initMethods.add(method);
            }
        }
        
        // Short-circuit for JSBridge
        if (isJsBridge || "com.halo.spider.JSBridge".equals(spider.getClass().getName())) {
            Method jsInit = spider.getClass().getMethod("init", android.content.Context.class, String.class);
            jsInit.setAccessible(true);
            jsInit.invoke(spider, context, ext);
            return;
        }

        if (initMethods.isEmpty()) {
            return;
        }

        Throwable lastError = null;

        // Pass 1: 2-param (Context, X) methods
        for (Method method : initMethods) {
            Class<?>[] params = method.getParameterTypes();
            if (params.length == 2 && isContextLikeType(params[0])) {
                try {
                    System.err.println("DEBUG: invokeInit Match Pass 1: init(Context, " + params[1].getSimpleName() + ")");
                    Object extArg = coerceArg(ext, params[1]);
                    method.setAccessible(true);
                    method.invoke(spider, new Object[] { context, extArg });
                    return;
                } catch (Throwable e) {
                    System.err.println("DEBUG: invokeInit Pass 1 failed for method " + method.getName());
                    e.printStackTrace(System.err);
                    lastError = e;
                }
            }
        }

        // Pass 2: 1-param non-Context methods 鈥?pass coerced ext
        for (Method method : initMethods) {
            Class<?>[] params = method.getParameterTypes();
            if (params.length == 1 && !isContextLikeType(params[0])) {
                try {
                    System.err.println("DEBUG: invokeInit Match Pass 2: init(" + params[0].getSimpleName() + ")");
                    String extToPass = (ext == null || ext.isEmpty()) ? "{}" : ext;
                    Object extArg = coerceArg(extToPass, params[0]);
                    method.setAccessible(true);
                    method.invoke(spider, new Object[] { extArg });
                    return;
                } catch (Throwable e) {
                    System.err.println("DEBUG: invokeInit Pass 2 failed for method " + method.getName());
                    e.printStackTrace(System.err);
                    lastError = e;
                }
            }
        }

        // Pass 3: 0-param init()
        for (Method method : initMethods) {
            if (method.getParameterCount() == 0) {
                try {
                    System.err.println("DEBUG: invokeInit Match Pass 3: init()");
                    method.setAccessible(true);
                    method.invoke(spider);
                    return;
                } catch (Throwable e) {
                    System.err.println("DEBUG: invokeInit Pass 3 failed for method " + method.getName());
                    e.printStackTrace(System.err);
                    lastError = e;
                }
            }
        }

        // Pass 4: init(Context)
        for (Method method : initMethods) {
            Class<?>[] params = method.getParameterTypes();
            if (params.length == 1 && isContextLikeType(params[0])) {
                try {
                    System.err.println("DEBUG: invokeInit Match Pass 4: init(Context)");
                    method.setAccessible(true);
                    method.invoke(spider, context);
                    return;
                } catch (Throwable e) {
                    System.err.println("DEBUG: invokeInit Pass 4 failed for method " + method.getName());
                    e.printStackTrace(System.err);
                    lastError = e;
                }
            }
        }

        if (lastError != null) {
            throw new RuntimeException("invoke init failed", lastError);
        }
        System.err.println("DEBUG: No init method found to invoke.");
    }

    static Object invokeMethod(Object spider, String methodName, List<Object> args)
            throws Exception {
        Method[] methods = spider.getClass().getMethods();
        List<Method> candidates = new ArrayList<>();
        for (Method method : methods) {
            if (methodName.equals(method.getName())) {
                candidates.add(method);
            }
        }
        if (candidates.isEmpty()) {
            throw new NoSuchMethodException("method not found: " + methodName);
        }

        candidates.sort(
                (a, b) -> Integer.compare(
                        Math.abs(a.getParameterCount() - args.size()),
                        Math.abs(b.getParameterCount() - args.size())));

        Throwable lastError = null;
        if (isContentMethod(methodName)) {
            Object preferred = App3QCompat.preferDirectContentIfNeeded(spider, methodName, args);
            if (preferred != null) {
                System.err.println(
                        "DEBUG: invokeMethod result type: "
                                + (preferred == null ? "null" : preferred.getClass().getName()));
                System.err.println(
                        "DEBUG: invokeMethod result value: ["
                                + (preferred == null ? "" : preferred.toString())
                                + "]");
                return preferred;
            }
        }
        for (Method method : candidates) {
            try {
                Object[] callValues = coerceArgs(method.getParameterTypes(), args.toArray());
                method.setAccessible(true);
                Object result = method.invoke(spider, callValues);
                if ("homeContent".equals(methodName)) {
                    result = AppGetCompat.recoverHomeContentIfNeeded(spider, result);
                    result = AppQiCompat.recoverHomeContentIfNeeded(spider, result);
                    result = YgpCompat.recoverHomeContentIfNeeded(spider, result);
                }
                if (isContentMethod(methodName)) {
                    result = App3QCompat.recoverContentIfNeeded(spider, methodName, args, result);
                }
                String bridgeHttpError = consumeBridgeHttpError(spider);
                if (isContentMethod(methodName)
                        && !bridgeHttpError.isEmpty()
                        && looksLikeEmptyPayload(result)) {
                    throw new RuntimeException("bridge HTTP runtime failure: " + bridgeHttpError);
                }
                System.err.println(
                        "DEBUG: invokeMethod result type: " + (result == null ? "null" : result.getClass().getName()));
                System.err.println(
                        "DEBUG: invokeMethod result value: [" + (result == null ? "" : result.toString()) + "]");
                return result;
            } catch (Throwable error) {
                lastError = error;
            }
        }
        if (lastError == null) {
            throw new RuntimeException("invoke method failed: " + methodName);
        }
        if (isContentMethod(methodName)) {
            Object recovered = App3QCompat.recoverContentAfterFailureIfNeeded(spider, methodName, args, lastError);
            if (recovered != null) {
                return recovered;
            }
        }
        throw new RuntimeException("invoke method failed: " + methodName, lastError);
    }

    private static boolean isContentMethod(String methodName) {
        return "homeContent".equals(methodName)
                || "categoryContent".equals(methodName)
                || "searchContent".equals(methodName)
                || "detailContent".equals(methodName)
                || "playerContent".equals(methodName);
    }

    private static boolean looksLikeEmptyPayload(Object result) {
        if (result == null) {
            return true;
        }
        if (!(result instanceof String)) {
            return false;
        }

        String payload = ((String) result).trim();
        if (payload.isEmpty() || "[]".equals(payload) || "{}".equals(payload)) {
            return true;
        }
        if (!payload.startsWith("{")) {
            return false;
        }

        try {
            JSONObject object = new JSONObject(payload);
            JSONArray classItems = object.optJSONArray("class");
            JSONArray listItems = object.optJSONArray("list");
            return (classItems == null || classItems.length() == 0)
                    && (listItems == null || listItems.length() == 0);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String consumeBridgeHttpError(Object spider) {
        if (spider == null) {
            return "";
        }

        for (String className : new String[] {
                "com.github.catvod.spider.merge.FM.m.c"
        }) {
            try {
                Class<?> runtimeClass = Class.forName(className, true, spider.getClass().getClassLoader());
                Method method = runtimeClass.getMethod("consumeLastError");
                method.setAccessible(true);
                Object value = method.invoke(null);
                if (value instanceof String) {
                    String text = ((String) value).trim();
                    if (!text.isEmpty()) {
                        return text;
                    }
                }
            } catch (Throwable ignored) {
            }
        }
        return "";
    }

    static void invokePrecallMethods(Object spider, String rawMethods) {
        if (rawMethods == null || rawMethods.trim().isEmpty()) {
            return;
        }

        for (String methodName : rawMethods.split(",")) {
            String trimmed = methodName == null ? "" : methodName.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            try {
                System.err.println("DEBUG: [Bridge] Precalling " + spider.getClass().getSimpleName() + "." + trimmed + "()");
                if ("homeContent".equals(trimmed)) {
                    invokeMethod(spider, trimmed, java.util.Collections.singletonList(Boolean.FALSE));
                } else {
                    invokeMethod(spider, trimmed, java.util.Collections.emptyList());
                }
            } catch (Throwable error) {
                System.err.println("DEBUG: precall " + trimmed + " failed: " + error.getMessage());
                error.printStackTrace(System.err);
            }
        }
    }

    private static Object[] coerceArgs(Class<?>[] parameterTypes, Object[] sourceArgs) {
        Object[] out = new Object[parameterTypes.length];
        for (int i = 0; i < parameterTypes.length; i++) {
            Object raw = i < sourceArgs.length ? sourceArgs[i] : null;
            out[i] = coerceArg(raw, parameterTypes[i]);
        }
        return out;
    }

    private static Object coerceArg(Object raw, Class<?> targetType) {
        if (targetType == null) {
            return raw;
        }
        if ("android.content.Context".equals(targetType.getName())) {
            return null;
        }
        if (raw == null) {
            if (targetType == boolean.class || targetType == Boolean.class) {
                return Boolean.FALSE;
            }
            if (targetType == int.class ||
                    targetType == Integer.class ||
                    targetType == long.class ||
                    targetType == Long.class) {
                return 0;
            }
            if (List.class.isAssignableFrom(targetType)) {
                return new ArrayList<>();
            }
            if (Map.class.isAssignableFrom(targetType)) {
                return new HashMap<>();
            }
            return null;
        }
        if (targetType.isInstance(raw)) {
            return raw;
        }
        if (targetType == String.class) {
            return String.valueOf(raw);
        }
        if (targetType == boolean.class || targetType == Boolean.class) {
            return Boolean.parseBoolean(String.valueOf(raw));
        }
        if (targetType == int.class || targetType == Integer.class) {
            try {
                return Integer.parseInt(String.valueOf(raw));
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }
        if (targetType == long.class || targetType == Long.class) {
            try {
                return Long.parseLong(String.valueOf(raw));
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }
        if (List.class.isAssignableFrom(targetType)) {
            if (raw instanceof List) {
                return raw;
            }
            List<String> wrapped = new ArrayList<>();
            wrapped.add(String.valueOf(raw));
            return wrapped;
        }
        if (Map.class.isAssignableFrom(targetType)) {
            if (raw instanceof Map) {
                return raw;
            }
            return new HashMap<>();
        }
        // Handle Gson JsonObject / JsonElement: parse String via context classloader
        String targetTypeName = targetType.getName();
        if (("com.google.gson.JsonObject".equals(targetTypeName)
                || "com.google.gson.JsonElement".equals(targetTypeName))
                && raw instanceof String) {
            String jsonStr = (String) raw;
            try {
                ClassLoader ctx = Thread.currentThread().getContextClassLoader();
                if (ctx == null) ctx = targetType.getClassLoader();
                // JsonParser.parseString(jsonStr)
                Class<?> jsonParserClass = Class.forName("com.google.gson.JsonParser", true, ctx);
                java.lang.reflect.Method parseString = jsonParserClass.getMethod("parseString", String.class);
                Object jsonElement = parseString.invoke(null, jsonStr.isEmpty() ? "{}" : jsonStr);
                if ("com.google.gson.JsonObject".equals(targetTypeName)) {
                    java.lang.reflect.Method getAsJsonObject = jsonElement.getClass().getMethod("getAsJsonObject");
                    return getAsJsonObject.invoke(jsonElement);
                }
                return jsonElement;
            } catch (Throwable e) {
                System.err.println("DEBUG: coerceArg: failed to parse Gson type from String: " + e.getMessage());
                return null;
            }
        }
        return raw;
    }

    private static String escapeJson(String input) {
        if (input == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(input.length() + 16);
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }
}

