package com.github.catvod.spider;

import android.content.Context;
import com.github.catvod.crawler.Spider;
import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * Desktop-safe delegate wrapper for *Amns spiders.
 * The transformed jars sometimes lose the constructor body that initializes the
 * wrapped spider instance; this bridge class restores that behavior.
 */
public class BaseSpiderAmns extends Spider {
    private final String ownerClassName;
    private volatile Spider o0OoO0oO0oOoO0O0oO;

    public BaseSpiderAmns() {
        this.ownerClassName = getClass().getName();
        this.o0OoO0oO0oOoO0O0oO = null;
    }

    private Spider resolveDelegateChain() {
        Spider runtimeDelegate = Init.getSpider(ownerClassName);
        if (runtimeDelegate != null && !isWrapperDelegate(runtimeDelegate)) {
            System.err.println("DEBUG: BaseSpiderAmns runtime delegate resolved: " + ownerClassName + " -> "
                    + runtimeDelegate.getClass().getName());
            return runtimeDelegate;
        }

        return resolveDelegateFallback();
    }

    private Spider resolveDelegateFallback() {
        ClassLoader[] loaders = new ClassLoader[] { getClass().getClassLoader(), BaseSpiderAmns.class.getClassLoader() };
        List<String> candidates = buildDelegateCandidates(ownerClassName, loaders);

        for (String candidate : candidates) {
            for (ClassLoader loader : loaders) {
                Spider delegate = instantiateDelegate(loader, candidate);
                if (delegate != null) {
                    System.err.println("DEBUG: BaseSpiderAmns delegate resolved: " + getClass().getName() + " -> " + candidate);
                    return delegate;
                }
            }
        }

        System.err.println("DEBUG: BaseSpiderAmns delegate unresolved for " + ownerClassName + " candidates=" + candidates);
        return new MissingDelegateSpider(ownerClassName);
    }

    private static boolean isWrapperDelegate(Spider delegate) {
        return delegate == null || delegate instanceof BaseSpiderAmns;
    }

    private Spider ensureDelegate() {
        Spider current = o0OoO0oO0oOoO0O0oO;
        if (current != null && !(current instanceof MissingDelegateSpider)) {
            return current;
        }

        synchronized (this) {
            current = o0OoO0oO0oOoO0O0oO;
            if (current != null && !(current instanceof MissingDelegateSpider)) {
                return current;
            }

            Spider refreshed = resolveDelegateChain();
            o0OoO0oO0oOoO0O0oO = refreshed;
            return refreshed;
        }
    }

    private static List<String> buildDelegateCandidates(String className, ClassLoader[] loaders) {
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        if (className == null || className.trim().isEmpty()) {
            return Collections.emptyList();
        }

        if (className.endsWith("HxqAmns")) {
            candidates.add("com.github.catvod.spider.Hxq");
        }

        int lastDot = className.lastIndexOf('.');
        String packagePrefix = lastDot >= 0 ? className.substring(0, lastDot + 1) : "";
        String simpleName = lastDot >= 0 ? className.substring(lastDot + 1) : className;

        if (simpleName.endsWith("Amnsr")) {
            candidates.add(packagePrefix + simpleName.substring(0, simpleName.length() - "Amnsr".length()));
        }
        if (simpleName.endsWith("Amns")) {
            candidates.add(packagePrefix + simpleName.substring(0, simpleName.length() - "Amns".length()));
        }

        String normalizedTarget = normalizeSpiderToken(simpleName);
        List<RankedClassCandidate> discovered = new ArrayList<>();
        for (ClassLoader loader : loaders) {
            discovered.addAll(discoverRuntimeDelegateCandidates(loader, normalizedTarget));
        }
        discovered.sort(Comparator.comparingInt(RankedClassCandidate::score).reversed());
        for (RankedClassCandidate candidate : discovered) {
            candidates.add(candidate.className);
        }

        return new ArrayList<>(candidates);
    }

    private static Spider instantiateDelegate(ClassLoader loader, String className) {
        if (loader == null || className == null || className.trim().isEmpty()) {
            return null;
        }

        try {
            Class<?> delegateClass = Class.forName(className, true, loader);
            if (!Spider.class.isAssignableFrom(delegateClass)
                    || BaseSpiderAmns.class.isAssignableFrom(delegateClass)) {
                return null;
            }

            Constructor<?> ctor = delegateClass.getDeclaredConstructor();
            ctor.setAccessible(true);
            Object instance = ctor.newInstance();
            return instance instanceof Spider ? (Spider) instance : null;
        } catch (Throwable error) {
            return null;
        }
    }

