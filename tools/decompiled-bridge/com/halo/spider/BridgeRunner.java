/*
 * Decompiled with CFR 0.152.
 */
package com.halo.spider;

import java.io.File;
import java.io.PrintStream;
import java.io.Serializable;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

public final class BridgeRunner {
    private static final Base64.Decoder BASE64_DECODER = Base64.getDecoder();

    private BridgeRunner() {
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public static void main(String[] stringArray) {
        PrintStream printStream = System.out;
        System.setOut(System.err);
        BridgeResponse bridgeResponse = new BridgeResponse();
        try {
            Object object;
            Object object2;
            Serializable serializable;
            Object object3;
            Object object4;
            String string2 = BridgeRunner.readEnv("HALO_JAR_PATH", "");
            String string3 = BridgeRunner.readEnv("HALO_SITE_KEY", "");
            String string4 = BridgeRunner.readEnv("HALO_CLASS_HINT", "");
            String string5 = BridgeRunner.readEnv("HALO_EXT", "");
            String string6 = BridgeRunner.readEnv("HALO_METHOD", "").trim();
            List<Object> list = BridgeRunner.readCallArgs();
            if (string2.isEmpty()) {
                throw new IllegalArgumentException("HALO_JAR_PATH is empty");
            }
            if (string6.isEmpty()) {
                throw new IllegalArgumentException("HALO_METHOD is empty");
            }
            ArrayList<URL> arrayList = new ArrayList<URL>();
            try {
                object4 = new File(BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
                object3 = ((File)object4).getParentFile();
                serializable = new File((File)object3, "classes");
                if (((File)serializable).exists()) {
                    arrayList.add(((File)serializable).toURI().toURL());
                }
                if ((object2 = new File(string2).getParentFile()) != null && ((File)object2).exists()) {
                    object2 = new File((File)object2, "libs");
                }
                if (object2 != null && ((File)object2).exists() && ((File)object2).isDirectory() && (object = ((File)object2).listFiles((file, string) -> string.endsWith(".jar"))) != null) {
                    for (File file2 : object) {
                        if (file2.getAbsolutePath().equals(new File(string2).getAbsolutePath())) continue;
                        arrayList.add(file2.toURI().toURL());
                    }
                    System.err.println("DEBUG: Discovered " + ((Object)object).length + " auxiliary libraries in libs/ directory.");
                }
                arrayList.add(new File(string2).toURI().toURL());
                if (BridgeRunner.needsAnotherdsFallback(string4) && (object = BridgeRunner.resolveAnotherdsFallbackJar((File)object3, string2)) != null) {
                    arrayList.add(((File)object).toURI().toURL());
                    System.err.println("DEBUG: Injected hint fallback jar for " + string4 + ": " + ((File)object).getAbsolutePath());
                }
            }
            catch (Throwable throwable) {
                System.err.println("DEBUG: Error discovering libs/fallbacks: " + throwable.getMessage());
            }
            object4 = new URLClassLoader(arrayList.toArray(new URL[0]), BridgeRunner.class.getClassLoader()){

                @Override
                protected Class<?> findClass(String string) throws ClassNotFoundException {
                    try {
                        return super.findClass(string);
                    }
                    catch (ClassFormatError | UnsatisfiedLinkError linkageError) {
                        System.err.println("DEBUG: Skipping malformed class (ClassFormatError): " + string + " \u2192 " + linkageError.getMessage());
                        throw new ClassNotFoundException("Skipped due to ClassFormatError: " + string, linkageError);
                    }
                }
            };
            bridgeResponse.className = object3 = BridgeRunner.pickSpiderClassName(string2, string3, string4, (ClassLoader)object4);
            serializable = Class.forName((String)object3, true, (ClassLoader)object4);
            object2 = ((Class)serializable).getDeclaredConstructor(new Class[0]);
            ((Constructor)object2).setAccessible(true);
            object = ((Constructor)object2).newInstance(new Object[0]);
            ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
            Thread.currentThread().setContextClassLoader((ClassLoader)object4);
            try {
                BridgeRunner.invokeInit(object, string5);
                System.err.println("DEBUG: [Bridge] Invoking " + ((Class)serializable).getSimpleName() + "." + string6 + "()");
                String string7 = "init".equals(string6) ? "" : BridgeRunner.invokeMethod(object, string6, list);
                String string8 = string7 == null ? "" : String.valueOf(string7);
                bridgeResponse.ok = true;
                bridgeResponse.result = string8;
            }
            finally {
                Thread.currentThread().setContextClassLoader(classLoader);
            }
        }
        catch (Throwable throwable) {
            bridgeResponse.ok = false;
            bridgeResponse.error = throwable.getClass().getName() + ": " + BridgeRunner.safeMessage(throwable);
            throwable.printStackTrace(System.err);
        }
        printStream.println(">>HALO_RESPONSE<<" + bridgeResponse.toJson() + ">>HALO_RESPONSE<<");
    }

    private static String safeMessage(Throwable throwable) {
        String string;
        StringBuilder stringBuilder = new StringBuilder();
        Throwable throwable2 = throwable;
        boolean bl = false;
        for (int n = 0; throwable2 != null && n < 3; throwable2 = throwable2.getCause(), ++n) {
            string = throwable2.getMessage();
            if (string == null || string.isEmpty()) continue;
            if (stringBuilder.length() > 0) {
                stringBuilder.append(" -> ");
            }
            stringBuilder.append(throwable2.getClass().getSimpleName()).append(": ").append(string);
            if (!string.contains("must begin with '{'")) continue;
            bl = true;
        }
        if (stringBuilder.length() == 0) {
            return throwable.getClass().getSimpleName() + ": unknown error";
        }
        string = stringBuilder.toString().replace('\n', ' ').replace('\r', ' ');
        if (bl) {
            return string + " | NOTE: Target API returned non-JSON (likely 403 Forbidden HTML).";
        }
        return string;
    }

    private static String readEnv(String string, String string2) {
        String string3 = System.getenv(string);
        return string3 == null ? string2 : string3;
    }

    private static List<Object> readCallArgs() {
        int n = 0;
        try {
            n = Integer.parseInt(BridgeRunner.readEnv("HALO_ARG_COUNT", "0"));
        }
        catch (NumberFormatException numberFormatException) {
            n = 0;
        }
        if (n <= 0) {
            return Collections.emptyList();
        }
        ArrayList<Object> arrayList = new ArrayList<Object>(n);
        for (int i = 0; i < n; ++i) {
            String string = BridgeRunner.readEnv("HALO_ARG_" + i + "_TYPE", "null");
            String string2 = BridgeRunner.readEnv("HALO_ARG_" + i + "_VALUE", "");
            arrayList.add(BridgeRunner.decodeArg(string, string2));
        }
        return arrayList;
    }

    private static Object decodeArg(String string, String string2) {
        switch (string) {
            case "null": {
                return null;
            }
            case "bool": {
                return Boolean.parseBoolean(string2);
            }
            case "number": {
                try {
                    if (string2.contains(".")) {
                        return Double.parseDouble(string2);
                    }
                    return Long.parseLong(string2);
                }
                catch (NumberFormatException numberFormatException) {
                    return 0L;
                }
            }
            case "string": {
                return string2;
            }
            case "list": {
                return BridgeRunner.decodeList(string2);
            }
            case "map": {
                return BridgeRunner.decodeMap(string2);
            }
        }
        return string2;
    }

    private static List<String> decodeList(String string) {
        if (string == null || string.isEmpty()) {
            return new ArrayList<String>();
        }
        String[] stringArray = string.split(",");
        ArrayList<String> arrayList = new ArrayList<String>(stringArray.length);
        for (String string2 : stringArray) {
            if (string2 == null || string2.isEmpty()) continue;
            arrayList.add(BridgeRunner.fromBase64(string2));
        }
        return arrayList;
    }

    private static Map<String, String> decodeMap(String string) {
        String[] stringArray;
        HashMap<String, String> hashMap = new HashMap<String, String>();
        if (string == null || string.isEmpty()) {
            return hashMap;
        }
        for (String string2 : stringArray = string.split(",")) {
            int n;
            if (string2 == null || string2.isEmpty() || (n = string2.indexOf(58)) <= 0 || n >= string2.length() - 1) continue;
            String string3 = BridgeRunner.fromBase64(string2.substring(0, n));
            String string4 = BridgeRunner.fromBase64(string2.substring(n + 1));
            if (string3.isEmpty()) continue;
            hashMap.put(string3, string4);
        }
        return hashMap;
    }

    private static String fromBase64(String string) {
        try {
            return new String(BASE64_DECODER.decode(string), StandardCharsets.UTF_8);
        }
        catch (Exception exception) {
            return string;
        }
    }

    private static String normalizeToken(String string) {
        if (string == null) {
            return "";
        }
        return string.replaceAll("[^A-Za-z0-9]", "").toLowerCase();
    }

    private static List<String> splitHints(String string) {
        if (string == null || string.trim().isEmpty()) {
            return Collections.emptyList();
        }
        String[] stringArray = string.split("[,;|\\n\\r\\t ]+");
        ArrayList<String> arrayList = new ArrayList<String>();
        for (String string2 : stringArray) {
            if (string2 == null || string2.trim().isEmpty()) continue;
            arrayList.add(string2.trim());
        }
        return arrayList;
    }

    /*
     * WARNING - void declaration
     * Enabled aggressive block sorting
     * Enabled unnecessary exception pruning
     * Enabled aggressive exception aggregation
     */
    private static String pickSpiderClassName(String string2, String string3, String string4, ClassLoader classLoader) throws Exception {
        Iterator iterator;
        Object object;
        String string5 = BridgeRunner.normalizeToken(string3);
        if (string4 != null && (((String)(object = string4.toLowerCase())).contains("appfox") || ((String)object).contains("appnox"))) {
            string4 = "csp_AppYsV2";
        }
        object = BridgeRunner.splitHints(string4);
        String string6 = string4 == null ? "" : string4.trim();
        String string7 = "";
        if (string6.startsWith("csp_") && string6.length() > 4) {
            string7 = string6.substring(4);
        }
        String string8 = null;
        int n = Integer.MIN_VALUE;
        ArrayList<String> arrayList = new ArrayList<String>();
        String string9 = new File(string2).getAbsolutePath();
        boolean bl = false;
        boolean bl2 = false;
        ArrayList<Object> arrayList2 = new ArrayList<Object>();
        arrayList2.add(new File(string2));
        try {
            Object object2;
            iterator = new File(BridgeRunner.class.getProtectionDomain().getCodeSource().getLocation().toURI());
            arrayList2.add(iterator);
            File file2 = new File(((File)((Object)iterator)).getParentFile(), "libs");
            if (file2.exists() && file2.isDirectory() && (object2 = file2.listFiles((file, string) -> string.endsWith(".jar"))) != null) {
                for (Object object3 : object2) {
                    arrayList2.add(object3);
                }
            }
            if (BridgeRunner.needsAnotherdsFallback(string4) && (object2 = BridgeRunner.resolveAnotherdsFallbackJar(((File)((Object)iterator)).getParentFile(), string2)) != null) {
                arrayList2.add(object2);
                System.err.println("DEBUG: Added hint fallback jar to class scan: " + ((File)object2).getAbsolutePath());
            }
        }
        catch (Exception exception) {
            // empty catch block
        }
        for (File file3 : arrayList2) {
            boolean bl3 = file3.getAbsolutePath().equals(string9);
            try (Object object4 = new JarFile(file3);){
                Enumeration<JarEntry> enumeration = ((JarFile)object4).entries();
                while (enumeration.hasMoreElements()) {
                    String string10;
                    Object object5;
                    String string11;
                    Object object3;
                    JarEntry jarEntry = enumeration.nextElement();
                    object3 = jarEntry.getName();
                    if (bl3 && ((String)object3).endsWith(".dex")) {
                        bl2 = true;
                    }
                    if (!((String)object3).endsWith(".class")) continue;
                    if (bl3) {
                        bl = true;
                    }
                    String string12 = ((String)object3).substring(0, ((String)object3).length() - 6).replace('/', '.');
                    arrayList.add(string12);
                    int n2 = string12.lastIndexOf(46);
                    String string13 = string11 = n2 >= 0 ? string12.substring(n2 + 1) : string12;
                    if (!string6.isEmpty() && (string12.equalsIgnoreCase(string6) || !string7.isEmpty() && string11.equalsIgnoreCase(string7))) {
                        object5 = string12;
                        return object5;
                    }
                    try {
                        object5 = Class.forName(string12, false, classLoader);
                    }
                    catch (Throwable throwable) {
                        continue;
                    }
                    if (((Class)object5).isInterface() || Modifier.isAbstract(((Class)object5).getModifiers())) continue;
                    int n3 = 0;
                    try {
                        string10 = ((Class)object5).getSimpleName();
                    }
                    catch (Throwable throwable) {
                        continue;
                    }
                    String string14 = BridgeRunner.normalizeToken(string10);
                    Object object6 = object.iterator();
                    while (object6.hasNext()) {
                        String string15 = (String)object6.next();
                        if (string12.equalsIgnoreCase(string15) || string10.equalsIgnoreCase(string15)) {
                            n3 += 10000;
                            continue;
                        }
                        if (string15.startsWith("csp_") && string10.equalsIgnoreCase(string15.substring(4))) {
                            n3 += 8000;
                            continue;
                        }
                        String string16 = BridgeRunner.normalizeToken(string15);
                        if (string16.isEmpty() || !BridgeRunner.normalizeToken(string12).contains(string16) && !string14.contains(string16)) continue;
                        n3 += 500;
                    }
                    if (!string5.isEmpty()) {
                        if (string14.equals(string5)) {
                            n3 += 2000;
                        } else if (string14.contains(string5) || string5.contains(string14)) {
                            n3 += 800;
                        }
                    }
                    try {
                        object6 = Class.forName("com.github.catvod.crawler.Spider", false, classLoader);
                        if (((Class)object6).isAssignableFrom((Class<?>)object5)) {
                            n3 += 1000;
                        }
                    }
                    catch (Throwable throwable) {
                        // empty catch block
                    }
                    if (string12.contains("$")) {
                        n3 -= 500;
                    }
                    if (string12.contains(".spider.")) {
                        n3 += 100;
                    }
                    if (n3 <= n) continue;
                    n = n3;
                    string8 = string12;
                }
            }
            catch (Exception exception) {}
        }
        if ((string8 == null || string8.isEmpty()) && string3 != null && (string3.endsWith(".js") || string4 != null && string4.endsWith(".js"))) {
            for (String string17 : arrayList) {
                if (string17.endsWith("Drupy")) return string17;
                if (!string17.endsWith("AppJs")) continue;
                return string17;
            }
        }
        if (string8 == null || string8.isEmpty()) {
            iterator = new StringBuilder();
            ((StringBuilder)((Object)iterator)).append("no spider class matched key: ").append(string3).append("\nAvailable classes:\n");
            boolean bl4 = false;
            while (true) {
                void var16_23;
                if (var16_23 >= Math.min(10, arrayList.size())) {
                    if (arrayList.size() <= 10) throw new IllegalStateException(((StringBuilder)((Object)iterator)).toString());
                    ((StringBuilder)((Object)iterator)).append(" ... and ").append(arrayList.size() - 10).append(" more");
                    throw new IllegalStateException(((StringBuilder)((Object)iterator)).toString());
                }
                ((StringBuilder)((Object)iterator)).append(" - ").append((String)arrayList.get((int)var16_23)).append("\n");
                ++var16_23;
            }
        }
        if (string6.isEmpty()) return string8;
        if (!string6.toLowerCase().startsWith("csp_")) return string8;
        if (n >= 8000) return string8;
        if (bl2 && !bl) {
            throw new IllegalStateException("explicit spider hint not found in JVM classpath: " + string6 + " | target spider jar appears dex-only (contains classes.dex) and this desktop bridge does not execute dex-only spiders yet");
        }
        if (bl) throw new IllegalStateException("no spider class matched key: " + string3 + " (hint=" + string6 + " not found in JAR; bestScore=" + n + ")");
        throw new IllegalStateException("explicit spider hint not found in JVM classpath: " + string6 + " | target spider jar has no loadable .class entries");
    }

    private static boolean needsAnotherdsFallback(String string) {
        if (string == null) {
            return false;
        }
        String string2 = string.toLowerCase();
        return string2.contains("apprj") || string2.contains("hxq");
    }

    private static File resolveAnotherdsFallbackJar(File file, String string) {
        Object object;
        File file22;
        ArrayList<File> arrayList = new ArrayList<File>();
        if (file != null) {
            arrayList.add(new File(new File(file, "fallbacks"), "anotherds_spider.jar"));
        }
        if (string != null && !string.trim().isEmpty() && (file22 = ((File)(object = new File(string))).getParentFile()) != null) {
            arrayList.add(new File(new File(file22, "fallbacks"), "anotherds_spider.jar"));
            File file3 = file22.getParentFile();
            if (file3 != null) {
                arrayList.add(new File(new File(new File(new File(file3, "resources"), "jar"), "fallbacks"), "anotherds_spider.jar"));
            }
        }
        for (File file22 : arrayList) {
            if (file22 == null || !file22.isFile()) continue;
            return file22;
        }
        return null;
    }

    private static boolean isContextLikeType(Class<?> clazz) {
        String string = clazz.getName();
        return "android.content.Context".equals(string) || "android.app.Application".equals(string) || string.endsWith(".Context");
    }

    /*
     * WARNING - void declaration
     */
    private static void invokeInit(Object object, String string) throws Exception {
        void var4_12;
        void var6_17;
        Method[] methodArray = object.getClass().getMethods();
        ArrayList<Method> arrayList = new ArrayList<Method>();
        Method[] object2 = methodArray;
        int n = object2.length;
        boolean bl = false;
        while (var6_17 < n) {
            Method method = object2[var6_17];
            if ("init".equals(method.getName())) {
                arrayList.add(method);
            }
            ++var6_17;
        }
        if (arrayList.isEmpty()) {
            return;
        }
        Object var4_5 = null;
        for (Method method : arrayList) {
            Class<?>[] classArray = method.getParameterTypes();
            if (classArray.length != 2 || !BridgeRunner.isContextLikeType(classArray[0])) continue;
            try {
                Object object3 = BridgeRunner.coerceArg(string, classArray[1]);
                method.setAccessible(true);
                method.invoke(object, null, object3);
                return;
            }
            catch (Throwable throwable) {
                Throwable throwable2 = throwable;
            }
        }
        for (Method method : arrayList) {
            String string2;
            Object object4;
            Class<?>[] classArray = method.getParameterTypes();
            if (classArray.length != 1 || BridgeRunner.isContextLikeType(classArray[0]) || (object4 = BridgeRunner.coerceArg(string2 = string.isEmpty() ? "{}" : string, classArray[0])) == null && !string2.isEmpty()) continue;
            try {
                method.setAccessible(true);
                method.invoke(object, object4);
                return;
            }
            catch (Throwable throwable) {
                Throwable throwable3 = throwable;
                break;
            }
        }
        for (Method method : arrayList) {
            if (method.getParameterCount() != 0) continue;
            try {
                method.setAccessible(true);
                method.invoke(object, new Object[0]);
                return;
            }
            catch (Throwable throwable) {
                Throwable throwable4 = throwable;
            }
        }
        for (Method method : arrayList) {
            Class<?>[] classArray = method.getParameterTypes();
            if (classArray.length != 1 || !BridgeRunner.isContextLikeType(classArray[0])) continue;
            try {
                method.setAccessible(true);
                method.invoke(object, new Object[]{null});
                return;
            }
            catch (Throwable throwable) {
                Throwable throwable5 = throwable;
            }
        }
        if (var4_12 != null) {
            throw new RuntimeException("invoke init failed", (Throwable)var4_12);
        }
    }

    /*
     * WARNING - void declaration
     */
    private static Object invokeMethod(Object object, String string, List<Object> list) throws Exception {
        void var5_7;
        void var7_12;
        Method[] methodArray = object.getClass().getMethods();
        ArrayList<Method> arrayList = new ArrayList<Method>();
        Method[] object2 = methodArray;
        int n = object2.length;
        boolean bl = false;
        while (var7_12 < n) {
            Method method3 = object2[var7_12];
            if (string.equals(method3.getName())) {
                arrayList.add(method3);
            }
            ++var7_12;
        }
        if (arrayList.isEmpty()) {
            throw new NoSuchMethodException("method not found: " + string);
        }
        arrayList.sort((method, method2) -> Integer.compare(Math.abs(method.getParameterCount() - list.size()), Math.abs(method2.getParameterCount() - list.size())));
        Object var5_6 = null;
        for (Method method4 : arrayList) {
            try {
                Object[] objectArray = BridgeRunner.coerceArgs(method4.getParameterTypes(), list.toArray());
                method4.setAccessible(true);
                Object object3 = method4.invoke(object, objectArray);
                System.err.println("DEBUG: invokeMethod result type: " + (object3 == null ? "null" : object3.getClass().getName()));
                System.err.println("DEBUG: invokeMethod result value: [" + (object3 == null ? "" : object3.toString()) + "]");
                return object3;
            }
            catch (Throwable throwable) {
                Throwable throwable2 = throwable;
            }
        }
        if (var5_7 == null) {
            throw new RuntimeException("invoke method failed: " + string);
        }
        throw new RuntimeException("invoke method failed: " + string, (Throwable)var5_7);
    }

    private static Object[] coerceArgs(Class<?>[] classArray, Object[] objectArray) {
        Object[] objectArray2 = new Object[classArray.length];
        for (int i = 0; i < classArray.length; ++i) {
            Object object = i < objectArray.length ? objectArray[i] : null;
            objectArray2[i] = BridgeRunner.coerceArg(object, classArray[i]);
        }
        return objectArray2;
    }

    private static Object coerceArg(Object object, Class<?> clazz) {
        if (clazz == null) {
            return object;
        }
        if ("android.content.Context".equals(clazz.getName())) {
            return null;
        }
        if (object == null) {
            if (clazz == Boolean.TYPE || clazz == Boolean.class) {
                return Boolean.FALSE;
            }
            if (clazz == Integer.TYPE || clazz == Integer.class || clazz == Long.TYPE || clazz == Long.class) {
                return 0;
            }
            if (List.class.isAssignableFrom(clazz)) {
                return new ArrayList();
            }
            if (Map.class.isAssignableFrom(clazz)) {
                return new HashMap();
            }
            return null;
        }
        if (clazz.isInstance(object)) {
            return object;
        }
        if (clazz == String.class) {
            return String.valueOf(object);
        }
        if (clazz == Boolean.TYPE || clazz == Boolean.class) {
            return Boolean.parseBoolean(String.valueOf(object));
        }
        if (clazz == Integer.TYPE || clazz == Integer.class) {
            try {
                return Integer.parseInt(String.valueOf(object));
            }
            catch (NumberFormatException numberFormatException) {
                return 0;
            }
        }
        if (clazz == Long.TYPE || clazz == Long.class) {
            try {
                return Long.parseLong(String.valueOf(object));
            }
            catch (NumberFormatException numberFormatException) {
                return 0L;
            }
        }
        if (List.class.isAssignableFrom(clazz)) {
            if (object instanceof List) {
                return object;
            }
            ArrayList<String> arrayList = new ArrayList<String>();
            arrayList.add(String.valueOf(object));
            return arrayList;
        }
        if (Map.class.isAssignableFrom(clazz)) {
            if (object instanceof Map) {
                return object;
            }
            return new HashMap();
        }
        String string = clazz.getName();
        if (("com.google.gson.JsonObject".equals(string) || "com.google.gson.JsonElement".equals(string)) && object instanceof String) {
            String string2 = (String)object;
            try {
                ClassLoader classLoader = Thread.currentThread().getContextClassLoader();
                if (classLoader == null) {
                    classLoader = clazz.getClassLoader();
                }
                Class<?> clazz2 = Class.forName("com.google.gson.JsonParser", true, classLoader);
                Method method = clazz2.getMethod("parseString", String.class);
                Object object2 = method.invoke(null, string2.isEmpty() ? "{}" : string2);
                if ("com.google.gson.JsonObject".equals(string)) {
                    Method method2 = object2.getClass().getMethod("getAsJsonObject", new Class[0]);
                    return method2.invoke(object2, new Object[0]);
                }
                return object2;
            }
            catch (Throwable throwable) {
                System.err.println("DEBUG: coerceArg: failed to parse Gson type from String: " + throwable.getMessage());
                return null;
            }
        }
        return object;
    }

    private static String escapeJson(String string) {
        if (string == null) {
            return "";
        }
        StringBuilder stringBuilder = new StringBuilder(string.length() + 16);
        block9: for (int i = 0; i < string.length(); ++i) {
            char c = string.charAt(i);
            switch (c) {
                case '\"': {
                    stringBuilder.append("\\\"");
                    continue block9;
                }
                case '\\': {
                    stringBuilder.append("\\\\");
                    continue block9;
                }
                case '\b': {
                    stringBuilder.append("\\b");
                    continue block9;
                }
                case '\f': {
                    stringBuilder.append("\\f");
                    continue block9;
                }
                case '\n': {
                    stringBuilder.append("\\n");
                    continue block9;
                }
                case '\r': {
                    stringBuilder.append("\\r");
                    continue block9;
                }
                case '\t': {
                    stringBuilder.append("\\t");
                    continue block9;
                }
                default: {
                    if (c < ' ') {
                        stringBuilder.append(String.format("\\u%04x", c));
                        continue block9;
                    }
                    stringBuilder.append(c);
                }
            }
        }
        return stringBuilder.toString();
    }

    private static final class BridgeResponse {
        boolean ok;
        String result;
        String className;
        String error;

        private BridgeResponse() {
        }

        String toJson() {
            String string;
            StringBuilder stringBuilder = new StringBuilder();
            stringBuilder.append("{");
            stringBuilder.append("\"ok\":").append(this.ok).append(",");
            stringBuilder.append("\"className\":\"").append(this.className == null ? "" : BridgeRunner.escapeJson(this.className)).append("\",");
            String string2 = string = this.result == null ? "{}" : this.result;
            if (string.startsWith("{") || string.startsWith("[")) {
                stringBuilder.append("\"result\":").append(string).append(",");
            } else {
                stringBuilder.append("\"result\":\"").append(BridgeRunner.escapeJson(string)).append("\",");
            }
            stringBuilder.append("\"error\":\"").append(this.error == null ? "" : BridgeRunner.escapeJson(this.error)).append("\"");
            stringBuilder.append("}");
            return stringBuilder.toString();
        }
    }
}

