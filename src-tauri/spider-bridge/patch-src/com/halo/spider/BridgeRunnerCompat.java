package com.halo.spider;

import android.app.Application;

import java.io.File;
import java.io.PrintStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public final class BridgeRunnerCompat {
    private static final Base64.Decoder BASE64_DECODER = Base64.getDecoder();
    private static final Map<String, List<String>> EXPLICIT_HINT_ALIASES = buildExplicitHintAliases();

    private BridgeRunnerCompat() {
    }

    public static void main(String[] ignoredArgs) {
        PrintStream originalOut = System.out;
        System.setOut(System.err);

        boolean ok = false;
        String className = "";
        String result = "";
        String error = "";

        try {
            String jarPath = readEnv("HALO_JAR_PATH", "");
            String siteKey = readEnv("HALO_SITE_KEY", "");
            String classHint = readEnv("HALO_CLASS_HINT", "");
            String ext = readEnv("HALO_EXT", "");
            String method = readEnv("HALO_METHOD", "").trim();
            List<Object> args = readCallArgs();

            if (jarPath.isEmpty()) {
                throw new IllegalArgumentException("HALO_JAR_PATH is empty");
            }
            if (method.isEmpty()) {
                throw new IllegalArgumentException("HALO_METHOD is empty");
            }

            ClassLoader loader = buildSpiderClassLoader(jarPath, classHint);
            className = pickSpiderClassName(jarPath, siteKey, classHint, loader);
            Class<?> spiderClass = Class.forName(className, true, loader);

            ClassLoader previousLoader = Thread.currentThread().getContextClassLoader();
            Thread.currentThread().setContextClassLoader(loader);
            try {
                result = executeWithBestInit(spiderClass, ext, method, args);
                ok = true;
            } finally {
                Thread.currentThread().setContextClassLoader(previousLoader);
            }
        } catch (Throwable throwable) {
            Throwable unwrapped = unwrapThrowable(throwable);
            error = unwrapped.getClass().getName() + ": " + safeMessage(unwrapped);
            unwrapped.printStackTrace(System.err);
        }

        originalOut.println(
            ">>HALO_RESPONSE<<" + toJson(ok, className, result, error) + ">>HALO_RESPONSE<<"
        );
    }

    private static String toJson(boolean ok, String className, String result, String error) {
        return "{"
            + "\"ok\":" + ok + ","
            + "\"className\":\"" + escapeJson(className) + "\","
            + "\"result\":\"" + escapeJson(result) + "\","
            + "\"error\":\"" + escapeJson(error) + "\""
            + "}";
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder builder = new StringBuilder(value.length() + 16);
        for (int index = 0; index < value.length(); index++) {
            char ch = value.charAt(index);
            switch (ch) {
                case '\\':
                    builder.append("\\\\");
                    break;
                case '"':
                    builder.append("\\\"");
                    break;
                case '\n':
                    builder.append("\\n");
                    break;
                case '\r':
                    builder.append("\\r");
                    break;
                case '\t':
                    builder.append("\\t");
                    break;
                default:
                    if (ch < 0x20) {
                        builder.append(String.format("\\u%04x", (int) ch));
                    } else {
                        builder.append(ch);
                    }
                    break;
            }
        }
        return builder.toString();
    }

    private static String readEnv(String key, String fallback) {
        String value = System.getenv(key);
        return value == null ? fallback : value;
    }

    private static List<Object> readCallArgs() {
        int count;
        try {
            count = Integer.parseInt(readEnv("HALO_ARG_COUNT", "0"));
        } catch (NumberFormatException ignored) {
            count = 0;
        }
        if (count <= 0) {
            return Collections.emptyList();
        }
        List<Object> args = new ArrayList<>(count);
        for (int index = 0; index < count; index++) {
            String type = readEnv("HALO_ARG_" + index + "_TYPE", "null");
            String value = readEnv("HALO_ARG_" + index + "_VALUE", "");
            args.add(decodeArg(type, value));
        }
        return args;
    }

    private static Object decodeArg(String type, String value) {
        switch (type) {
            case "null":
                return null;
            case "bool":
                return Boolean.parseBoolean(value);
            case "number":
                try {
                    return value.contains(".") ? Double.parseDouble(value) : Long.parseLong(value);
                } catch (NumberFormatException ignored) {
                    return 0L;
                }
            case "string":
                return value;
            case "list":
                return decodeList(value);
            case "map":
                return decodeMap(value);
            default:
                return value;
        }
    }

    private static List<String> decodeList(String value) {
        if (value == null || value.isEmpty()) {
            return new ArrayList<>();
        }
        String[] parts = value.split(",");
        List<String> out = new ArrayList<>(parts.length);
        for (String part : parts) {
            if (part != null && !part.isEmpty()) {
                out.add(fromBase64(part));
            }
        }
        return out;
    }

    private static Map<String, String> decodeMap(String value) {
        Map<String, String> out = new HashMap<>();
        if (value == null || value.isEmpty()) {
            return out;
        }
        String[] parts = value.split(",");
        for (String part : parts) {
            if (part == null || part.isEmpty()) {
                continue;
            }
            int splitAt = part.indexOf(':');
            if (splitAt <= 0 || splitAt >= part.length() - 1) {
                continue;
            }
            String key = fromBase64(part.substring(0, splitAt));
            String itemValue = fromBase64(part.substring(splitAt + 1));
            if (!key.isEmpty()) {
                out.put(key, itemValue);
            }
        }
        return out;
    }

    private static String fromBase64(String value) {
        try {
            return new String(BASE64_DECODER.decode(value), StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return value;
        }
    }

    private static ClassLoader buildSpiderClassLoader(String jarPath, String classHint) throws Exception {
        List<URL> urls = new ArrayList<>();
        File bridgeFile = new File(BridgeRunnerCompat.class.getProtectionDomain().getCodeSource().getLocation().toURI());
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
                    if (!lib.getAbsolutePath().equals(new File(jarPath).getAbsolutePath())) {
                        urls.add(lib.toURI().toURL());
                    }
                }
            }
        }

        urls.add(new File(jarPath).toURI().toURL());

        if (needsAnotherdsFallback(classHint)) {
            File fallbackJar = resolveAnotherdsFallbackJar(bridgeDir, jarPath);
            if (fallbackJar != null) {
                urls.add(fallbackJar.toURI().toURL());
            }
        }

        return new URLClassLoader(urls.toArray(new URL[0]), BridgeRunnerCompat.class.getClassLoader());
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

    private static Map<String, List<String>> buildExplicitHintAliases() {
        Map<String, List<String>> aliases = new HashMap<>();
        aliases.put("cspgoconfigamnsr", Collections.singletonList("Danmu"));
        aliases.put("cspdouban", java.util.Arrays.asList("DouBan", "Douban"));
        aliases.put("cspconfigcenter", Collections.singletonList("ConfigCenter"));
        aliases.put("csptgyundoubanpan", Collections.singletonList("TgYunDouBanPan"));
        aliases.put("cspguazi", Collections.singletonList("GuaZi"));
        aliases.put("cspttian", Collections.singletonList("TTian"));
        aliases.put("cspjpys", Collections.singletonList("Jpys"));
        aliases.put("cspqiji", Collections.singletonList("Qiji"));
        aliases.put("cspqiao2", Collections.singletonList("qiao2"));
        aliases.put("cspxdai", Collections.singletonList("Xdai"));
        return Collections.unmodifiableMap(aliases);
    }

    private static List<String> expandHintCandidates(String raw) {
        LinkedHashSet<String> out = new LinkedHashSet<>(splitHints(raw));
        List<String> base = new ArrayList<>(out);
        for (String hint : base) {
            String normalized = normalizeToken(hint);
            if (normalized.isEmpty()) {
                continue;
            }
            List<String> aliases = EXPLICIT_HINT_ALIASES.get(normalized);
            if (aliases != null) {
                out.addAll(aliases);
            }
            if (hint.startsWith("csp_") && hint.length() > 4) {
                out.add(hint.substring(4));
            }
        }
        return new ArrayList<>(out);
    }

    private static boolean matchesExplicitHint(String className, String simpleName, List<String> hintCandidates) {
        String normalizedClass = normalizeToken(className);
        String normalizedSimple = normalizeToken(simpleName);
        for (String hint : hintCandidates) {
            String normalizedHint = normalizeToken(hint);
            if (normalizedHint.isEmpty()) {
                continue;
            }
            if (normalizedClass.equals(normalizedHint)
                || normalizedSimple.equals(normalizedHint)
                || normalizedClass.endsWith(normalizedHint)
                || normalizedSimple.endsWith(normalizedHint)) {
                return true;
            }
        }
        return false;
    }

    private static String pickSpiderClassName(
        String jarPath,
        String siteKey,
        String classHint,
        ClassLoader loader
    ) throws Exception {
        String token = normalizeToken(siteKey);
        if (classHint != null) {
            String lowerHint = classHint.toLowerCase();
            if (lowerHint.contains("appfox") || lowerHint.contains("appnox")) {
                classHint = "csp_AppYsV2";
            }
        }

        List<String> hintCandidates = expandHintCandidates(classHint);
        String preferredClassHint = classHint == null ? "" : classHint.trim();
        String preferredSimpleName = "";
        if (preferredClassHint.startsWith("csp_") && preferredClassHint.length() > 4) {
            preferredSimpleName = preferredClassHint.substring(4);
        }

        String bestClass = null;
        int bestScore = Integer.MIN_VALUE;
        List<String> allClassNames = new ArrayList<>();
        String primaryJarPath = new File(jarPath).getAbsolutePath();

        List<File> jarsToScan = new ArrayList<>();
        jarsToScan.add(new File(jarPath));
        File bridgeFile = new File(BridgeRunnerCompat.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        jarsToScan.add(bridgeFile);

        File libsDir = new File(bridgeFile.getParentFile(), "libs");
        if (libsDir.exists() && libsDir.isDirectory()) {
            File[] libFiles = libsDir.listFiles((dir, name) -> name.endsWith(".jar"));
            if (libFiles != null) {
                Collections.addAll(jarsToScan, libFiles);
            }
        }
        if (needsAnotherdsFallback(classHint)) {
            File fallbackJar = resolveAnotherdsFallbackJar(bridgeFile.getParentFile(), jarPath);
            if (fallbackJar != null) {
                jarsToScan.add(fallbackJar);
            }
        }

        for (File jarFileObj : jarsToScan) {
            boolean isPrimaryJar = jarFileObj.getAbsolutePath().equals(primaryJarPath);
            try (JarFile jarFile = new JarFile(jarFileObj)) {
                Enumeration<JarEntry> entries = jarFile.entries();
                while (entries.hasMoreElements()) {
                    JarEntry entry = entries.nextElement();
                    String name = entry.getName();
                    if (!name.endsWith(".class")) {
                        continue;
                    }
                    String className = name.substring(0, name.length() - 6).replace('/', '.');
                    allClassNames.add(className);

                    int splitAt = className.lastIndexOf('.');
                    String simpleName = splitAt >= 0 ? className.substring(splitAt + 1) : className;

                    if (!preferredClassHint.isEmpty() && matchesExplicitHint(className, simpleName, hintCandidates)) {
                        return className;
                    }

                    try {
                        Class<?> candidate = Class.forName(className, false, loader);
                        if (!com.github.catvod.crawler.Spider.class.isAssignableFrom(candidate)) {
                            continue;
                        }
                        if (Modifier.isAbstract(candidate.getModifiers()) || candidate.isInterface()) {
                            continue;
                        }

                        int score = scoreCandidate(className, simpleName, token, hintCandidates, isPrimaryJar);
                        if (score > bestScore) {
                            bestScore = score;
                            bestClass = className;
                        }
                    } catch (Throwable ignored) {
                        // Ignore non-loadable helper classes during selection.
                    }
                }
            }
        }

        if (bestClass != null) {
            if (!preferredClassHint.isEmpty()) {
                int splitAt = bestClass.lastIndexOf('.');
                String bestSimpleName = splitAt >= 0 ? bestClass.substring(splitAt + 1) : bestClass;
                if (!matchesExplicitHint(bestClass, bestSimpleName, hintCandidates)) {
                    throw new ClassNotFoundException(
                        "Explicit spider hint not found in classpath: " + preferredClassHint
                            + " | best=" + bestClass
                            + " score=" + bestScore
                    );
                }
            }
            return bestClass;
        }
        throw new ClassNotFoundException(
            "No spider class matched key=" + siteKey + " hint=" + preferredClassHint + " scanned=" + allClassNames.size()
        );
    }

    private static int scoreCandidate(
        String className,
        String simpleName,
        String token,
        List<String> hintCandidates,
        boolean isPrimaryJar
    ) {
        String normalizedClass = normalizeToken(className);
        String normalizedSimple = normalizeToken(simpleName);
        int score = isPrimaryJar ? 200 : 0;

        if (!token.isEmpty()) {
            if (normalizedSimple.equals(token)) {
                score += 1200;
            } else if (normalizedSimple.contains(token) || token.contains(normalizedSimple)) {
                score += 900;
            } else if (normalizedClass.contains(token)) {
                score += 700;
            }
        }

        for (String hint : hintCandidates) {
            String normalizedHint = normalizeToken(hint);
            if (normalizedHint.isEmpty()) {
                continue;
            }
            if (normalizedSimple.equals(normalizedHint)) {
                score += 1000;
            } else if (normalizedSimple.contains(normalizedHint) || normalizedHint.contains(normalizedSimple)) {
                score += 850;
            } else if (normalizedClass.contains(normalizedHint)) {
                score += 650;
            }
        }

        if (normalizedSimple.startsWith("csp")) {
            score += 80;
        }
        if (className.contains(".spider.")) {
            score += 40;
        }

        return score;
    }

    private static boolean needsAnotherdsFallback(String classHint) {
        if (classHint == null) {
            return false;
        }
        String lower = classHint.toLowerCase();
        return lower.contains("apprj") || lower.contains("hxq");
    }

    private static File resolveAnotherdsFallbackJar(File bridgeDir, String jarPath) {
        List<File> candidates = new ArrayList<>();
        if (bridgeDir != null) {
            candidates.add(new File(new File(bridgeDir, "fallbacks"), "anotherds_spider.jar"));
        }
        if (jarPath != null && !jarPath.trim().isEmpty()) {
            File jarFile = new File(jarPath);
            File jarParent = jarFile.getParentFile();
            if (jarParent != null) {
                candidates.add(new File(new File(jarParent, "fallbacks"), "anotherds_spider.jar"));
                File upper = jarParent.getParentFile();
                if (upper != null) {
                    candidates.add(
                        new File(new File(new File(new File(upper, "resources"), "jar"), "fallbacks"), "anotherds_spider.jar")
                    );
                }
            }
        }
        for (File candidate : candidates) {
            if (candidate != null && candidate.isFile()) {
                return candidate;
            }
        }
        return null;
    }

    private static void invokeInitCompat(Object spider, String ext) throws Exception {
        List<Method> initMethods = collectInitMethods(spider.getClass());
        if (initMethods.isEmpty()) {
            return;
        }
        Throwable lastError = null;
        for (Method method : initMethods) {
            Object[] args = buildInitArgs(method, ext);
            if (args == null) {
                continue;
            }
            try {
                method.setAccessible(true);
                System.err.println(
                    "DEBUG: [BridgeCompat] Trying " + buildMethodSignature(method) + " extLength=" + normalizedExtLength(ext)
                );
                method.invoke(spider, args);
                return;
            } catch (Throwable throwable) {
                lastError = unwrapThrowable(throwable);
                System.err.println(
                    "DEBUG: [BridgeCompat] Init attempt failed via "
                        + buildMethodSignature(method)
                        + ": "
                        + safeMessage(lastError)
                );
            }
        }

        if (lastError != null) {
            throw new RuntimeException("invoke init failed", lastError);
        }
    }

    private static int scoreInitMethod(Method method) {
        Class<?>[] parameterTypes = method.getParameterTypes();
        if (parameterTypes.length == 2 && isContextLikeType(parameterTypes[0]) && isExtFriendlyType(parameterTypes[1])) {
            return 0;
        }
        if (parameterTypes.length == 2 && parameterTypes[0] == Object.class && isExtFriendlyType(parameterTypes[1])) {
            return 1;
        }
        if (parameterTypes.length == 1 && !isContextOrObjectType(parameterTypes[0])) {
            return 2;
        }
        if (parameterTypes.length == 0) {
            return 3;
        }
        if (parameterTypes.length == 1 && isContextOrObjectType(parameterTypes[0])) {
            return 4;
        }
        return 10 + parameterTypes.length;
    }

    private static List<Method> collectInitMethods(Class<?> spiderClass) {
        List<Method> initMethods = new ArrayList<>();
        for (Method method : spiderClass.getMethods()) {
            if ("init".equals(method.getName())) {
                initMethods.add(method);
            }
        }
        initMethods.sort(
            Comparator
                .comparingInt((Method method) -> declaringDistance(spiderClass, method.getDeclaringClass()))
                .thenComparingInt(BridgeRunnerCompat::scoreInitMethod)
                .thenComparing(Method::toGenericString)
        );
        return initMethods;
    }

    private static int declaringDistance(Class<?> spiderClass, Class<?> declaringClass) {
        int distance = 0;
        Class<?> current = spiderClass;
        while (current != null) {
            if (current == declaringClass) {
                return distance;
            }
            current = current.getSuperclass();
            distance++;
        }
        return Integer.MAX_VALUE;
    }

    private static String executeWithBestInit(
        Class<?> spiderClass,
        String ext,
        String method,
        List<Object> args
    ) throws Exception {
        Constructor<?> constructor = spiderClass.getDeclaredConstructor();
        constructor.setAccessible(true);
        List<Method> initMethods = collectInitMethods(spiderClass);
        Throwable lastError = null;

        if (initMethods.isEmpty()) {
            Object spider = constructor.newInstance();
            System.err.println("DEBUG: [BridgeCompat] Invoking " + spiderClass.getSimpleName() + "." + method + "() without init");
            Object invokeResult = "init".equals(method) ? "" : invokeMethod(spider, method, args);
            return invokeResult == null ? "" : String.valueOf(invokeResult);
        }

        for (Method initMethod : initMethods) {
            Object[] initArgs = buildInitArgs(initMethod, ext);
            if (initArgs == null) {
                continue;
            }

            Object spider = constructor.newInstance();
            try {
                initMethod.setAccessible(true);
                System.err.println(
                    "DEBUG: [BridgeCompat] Trying " + buildMethodSignature(initMethod) + " extLength=" + normalizedExtLength(ext)
                );
                initMethod.invoke(spider, initArgs);
                runPostInitWarmups(spider, spiderClass);
                if ("init".equals(method)) {
                    return "";
                }

                System.err.println("DEBUG: [BridgeCompat] Invoking " + spiderClass.getSimpleName() + "." + method + "()");
                Object invokeResult = invokeMethod(spider, method, args);
                return invokeResult == null ? "" : String.valueOf(invokeResult);
            } catch (Throwable throwable) {
                lastError = unwrapThrowable(throwable);
                System.err.println(
                    "DEBUG: [BridgeCompat] Attempt failed via "
                        + buildMethodSignature(initMethod)
                        + ": "
                        + safeMessage(lastError)
                );
            }
        }

        try {
            Object spider = constructor.newInstance();
            runPostInitWarmups(spider, spiderClass);
            System.err.println(
                "DEBUG: [BridgeCompat] Falling back to no-init call for "
                    + spiderClass.getSimpleName()
                    + "."
                    + method
                    + "()"
            );
            Object invokeResult = "init".equals(method) ? "" : invokeMethod(spider, method, args);
            return invokeResult == null ? "" : String.valueOf(invokeResult);
        } catch (Throwable throwable) {
            lastError = unwrapThrowable(throwable);
        }

        if (lastError instanceof Exception) {
            throw (Exception) lastError;
        }
        throw new RuntimeException(lastError);
    }

    private static void runPostInitWarmups(Object spider, Class<?> spiderClass) {
        if (!shouldRunPostInitWarmups(spider, spiderClass)) {
            return;
        }

        String[] candidates = new String[]{"wE", "C", "Uj", "oT"};
        for (String methodName : candidates) {
            Method method = findDeclaredNoArgMethod(spiderClass, methodName);
            if (method == null) {
                continue;
            }

            Class<?> returnType = method.getReturnType();
            if (!(Void.TYPE.equals(returnType) || String.class.equals(returnType) || Object.class.equals(returnType))) {
                continue;
            }

            try {
                method.setAccessible(true);
                System.err.println(
                    "DEBUG: [BridgeCompat] Warm-up invoking " + spiderClass.getSimpleName() + "." + buildMethodSignature(method)
                );
                Object result = method.invoke(spider);
                if (result instanceof String) {
                    maybeAssignDerivedStringField(spiderClass, spider, (String) result);
                }
                if (isWarmupSatisfied(spider, spiderClass)) {
                    return;
                }
            } catch (Throwable throwable) {
                Throwable unwrapped = unwrapThrowable(throwable);
                System.err.println(
                    "DEBUG: [BridgeCompat] Warm-up failed via "
                        + buildMethodSignature(method)
                        + ": "
                        + safeMessage(unwrapped)
                );
            }
        }
    }

    private static Method findDeclaredNoArgMethod(Class<?> spiderClass, String methodName) {
        Class<?> current = spiderClass;
        while (current != null && current != Object.class) {
            for (Method method : current.getDeclaredMethods()) {
                if (methodName.equals(method.getName()) && method.getParameterCount() == 0) {
                    return method;
                }
            }
            current = current.getSuperclass();
        }
        return null;
    }

    private static boolean shouldRunPostInitWarmups(Object spider, Class<?> spiderClass) {
        String primary = firstNonBlankField(spiderClass, spider, "wE", "Ra", "OQ", "m");
        String seed = firstNonBlankField(spiderClass, spider, "zK", "C7", "Ra");
        return isBlank(primary) && !isBlank(seed);
    }

    private static boolean isWarmupSatisfied(Object spider, Class<?> spiderClass) {
        return !isBlank(firstNonBlankField(spiderClass, spider, "wE", "Ra", "OQ", "m"));
    }

    private static String firstNonBlankField(Class<?> spiderClass, Object spider, String... fieldNames) {
        for (String fieldName : fieldNames) {
            String value = readStringField(spiderClass, spider, fieldName);
            if (!isBlank(value)) {
                return value;
            }
        }
        return "";
    }

    private static String readStringField(Class<?> spiderClass, Object spider, String fieldName) {
        Field field = findField(spiderClass, fieldName);
        if (field == null || field.getType() != String.class) {
            return "";
        }

        try {
            field.setAccessible(true);
            Object value = field.get(spider);
            return value instanceof String ? ((String) value).trim() : "";
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static void maybeAssignDerivedStringField(Class<?> spiderClass, Object spider, String value) {
        if (isBlank(value)) {
            return;
        }

        for (String fieldName : new String[]{"wE", "Ra", "OQ"}) {
            Field field = findField(spiderClass, fieldName);
            if (field == null || field.getType() != String.class) {
                continue;
            }
            try {
                field.setAccessible(true);
                Object current = field.get(spider);
                if (!(current instanceof String) || isBlank((String) current)) {
                    field.set(spider, value);
                    return;
                }
            } catch (Throwable ignored) {
                return;
            }
        }
    }

    private static Field findField(Class<?> spiderClass, String fieldName) {
        Class<?> current = spiderClass;
        while (current != null && current != Object.class) {
            try {
                return current.getDeclaredField(fieldName);
            } catch (NoSuchFieldException ignored) {
                current = current.getSuperclass();
            }
        }
        return null;
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    private static String buildMethodSignature(Method method) {
        StringBuilder builder = new StringBuilder();
        builder.append(method.getName()).append("(");
        Class<?>[] parameterTypes = method.getParameterTypes();
        for (int index = 0; index < parameterTypes.length; index++) {
            if (index > 0) {
                builder.append(", ");
            }
            builder.append(parameterTypes[index].getName());
        }
        builder.append(")");
        return builder.toString();
    }

    private static int normalizedExtLength(String ext) {
        return ext == null ? 0 : ext.trim().length();
    }

    private static Object[] buildInitArgs(Method method, String ext) {
        Class<?>[] parameterTypes = method.getParameterTypes();
        String normalizedExt = ext == null || ext.isEmpty() ? "{}" : ext;

        if (parameterTypes.length == 0) {
            return new Object[0];
        }

        if (parameterTypes.length == 1) {
            if (isContextOrObjectType(parameterTypes[0])) {
                Object contextArg = buildContextArg(parameterTypes[0]);
                return contextArg == null ? null : new Object[]{contextArg};
            }
            Object coerced = coerceArg(normalizedExt, parameterTypes[0]);
            if (coerced == null && !normalizedExt.isEmpty()) {
                return null;
            }
            return new Object[]{coerced};
        }

        if (parameterTypes.length == 2) {
            Object firstArg;
            if (isContextOrObjectType(parameterTypes[0])) {
                firstArg = buildContextArg(parameterTypes[0]);
            } else {
                firstArg = coerceArg(null, parameterTypes[0]);
            }
            Object secondArg = coerceArg(normalizedExt, parameterTypes[1]);
            if (secondArg == null && !normalizedExt.isEmpty()) {
                return null;
            }
            return new Object[]{firstArg, secondArg};
        }

        return null;
    }

    private static boolean isExtFriendlyType(Class<?> type) {
        return type == String.class
            || type == Object.class
            || Map.class.isAssignableFrom(type)
            || List.class.isAssignableFrom(type);
    }

    private static boolean isContextLikeType(Class<?> type) {
        String name = type.getName();
        return "android.content.Context".equals(name)
            || "android.app.Application".equals(name)
            || name.endsWith(".Context");
    }

    private static boolean isContextOrObjectType(Class<?> type) {
        return type == Object.class || isContextLikeType(type);
    }

    private static Object buildContextArg(Class<?> type) {
        try {
            Application application = new Application();
            if (type.isInstance(application) || type == Object.class) {
                return application;
            }
        } catch (Throwable ignored) {
        }

        if (!type.isInterface() && !Modifier.isAbstract(type.getModifiers())) {
            try {
                Constructor<?> constructor = type.getDeclaredConstructor();
                constructor.setAccessible(true);
                return constructor.newInstance();
            } catch (Throwable ignored) {
            }
        }

        return null;
    }

    private static Object invokeMethod(Object spider, String methodName, List<Object> args) throws Exception {
        Method bridgeMethod = BridgeRunner.class.getDeclaredMethod(
            "invokeMethod",
            Object.class,
            String.class,
            List.class
        );
        bridgeMethod.setAccessible(true);
        try {
            return bridgeMethod.invoke(null, spider, methodName, args);
        } catch (InvocationTargetException throwable) {
            Throwable unwrapped = unwrapThrowable(throwable);
            if (unwrapped instanceof Exception) {
                throw (Exception) unwrapped;
            }
            throw new RuntimeException(unwrapped);
        }
    }

    private static Object coerceArg(Object value, Class<?> type) {
        if (type == null) {
            return value;
        }
        if (value == null) {
            if (type == Boolean.TYPE || type == Boolean.class) {
                return Boolean.FALSE;
            }
            if (type == Integer.TYPE || type == Integer.class) {
                return 0;
            }
            if (type == Long.TYPE || type == Long.class) {
                return 0L;
            }
            if (List.class.isAssignableFrom(type)) {
                return new ArrayList<>();
            }
            if (Map.class.isAssignableFrom(type)) {
                return new HashMap<>();
            }
            return null;
        }
        if (type.isInstance(value)) {
            return value;
        }
        if (type == String.class || type == Object.class) {
            return String.valueOf(value);
        }
        if (type == Boolean.TYPE || type == Boolean.class) {
            return Boolean.parseBoolean(String.valueOf(value));
        }
        if (type == Integer.TYPE || type == Integer.class) {
            try {
                return Integer.parseInt(String.valueOf(value));
            } catch (NumberFormatException ignored) {
                return 0;
            }
        }
        if (type == Long.TYPE || type == Long.class) {
            try {
                return Long.parseLong(String.valueOf(value));
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }
        if (List.class.isAssignableFrom(type)) {
            if (value instanceof List) {
                return value;
            }
            List<String> list = new ArrayList<>();
            list.add(String.valueOf(value));
            return list;
        }
        if (Map.class.isAssignableFrom(type)) {
            if (value instanceof Map) {
                return value;
            }
            return new HashMap<>();
        }
        return value;
    }

    private static Throwable unwrapThrowable(Throwable throwable) {
        if (throwable instanceof InvocationTargetException && throwable.getCause() != null) {
            return unwrapThrowable(throwable.getCause());
        }
        if (throwable instanceof RuntimeException && throwable.getCause() != null) {
            return throwable.getCause();
        }
        return throwable;
    }

    private static String safeMessage(Throwable throwable) {
        StringBuilder builder = new StringBuilder();
        Throwable current = throwable;
        int depth = 0;
        while (current != null && depth < 3) {
            String message = current.getMessage();
            if (message != null && !message.isEmpty()) {
                if (builder.length() > 0) {
                    builder.append(" -> ");
                }
                builder.append(current.getClass().getSimpleName()).append(": ").append(message);
            }
            current = current.getCause();
            depth++;
        }
        if (builder.length() == 0) {
            return throwable.getClass().getSimpleName() + ": unknown error";
        }
        return builder.toString().replace('\n', ' ').replace('\r', ' ');
    }
}