    private static List<RankedClassCandidate> discoverRuntimeDelegateCandidates(ClassLoader loader, String normalizedTarget) {
        if (!(loader instanceof URLClassLoader) || normalizedTarget == null || normalizedTarget.isEmpty()) {
            return Collections.emptyList();
        }

        List<RankedClassCandidate> discovered = new ArrayList<>();
        URL[] urls = ((URLClassLoader) loader).getURLs();
        for (URL url : urls) {
            String protocol = url.getProtocol();
            if (protocol == null || (!"file".equalsIgnoreCase(protocol) && !"jar".equalsIgnoreCase(protocol))) {
                continue;
            }

            File file;
            try {
                file = new File(url.toURI());
            } catch (Throwable ignored) {
                continue;
            }
            if (!file.isFile() || !file.getName().toLowerCase().endsWith(".jar")) {
                continue;
            }

            try (JarFile jarFile = new JarFile(file)) {
                java.util.Enumeration<JarEntry> entries = jarFile.entries();
                while (entries.hasMoreElements()) {
                    JarEntry entry = entries.nextElement();
                    String name = entry.getName();
                    if (!name.startsWith("com/github/catvod/spider/")
                            || !name.endsWith(".class")
                            || name.contains("$")) {
                        continue;
                    }

                    String className = name.substring(0, name.length() - ".class".length()).replace('/', '.');
                    if (className.endsWith("BaseSpiderAmns")
                            || className.endsWith(".Init")
                            || className.endsWith(".DexNative")
                            || className.endsWith("Amns")
                            || className.endsWith("Amnsr")) {
                        continue;
                    }

                    int separator = className.lastIndexOf('.');
                    String simpleName = separator >= 0 ? className.substring(separator + 1) : className;
                    int score = scoreSpiderCandidate(normalizedTarget, normalizeSpiderToken(simpleName));
                    if (score > 0) {
                        discovered.add(new RankedClassCandidate(className, score));
                    }
                }
            } catch (Throwable ignored) {
            }
        }

        return discovered;
    }

    private static String normalizeSpiderToken(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[^A-Za-z0-9]", "").toLowerCase();
    }

    private static int scoreSpiderCandidate(String target, String candidate) {
        int best = 0;
        for (String targetVariant : buildSpiderTokenVariants(target)) {
            for (String candidateVariant : buildSpiderTokenVariants(candidate)) {
                best = Math.max(best, scoreNormalizedSpiderTokens(targetVariant, candidateVariant));
            }
        }
        return best;
    }

    private static int scoreNormalizedSpiderTokens(String target, String candidate) {
        if (target.isEmpty() || candidate.isEmpty()) {
            return 0;
        }
        if (target.equals(candidate)) {
            return 100;
        }
        if (candidate.startsWith(target) || target.startsWith(candidate)) {
            return 85;
        }

        int commonPrefix = 0;
        int maxPrefix = Math.min(target.length(), candidate.length());
        while (commonPrefix < maxPrefix && target.charAt(commonPrefix) == candidate.charAt(commonPrefix)) {
            commonPrefix += 1;
        }

        int distance = levenshteinDistance(target, candidate);
        if (commonPrefix >= 2 && distance <= 2) {
            return 78;
        }
        if (commonPrefix >= 2 && distance <= 4) {
            return 64;
        }
        if (commonPrefix >= 2 && distance <= 5) {
            return 54;
        }
        if (commonPrefix >= 1 && distance <= 3) {
            return 48;
        }
        return 0;
    }

    private static List<String> buildSpiderTokenVariants(String value) {
        LinkedHashSet<String> variants = new LinkedHashSet<>();
        String normalized = normalizeSpiderToken(value);
        if (normalized.isEmpty()) {
            return Collections.emptyList();
        }

        variants.add(normalized);

        String strippedSuffix = stripSpiderSuffix(normalized);
        if (!strippedSuffix.isEmpty()) {
            variants.add(strippedSuffix);
        }

        String strippedPrefix = stripSpiderPrefix(normalized);
        if (!strippedPrefix.isEmpty()) {
            variants.add(strippedPrefix);
            String strippedBoth = stripSpiderSuffix(strippedPrefix);
            if (!strippedBoth.isEmpty()) {
                variants.add(strippedBoth);
            }
        }

        return new ArrayList<>(variants);
    }

