package com.github.catvod.spider;

import android.content.Context;
import com.github.catvod.crawler.Spider;
import java.lang.reflect.Constructor;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * Desktop-safe delegate wrapper for *Amns spiders.
 * The transformed jars sometimes lose the constructor body that initializes the
 * wrapped spider instance; this bridge class restores that behavior.
 */
public class BaseSpiderAmns extends Spider {
    public final Spider o0OoO0oO0oOoO0O0oO;

    public BaseSpiderAmns() {
        this.o0OoO0oO0oOoO0O0oO = resolveDelegate();
    }

    private Spider resolveDelegate() {
        List<String> candidates = buildDelegateCandidates(getClass().getName());
        ClassLoader[] loaders = new ClassLoader[] { getClass().getClassLoader(), BaseSpiderAmns.class.getClassLoader() };

        for (String candidate : candidates) {
            for (ClassLoader loader : loaders) {
                Spider delegate = instantiateDelegate(loader, candidate);
                if (delegate != null) {
                    System.err.println("DEBUG: BaseSpiderAmns delegate resolved: " + getClass().getName() + " -> " + candidate);
                    return delegate;
                }
            }
        }

        System.err.println("DEBUG: BaseSpiderAmns delegate unresolved for " + getClass().getName() + " candidates=" + candidates);
        return new MissingDelegateSpider(getClass().getName());
    }

    private static List<String> buildDelegateCandidates(String className) {
        LinkedHashSet<String> candidates = new LinkedHashSet<>();
        if (className == null || className.trim().isEmpty()) {
            return java.util.Collections.emptyList();
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

        return new java.util.ArrayList<>(candidates);
    }

    private static Spider instantiateDelegate(ClassLoader loader, String className) {
        if (loader == null || className == null || className.trim().isEmpty()) {
            return null;
        }

        try {
            Class<?> delegateClass = Class.forName(className, true, loader);
            if (!Spider.class.isAssignableFrom(delegateClass) || BaseSpiderAmns.class.equals(delegateClass)) {
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

    @Override
    public String action(String action) {
        return o0OoO0oO0oOoO0O0oO.action(action);
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter, java.util.HashMap<String, String> extend)
            throws Exception {
        return o0OoO0oO0oOoO0O0oO.categoryContent(tid, pg, filter, extend);
    }

    @Override
    public void destroy() {
        o0OoO0oO0oOoO0O0oO.destroy();
    }

    @Override
    public String detailContent(java.util.List<String> ids) throws Exception {
        return o0OoO0oO0oOoO0O0oO.detailContent(ids);
    }

    @Override
    public String homeContent(boolean filter) throws Exception {
        return o0OoO0oO0oOoO0O0oO.homeContent(filter);
    }

    @Override
    public String homeVideoContent() throws Exception {
        return o0OoO0oO0oOoO0O0oO.homeVideoContent();
    }

    @Override
    public void init(Context context, String extend) throws Exception {
        o0OoO0oO0oOoO0O0oO.init(context, extend);
    }

    @Override
    public boolean isVideoFormat(String url) throws Exception {
        return o0OoO0oO0oOoO0O0oO.isVideoFormat(url);
    }

    @Override
    public String liveContent(String url) {
        return o0OoO0oO0oOoO0O0oO.liveContent(url);
    }

    @Override
    public boolean manualVideoCheck() throws Exception {
        return o0OoO0oO0oOoO0O0oO.manualVideoCheck();
    }

    @Override
    public String playerContent(String flag, String id, java.util.List<String> vipFlags) throws Exception {
        return o0OoO0oO0oOoO0O0oO.playerContent(flag, id, vipFlags);
    }

    @Override
    public Object[] proxyLocal(Map<String, String> params) throws Exception {
        return o0OoO0oO0oOoO0O0oO.proxyLocal(params);
    }

    @Override
    public String searchContent(String key, boolean quick) throws Exception {
        return o0OoO0oO0oOoO0O0oO.searchContent(key, quick);
    }

    @Override
    public String searchContent(String key, boolean quick, String pg) throws Exception {
        return o0OoO0oO0oOoO0O0oO.searchContent(key, quick, pg);
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
