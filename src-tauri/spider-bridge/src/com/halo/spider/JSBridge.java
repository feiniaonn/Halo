package com.halo.spider;

import android.content.Context;
import com.github.catvod.crawler.Spider;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Util;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.io.File;

/**
 * Enhanced Rhino-based JS Bridge for desktop.
 * Provides a high-compatibility environment for CatVod JS spiders (drpy, etc.).
 */
public class JSBridge extends Spider {
    private org.mozilla.javascript.Context cx;
    private Scriptable scope;
    private String jsContent;

    public JSBridge(String jsContent) {
        this.jsContent = jsContent;
    }

    @Override
    public void init(Context context, String extend) throws Exception {
        cx = ContextFactory.getGlobal().enterContext();
        cx.setOptimizationLevel(-1); // Interpret only for best compatibility
        scope = cx.initStandardObjects();

        // 1. Inject Global Functions (CatVod standard)
        injectGlobals();

        // 2. Load the actual JS spider code
        cx.evaluateString(scope, jsContent, "spider.js", 1, null);

        // 3. Call 'init' in JS if it exists
        invokeJS("init", extend);
    }

    private void injectGlobals() {
        // req(url, options) -> OkHttp
        ScriptableObject.putProperty(scope, "req", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                try {
                    String url = (String) args[0];
                    String method = "GET";
                    Map<String, String> headers = null;
                    String body = null;

                    if (args.length > 1 && args[1] instanceof Scriptable) {
                        Scriptable opts = (Scriptable) args[1];
                        method = String.valueOf(ScriptableObject.getProperty(opts, "method"));
                        if (method.equals("undefined")) method = "GET";
                        
                        Object headersObj = ScriptableObject.getProperty(opts, "headers");
                        if (headersObj instanceof Scriptable) {
                            headers = new HashMap<>();
                            Scriptable h = (Scriptable) headersObj;
                            for (Object key : h.getIds()) {
                                headers.put(String.valueOf(key), String.valueOf(h.get(String.valueOf(key), h)));
                            }
                        }
                        body = String.valueOf(ScriptableObject.getProperty(opts, "body"));
                        if (body.equals("undefined")) body = null;
                    }

                    com.github.catvod.net.OkResult result;
                    if ("POST".equalsIgnoreCase(method)) {
                        result = OkHttp.post(url, body != null ? body : "", headers);
                    } else {
                        result = OkHttp.get(url, headers);
                    }
                    return result.getBody();
                } catch (Exception e) {
                    return "";
                }
            }
        });

        // joinUrl(parent, child)
        ScriptableObject.putProperty(scope, "joinUrl", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.joinUrl(String.valueOf(args[0]), String.valueOf(args[1]));
            }
        });

        // md5(str)
        ScriptableObject.putProperty(scope, "md5", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.md5(String.valueOf(args[0]));
            }
        });

        // base64Decode / base64Encode
        ScriptableObject.putProperty(scope, "base64Encode", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.base64Encode(String.valueOf(args[0]).getBytes());
            }
        });

        ScriptableObject.putProperty(scope, "base64Decode", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.base64Decode(String.valueOf(args[0]));
            }
        });

        // localProxy
        ScriptableObject.putProperty(scope, "localProxy", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return com.github.catvod.spider.Proxy.getHostPort() + "/proxy";
            }
        });

        // nativeCall(soPath, className, methodExpr, ...args)
        ScriptableObject.putProperty(scope, "nativeCall", new org.mozilla.javascript.BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 3) return null;
                try {
                    String soPath = String.valueOf(args[0]);
                    String className = String.valueOf(args[1]);
                    String methodExpr = String.valueOf(args[2]); // e.g. "md5(Ljava/lang/String;)Ljava/lang/String;"
                    
                    com.halo.spider.native_bridge.NativeLoader loader = com.halo.spider.native_bridge.NativeLoader.getInstance();
                    File soFile = new File(soPath);
                    if (!soFile.exists()) return "Error: .so file not found at " + soPath;
                    
                    loader.loadLibrary(soFile);
                    
                    int parenIdx = methodExpr.indexOf('(');
                    if (parenIdx == -1) return "Error: invalid method signature " + methodExpr;
                    
                    String methodName = methodExpr.substring(0, parenIdx);
                    String signature = methodExpr.substring(parenIdx);
                    
                    Object[] callArgs = new Object[args.length - 3];
                    System.arraycopy(args, 3, callArgs, 0, callArgs.length);
                    
                    return loader.callStaticMethod(className, methodName, signature, callArgs);
                } catch (Exception e) {
                    return "Error: " + e.getMessage();
                }
            }
        });
    }

    @Override
    public String homeContent(boolean filter) throws Exception {
        return String.valueOf(invokeJS("homeContent", filter));
    }

    @Override
    public String categoryContent(String tid, String pg, boolean filter, HashMap<String, String> extend) throws Exception {
        return String.valueOf(invokeJS("categoryContent", tid, pg, filter, extend));
    }

    @Override
    public String detailContent(List<String> ids) throws Exception {
        return String.valueOf(invokeJS("detailContent", ids));
    }

    @Override
    public String searchContent(String key, boolean quick) throws Exception {
        return String.valueOf(invokeJS("searchContent", key, quick));
    }

    @Override
    public String playerContent(String flag, String id, List<String> vipFlags) throws Exception {
        return String.valueOf(invokeJS("playerContent", flag, id, vipFlags));
    }

    private Object invokeJS(String methodName, Object... args) {
        Object func = scope.get(methodName, scope);
        if (func instanceof Function) {
            return ((Function) func).call(cx, scope, scope, args);
        }
        return "";
    }

    @Override
    public void destroy() {
        org.mozilla.javascript.Context.exit();
    }
}