    private static String stripSpiderPrefix(String token) {
        if (token.startsWith("app") && token.length() > 5) {
            return token.substring(3);
        }
        return token;
    }

    private static String stripSpiderSuffix(String token) {
        String current = token;
        String[] suffixes = new String[] { "spider", "provider", "bridge", "play", "app", "api", "vod" };
        boolean changed = true;
        while (changed) {
            changed = false;
            for (String suffix : suffixes) {
                if (current.endsWith(suffix) && current.length() > suffix.length() + 1) {
                    current = current.substring(0, current.length() - suffix.length());
                    changed = true;
                    break;
                }
            }
        }
        return current;
    }

    private static int levenshteinDistance(String left, String right) {
        int[] previous = new int[right.length() + 1];
        int[] current = new int[right.length() + 1];
        for (int j = 0; j <= right.length(); j++) {
            previous[j] = j;
        }
        for (int i = 1; i <= left.length(); i++) {
            current[0] = i;
            for (int j = 1; j <= right.length(); j++) {
                int cost = left.charAt(i - 1) == right.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(
                        Math.min(current[j - 1] + 1, previous[j] + 1),
                        previous[j - 1] + cost);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[right.length()];
    }

    private static final class RankedClassCandidate {
        private final String className;
        private final int score;

        private RankedClassCandidate(String className, int score) {
            this.className = className;
            this.score = score;
        }

        private int score() {
            return score;
        }
    }

    @Override
    public String action(String action) {
        return ensureDelegate().action(action);
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter, java.util.HashMap<String, String> extend)
            throws Exception {
        return ensureDelegate().categoryContent(tid, pg, filter, extend);
    }

    @Override
    public void destroy() {
        ensureDelegate().destroy();
    }

    @Override
    public String detailContent(java.util.List<String> ids) throws Exception {
        return ensureDelegate().detailContent(ids);
    }

    @Override
    public String homeContent(boolean filter) throws Exception {
        return ensureDelegate().homeContent(filter);
    }

    @Override
    public String homeVideoContent() throws Exception {
        return ensureDelegate().homeVideoContent();
    }

    @Override
    public void init(Context context, String extend) throws Exception {
        Init.init(context, extend);
        ensureDelegate().init(context, extend);
    }

    @Override
    public boolean isVideoFormat(String url) throws Exception {
        return ensureDelegate().isVideoFormat(url);
    }

    @Override
    public String liveContent(String url) {
        return ensureDelegate().liveContent(url);
    }

    @Override
    public boolean manualVideoCheck() throws Exception {
        return ensureDelegate().manualVideoCheck();
    }

    @Override
    public String playerContent(String flag, String id, java.util.List<String> vipFlags) throws Exception {
        return ensureDelegate().playerContent(flag, id, vipFlags);
    }

    @Override
    public Object[] proxyLocal(Map<String, String> params) throws Exception {
        return ensureDelegate().proxyLocal(params);
    }

    @Override
    public String searchContent(String key, boolean quick) throws Exception {
        return ensureDelegate().searchContent(key, quick);
    }

    @Override
    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return ensureDelegate().searchContent(key, quick, pg);
    }

    private static final class MissingDelegateSpider extends Spider {
        private final String ownerClassName;

        private MissingDelegateSpider(String ownerClassName) {
            this.ownerClassName = ownerClassName;
        }

        @Override
        public String homeContent(boolean filter) {
            System.err.println("DEBUG: MissingDelegateSpider.homeContent fallback for " + ownerClassName);
            return "{\"class\":[],\"list\":[]}";
        }

        @Override
        public String categoryContent(String tid, String pg, boolean filter, java.util.HashMap<String, String> extend) {
            return "{\"list\":[],\"page\":1,\"pagecount\":1,\"limit\":0,\"total\":0}";
        }

        @Override
        public String detailContent(java.util.List<String> ids) {
            return "{\"list\":[]}";
        }

        @Override
        public String searchContent(String key, boolean quick) {
            return "{\"list\":[]}";
        }

        @Override
        public String playerContent(String flag, String id, java.util.List<String> vipFlags) {
            return "{\"parse\":1,\"url\":\"\"}";
        }
    }
}
