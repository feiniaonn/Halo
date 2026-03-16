package com.halo.spider;

import android.content.Context;
import com.github.catvod.crawler.Spider;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Util;
import okhttp3.FormBody;
import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.Function;
import org.mozilla.javascript.NativeArray;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.File;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rhino-based JS bridge for desktop TVBox spiders.
 * Loads a subset of the APK runtime libraries and exposes APK-like HTTP helpers.
 */
public class JSBridge extends Spider {
    private static final String[] DEFAULT_PRELOAD_LIBS = new String[] {
            "gbk.js"
    };
    private static final Pattern EXPORT_DECL_PATTERN = Pattern.compile(
            "(?m)\\bexport\\s+(function|class|const|let|var)\\s+([A-Za-z_$][\\w$]*)");
    private static final Pattern EXPORT_LIST_PATTERN = Pattern.compile("export\\s*\\{([^}]*)\\}\\s*;?");
    private static final Pattern EXPORT_DEFAULT_NAMED_PATTERN = Pattern.compile(
            "(?m)\\bexport\\s+default\\s+([A-Za-z_$][\\w$]*)\\s*;?");

    private org.mozilla.javascript.Context cx;
    private Scriptable scope;
    private Scriptable spiderObject;
    private final String jsContent;
    private final File runtimeRoot;

    public JSBridge(String jsContent) {
        this(jsContent, "");
    }

    public JSBridge(String jsContent, String runtimeRoot) {
        this.jsContent = jsContent;
        this.runtimeRoot = runtimeRoot == null || runtimeRoot.trim().isEmpty()
                ? null
                : new File(runtimeRoot.trim());
    }

    @Override
    public void init(Context context, String extend) throws Exception {
        cx = ContextFactory.getGlobal().enterContext();
        cx.setOptimizationLevel(-1);
        scope = cx.initStandardObjects();

        injectGlobals();
        preloadRuntimeLibraries();
        evaluateScript(jsContent, "spider.js");
        spiderObject = resolveSpiderObject();

        invokeJS("init", extend);
    }

    private void injectGlobals() {
        putGlobal("globalThis", scope);
        putGlobal("global", scope);
        putGlobal("window", scope);
        putGlobal("self", scope);

        Scriptable console = cx.newObject(scope);
        ScriptableObject.putProperty(console, "log", createConsoleLogger("log"));
        ScriptableObject.putProperty(console, "warn", createConsoleLogger("warn"));
        ScriptableObject.putProperty(console, "error", createConsoleLogger("error"));
        putGlobal("console", console);

        putGlobal("req", createHttpFunction());
        putGlobal("http", createHttpFunction());
        putGlobal("_http", createRawHttpFunction());
        putGlobal("joinUrl", createJoinUrlFunction());
        putGlobal("md5", createMd5Function());
        putGlobal("base64Encode", createBase64EncodeFunction());
        putGlobal("base64Decode", createBase64DecodeFunction());
        putGlobal("btoa", createBase64EncodeFunction());
        putGlobal("atob", createBase64DecodeFunction());
        putGlobal("__HALO_PROXY_BASE_URL__", getProxyBaseUrl());
        putGlobal("localProxy", createLocalProxyFunction());
        putGlobal("nativeCall", createNativeCallFunction());
        putGlobal("CryptoJS", createCryptoShim());
        injectSimilarityShim();
        injectBatchFetchShim();
    }

    private void preloadRuntimeLibraries() {
        if (runtimeRoot == null || !runtimeRoot.isDirectory()) {
            return;
        }

        File libDir = new File(new File(runtimeRoot, "js"), "lib");
        if (!libDir.isDirectory()) {
            return;
        }

        for (String libName : DEFAULT_PRELOAD_LIBS) {
            File libFile = new File(libDir, libName);
            if (!libFile.isFile()) {
                continue;
            }

            try {
                String libScript = Files.readString(libFile.toPath(), StandardCharsets.UTF_8);
                evaluateScript(libScript, libFile.getName());
            } catch (Throwable error) {
                System.err.println("DEBUG: JS runtime preload skipped for " + libName + ": " + error.getMessage());
            }
        }
    }

    private void evaluateScript(String script, String sourceName) {
        String prepared = preprocessModuleScript(script);
        cx.evaluateString(scope, prepared, sourceName, 1, null);
    }

    private String preprocessModuleScript(String script) {
        if (script == null || script.isEmpty()) {
            return "";
        }

        String prepared = script.replace("export default ", "globalThis.__default_export__ = ");

        List<String> exportedNames = new ArrayList<>();
        Matcher declarationMatcher = EXPORT_DECL_PATTERN.matcher(prepared);
        StringBuffer declarationBuffer = new StringBuffer();
        while (declarationMatcher.find()) {
            exportedNames.add(declarationMatcher.group(2));
            declarationMatcher.appendReplacement(
                    declarationBuffer,
                    Matcher.quoteReplacement(declarationMatcher.group(1) + " " + declarationMatcher.group(2)));
        }
        declarationMatcher.appendTail(declarationBuffer);
        prepared = declarationBuffer.toString();

        Matcher exportListMatcher = EXPORT_LIST_PATTERN.matcher(prepared);
        StringBuffer exportListBuffer = new StringBuffer();
        while (exportListMatcher.find()) {
            exportListMatcher.appendReplacement(
                    exportListBuffer,
                    Matcher.quoteReplacement(buildExportAssignments(exportListMatcher.group(1))));
        }
        exportListMatcher.appendTail(exportListBuffer);
        prepared = exportListBuffer.toString();

        Matcher defaultMatcher = EXPORT_DEFAULT_NAMED_PATTERN.matcher(prepared);
        StringBuffer defaultBuffer = new StringBuffer();
        while (defaultMatcher.find()) {
            defaultMatcher.appendReplacement(
                    defaultBuffer,
                    Matcher.quoteReplacement(
                            "globalThis.default = " + defaultMatcher.group(1) + "; globalThis.__default_export__ = "
                                    + defaultMatcher.group(1) + ";"));
        }
        defaultMatcher.appendTail(defaultBuffer);
        prepared = defaultBuffer.toString();

        if (!exportedNames.isEmpty()) {
            StringBuilder tail = new StringBuilder(prepared.length() + 128);
            tail.append(prepared);
            tail.append('\n');
            for (String name : exportedNames) {
                tail.append("globalThis.").append(name).append(" = ").append(name).append(";\n");
            }
            prepared = tail.toString();
        }

        return prepared;
    }

    private String buildExportAssignments(String exportList) {
        StringBuilder assignments = new StringBuilder();
        for (String item : exportList.split(",")) {
            String trimmed = item.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            String exportedName = trimmed;
            String localName = trimmed;
            int aliasIndex = trimmed.indexOf(" as ");
            if (aliasIndex > 0) {
                localName = trimmed.substring(0, aliasIndex).trim();
                exportedName = trimmed.substring(aliasIndex + 4).trim();
            }

            assignments
                    .append("globalThis.")
                    .append(exportedName)
                    .append(" = ")
                    .append(localName)
                    .append(";\n");

            if ("default".equals(exportedName)) {
                assignments
                        .append("globalThis.__default_export__ = ")
                        .append(localName)
                        .append(";\n");
            }
        }
        return assignments.toString();
    }

    private BaseFunction createConsoleLogger(final String level) {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                StringBuilder message = new StringBuilder();
                for (int index = 0; index < args.length; index++) {
                    if (index > 0) {
                        message.append(' ');
                    }
                    message.append(toJsString(args[index]));
                }
                System.err.println("DEBUG: JS console." + level + ": " + message);
                return Undefined.instance;
            }
        };
    }

    private BaseFunction createHttpFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return executeHttp(args);
            }
        };
    }

    private BaseFunction createRawHttpFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return executeHttp(args);
            }
        };
    }

    private BaseFunction createJoinUrlFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.joinUrl(toJsString(args[0]), toJsString(args[1]));
            }
        };
    }

    private BaseFunction createMd5Function() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.md5(toJsString(args[0]));
            }
        };
    }

    private BaseFunction createBase64EncodeFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.base64Encode(toJsString(args[0]).getBytes(StandardCharsets.UTF_8));
            }
        };
    }

    private BaseFunction createBase64DecodeFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return Util.base64Decode(toJsString(args[0]));
            }
        };
    }

    private BaseFunction createLocalProxyFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                String proxyUrl = getProxyUrl();
                if (!proxyUrl.isEmpty()) {
                    return proxyUrl;
                }
                return com.github.catvod.Proxy.getUrl(true);
            }
        };
    }

    private BaseFunction createNativeCallFunction() {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                if (args.length < 3) {
                    return null;
                }
                try {
                    String soPath = toJsString(args[0]);
                    String className = toJsString(args[1]);
                    String methodExpr = toJsString(args[2]);

                    com.halo.spider.native_bridge.NativeLoader loader =
                            com.halo.spider.native_bridge.NativeLoader.getInstance();
                    File soFile = new File(soPath);
                    if (!soFile.exists()) {
                        return "Error: .so file not found at " + soPath;
                    }

                    loader.loadLibrary(soFile);

                    int parenIdx = methodExpr.indexOf('(');
                    if (parenIdx == -1) {
                        return "Error: invalid method signature " + methodExpr;
                    }

                    String methodName = methodExpr.substring(0, parenIdx);
                    String signature = methodExpr.substring(parenIdx);
                    Object[] callArgs = new Object[args.length - 3];
                    System.arraycopy(args, 3, callArgs, 0, callArgs.length);

                    return loader.callStaticMethod(className, methodName, signature, callArgs);
                } catch (Exception error) {
                    return "Error: " + error.getMessage();
                }
            }
        };
    }

    private void injectSimilarityShim() {
        evaluateScript(
                "function compareTwoStrings(first, second) {\n"
                        + "  first = String(first || '').replace(/\\s+/g, '');\n"
                        + "  second = String(second || '').replace(/\\s+/g, '');\n"
                        + "  if (first === second) return 1;\n"
                        + "  if (first.length < 2 || second.length < 2) return 0;\n"
                        + "  var firstBigrams = {};\n"
                        + "  var i, bigram, count;\n"
                        + "  for (i = 0; i < first.length - 1; i++) {\n"
                        + "    bigram = first.substring(i, i + 2);\n"
                        + "    count = firstBigrams[bigram] || 0;\n"
                        + "    firstBigrams[bigram] = count + 1;\n"
                        + "  }\n"
                        + "  var intersectionSize = 0;\n"
                        + "  for (i = 0; i < second.length - 1; i++) {\n"
                        + "    bigram = second.substring(i, i + 2);\n"
                        + "    count = firstBigrams[bigram] || 0;\n"
                        + "    if (count > 0) {\n"
                        + "      firstBigrams[bigram] = count - 1;\n"
                        + "      intersectionSize++;\n"
                        + "    }\n"
                        + "  }\n"
                        + "  return (2 * intersectionSize) / (first.length + second.length - 2);\n"
                        + "}\n"
                        + "function findBestMatch(mainString, targetStrings) {\n"
                        + "  var ratings = [];\n"
                        + "  var bestMatchIndex = 0;\n"
                        + "  var i, currentTargetString, currentRating;\n"
                        + "  for (i = 0; i < targetStrings.length; i++) {\n"
                        + "    currentTargetString = targetStrings[i];\n"
                        + "    currentRating = compareTwoStrings(mainString, currentTargetString);\n"
                        + "    ratings.push({ target: currentTargetString, rating: currentRating });\n"
                        + "    if (currentRating > ratings[bestMatchIndex].rating) bestMatchIndex = i;\n"
                        + "  }\n"
                        + "  return { ratings: ratings, bestMatch: ratings[bestMatchIndex], bestMatchIndex: bestMatchIndex };\n"
                        + "}\n"
                        + "function lcs(str1, str2) {\n"
                        + "  if (!str1 || !str2) return { length: 0, sequence: '', offset: 0 };\n"
                        + "  var sequence = '';\n"
                        + "  var str1Length = str1.length;\n"
                        + "  var str2Length = str2.length;\n"
                        + "  var num = new Array(str1Length);\n"
                        + "  var maxlen = 0;\n"
                        + "  var lastSubsBegin = 0;\n"
                        + "  var i, j;\n"
                        + "  var thisSubsBegin = null;\n"
                        + "  for (i = 0; i < str1Length; i++) {\n"
                        + "    num[i] = new Array(str2Length);\n"
                        + "    for (j = 0; j < str2Length; j++) num[i][j] = 0;\n"
                        + "  }\n"
                        + "  for (i = 0; i < str1Length; i++) {\n"
                        + "    for (j = 0; j < str2Length; j++) {\n"
                        + "      if (str1.charAt(i) !== str2.charAt(j)) {\n"
                        + "        num[i][j] = 0;\n"
                        + "      } else {\n"
                        + "        num[i][j] = (i === 0 || j === 0) ? 1 : 1 + num[i - 1][j - 1];\n"
                        + "        if (num[i][j] > maxlen) {\n"
                        + "          maxlen = num[i][j];\n"
                        + "          thisSubsBegin = i - num[i][j] + 1;\n"
                        + "          if (lastSubsBegin === thisSubsBegin) {\n"
                        + "            sequence += str1.charAt(i);\n"
                        + "          } else {\n"
                        + "            lastSubsBegin = thisSubsBegin;\n"
                        + "            sequence = str1.substr(lastSubsBegin, i + 1 - lastSubsBegin);\n"
                        + "          }\n"
                        + "        }\n"
                        + "      }\n"
                        + "    }\n"
                        + "  }\n"
                        + "  return { length: maxlen, sequence: sequence, offset: thisSubsBegin || 0 };\n"
                        + "}\n"
                        + "function findBestLCS(mainString, targetStrings) {\n"
                        + "  var results = [];\n"
                        + "  var bestMatchIndex = 0;\n"
                        + "  var i, currentTargetString, currentLCS;\n"
                        + "  for (i = 0; i < targetStrings.length; i++) {\n"
                        + "    currentTargetString = targetStrings[i];\n"
                        + "    currentLCS = lcs(mainString, currentTargetString);\n"
                        + "    results.push({ target: currentTargetString, lcs: currentLCS });\n"
                        + "    if (currentLCS.length > results[bestMatchIndex].lcs.length) bestMatchIndex = i;\n"
                        + "  }\n"
                        + "  return { allLCS: results, bestMatch: results[bestMatchIndex], bestMatchIndex: bestMatchIndex };\n"
                        + "}\n"
                        + "globalThis.compareTwoStrings = compareTwoStrings;\n"
                        + "globalThis.findBestMatch = findBestMatch;\n"
                        + "globalThis.findBestLCS = findBestLCS;\n",
                "similarity-shim.js");
    }

    private void injectBatchFetchShim() {
        evaluateScript(
                "globalThis.batchFetch = function(items) {\n"
                        + "  var base = String(globalThis.__HALO_PROXY_BASE_URL__ || '').replace(/\\/+$/, '');\n"
                        + "  if (!base) return [];\n"
                        + "  var res = _http(base + '/bf', {\n"
                        + "    method: 'POST',\n"
                        + "    body: JSON.stringify(items || []),\n"
                        + "    headers: { 'Content-Type': 'application/json; charset=utf-8' }\n"
                        + "  });\n"
                        + "  var text = res && (res.content || res.body || '[]');\n"
                        + "  try {\n"
                        + "    return JSON.parse(String(text || '[]'));\n"
                        + "  } catch (error) {\n"
                        + "    console.error('batchFetch parse failed', error && error.message ? error.message : error);\n"
                        + "    return [];\n"
                        + "  }\n"
                        + "};\n",
                "batch-fetch-shim.js");
    }

    private Scriptable createCryptoShim() {
        Scriptable crypto = cx.newObject(scope);

        Scriptable enc = cx.newObject(scope);
        ScriptableObject.putProperty(enc, "Utf8", createEncodingHelper("utf8"));
        ScriptableObject.putProperty(enc, "Hex", createEncodingHelper("hex"));
        ScriptableObject.putProperty(enc, "Base64", createEncodingHelper("base64"));
        ScriptableObject.putProperty(crypto, "enc", enc);

        Scriptable mode = cx.newObject(scope);
        ScriptableObject.putProperty(mode, "CBC", "CBC");
        ScriptableObject.putProperty(mode, "ECB", "ECB");
        ScriptableObject.putProperty(crypto, "mode", mode);

        Scriptable padding = cx.newObject(scope);
        ScriptableObject.putProperty(padding, "Pkcs7", "PKCS7");
        ScriptableObject.putProperty(padding, "Pkcs5", "PKCS5");
        ScriptableObject.putProperty(padding, "NoPadding", "NoPadding");
        ScriptableObject.putProperty(crypto, "pad", padding);

        ScriptableObject.putProperty(crypto, "MD5", createDigestFunction("MD5"));
        ScriptableObject.putProperty(crypto, "SHA1", createDigestFunction("SHA-1"));
        ScriptableObject.putProperty(crypto, "SHA256", createDigestFunction("SHA-256"));
        ScriptableObject.putProperty(crypto, "SHA384", createDigestFunction("SHA-384"));
        ScriptableObject.putProperty(crypto, "SHA512", createDigestFunction("SHA-512"));

        Scriptable aes = cx.newObject(scope);
        ScriptableObject.putProperty(aes, "encrypt", createAesFunction(true));
        ScriptableObject.putProperty(aes, "decrypt", createAesFunction(false));
        ScriptableObject.putProperty(crypto, "AES", aes);

        return crypto;
    }

    private Scriptable createEncodingHelper(final String encoding) {
        Scriptable helper = cx.newObject(scope);
        ScriptableObject.putProperty(helper, "__haloEncoding", encoding);
        ScriptableObject.putProperty(helper, "parse", new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                String value = args.length > 0 ? toJsString(args[0]) : "";
                return createWordArray(parseBytes(value, encoding));
            }
        });
        ScriptableObject.putProperty(helper, "stringify", new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                byte[] value = args.length > 0 ? resolveBytes(args[0], encoding) : new byte[0];
                return encodeBytes(value, encoding);
            }
        });
        return helper;
    }

    private BaseFunction createDigestFunction(final String algorithm) {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                try {
                    byte[] input = args.length > 0 ? resolveBytes(args[0], "utf8") : new byte[0];
                    MessageDigest digest = MessageDigest.getInstance(algorithm);
                    return createWordArray(digest.digest(input));
                } catch (Exception error) {
                    System.err.println("DEBUG: CryptoJS shim " + algorithm + " failed: " + error.getMessage());
                    return createWordArray(new byte[0]);
                }
            }
        };
    }

    private BaseFunction createAesFunction(final boolean encrypt) {
        return new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                try {
                    Object payload = args.length > 0 ? args[0] : "";
                    byte[] keyBytes = normalizeAesKey(args.length > 1 ? resolveBytes(args[1], "utf8") : new byte[0]);
                    Scriptable config = args.length > 2 && args[2] instanceof Scriptable ? (Scriptable) args[2] : null;
                    String mode = config != null ? normalizeMode(readStringProperty(config, "mode")) : "CBC";
                    String padding = config != null ? normalizePadding(readStringProperty(config, "padding")) : "PKCS5Padding";
                    byte[] ivBytes = config != null ? normalizeIv(resolveBytes(readProperty(config, "iv"), "utf8")) : new byte[16];
                    String transformation = "AES/" + mode + "/" + padding;
                    Cipher cipher = Cipher.getInstance(transformation);
                    SecretKeySpec keySpec = new SecretKeySpec(keyBytes, "AES");
                    if ("ECB".equals(mode)) {
                        cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, keySpec);
                    } else {
                        cipher.init(encrypt ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, keySpec, new IvParameterSpec(ivBytes));
                    }

                    byte[] input = encrypt ? resolveBytes(payload, "utf8") : resolveCipherBytes(payload);
                    byte[] output = cipher.doFinal(input);
                    return encrypt ? createCipherParams(output) : createWordArray(output);
                } catch (Exception error) {
                    System.err.println("DEBUG: CryptoJS AES shim failed: " + error.getMessage());
                    return encrypt ? createCipherParams(new byte[0]) : createWordArray(new byte[0]);
                }
            }
        };
    }

    private Object executeHttp(Object[] args) {
        String url = args.length > 0 ? toJsString(args[0]) : "";
        RequestOptions options = parseRequestOptions(args);

        try {
            HttpExecutionResult result = executeHttpRequest(url, options);
            Scriptable response = buildResponseObject(url, result, null, options);
            notifyComplete(options.complete, response);
            return response;
        } catch (Exception error) {
            Scriptable response = buildResponseObject(url, null, error.getMessage(), options);
            notifyComplete(options.complete, response);
            return response;
        }
    }

    private RequestOptions parseRequestOptions(Object[] args) {
        RequestOptions options = new RequestOptions();
        if (args.length < 2 || !(args[1] instanceof Scriptable)) {
            return options;
        }

        Scriptable config = (Scriptable) args[1];
        String method = readStringProperty(config, "method");
        if (!method.isEmpty()) {
            options.method = method.toUpperCase();
        }

        Object headersValue = readProperty(config, "headers");
        if (headersValue instanceof Scriptable) {
            options.headers = toStringMap((Scriptable) headersValue);
        }

        Object completeValue = readProperty(config, "complete");
        if (completeValue instanceof Function) {
            options.complete = (Function) completeValue;
        }

        Object asyncValue = readProperty(config, "async");
        if (asyncValue instanceof Boolean) {
            options.async = (Boolean) asyncValue;
        }

        String postType = readStringProperty(config, "postType");
        if (!postType.isEmpty()) {
            options.postType = normalizePostType(postType);
        }

        Object redirectValue = readProperty(config, "redirect");
        if (redirectValue instanceof Number) {
            options.followRedirects = ((Number) redirectValue).intValue() != 0;
        } else if (!isUndefined(redirectValue)) {
            options.followRedirects = !"0".equals(toJsString(redirectValue).trim());
        }

        Object timeoutValue = readProperty(config, "timeout");
        if (timeoutValue instanceof Number) {
            options.timeoutMs = Math.max(1L, ((Number) timeoutValue).longValue());
        } else if (!isUndefined(timeoutValue)) {
            try {
                options.timeoutMs = Math.max(1L, Long.parseLong(toJsString(timeoutValue).trim()));
            } catch (NumberFormatException ignored) {
                // Keep default timeout when the incoming value is malformed.
            }
        }

        Object bufferValue = readProperty(config, "buffer");
        if (bufferValue instanceof Number) {
            options.buffer = ((Number) bufferValue).intValue();
        } else if (!isUndefined(bufferValue)) {
            try {
                options.buffer = Integer.parseInt(toJsString(bufferValue).trim());
            } catch (NumberFormatException ignored) {
                // Keep default buffer mode.
            }
        }

        Object bodyValue = readProperty(config, "body");
        if (isUndefined(bodyValue)) {
            bodyValue = readProperty(config, "data");
        }

        if (!isUndefined(bodyValue)) {
            String contentType = findHeader(options.headers, "Content-Type");
            if (options.postType.isEmpty()) {
                options.postType = inferPostType(contentType, bodyValue);
            }
            if (bodyValue instanceof Scriptable && !(bodyValue instanceof NativeArray)) {
                if ("json".equals(options.postType) || contentType.contains("json")) {
                    options.body = new JSONObject(toObjectMap((Scriptable) bodyValue)).toString();
                } else {
                    options.formBody = toStringMap((Scriptable) bodyValue);
                }
            } else if (bodyValue instanceof NativeArray && "json".equals(options.postType)) {
                options.body = unwrapJsValue(bodyValue).toString();
            } else {
                options.body = toJsString(bodyValue);
            }
        }

        return options;
    }

    private HttpExecutionResult executeHttpRequest(String url, RequestOptions options) throws Exception {
        if (RustTransportBridge.isEnabled()) {
            try {
                RustTransportBridge.TransportResponse response = RustTransportBridge.execute(
                        url,
                        options.method,
                        options.headers,
                        options.body,
                        options.formBody,
                        options.postType,
                        options.followRedirects,
                        options.timeoutMs);
                return new HttpExecutionResult(
                        response.statusCode,
                        response.finalUrl,
                        response.bodyBytes,
                        response.headers);
            } catch (IOException error) {
                System.err.println("DEBUG: JSBridge unified transport failed for " + url + " -> " + error.getMessage());
            }
        }

        OkHttpClient client = OkHttp.get()
                .newBuilder()
                .connectTimeout(options.timeoutMs, TimeUnit.MILLISECONDS)
                .readTimeout(options.timeoutMs, TimeUnit.MILLISECONDS)
                .writeTimeout(options.timeoutMs, TimeUnit.MILLISECONDS)
                .followRedirects(options.followRedirects)
                .followSslRedirects(options.followRedirects)
                .build();

        Request.Builder builder = new Request.Builder().url(url);
        boolean hasUserAgent = false;
        for (Map.Entry<String, String> entry : options.headers.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            builder.addHeader(entry.getKey(), entry.getValue());
            if ("User-Agent".equalsIgnoreCase(entry.getKey())) {
                hasUserAgent = true;
            }
        }
        if (!hasUserAgent) {
            builder.addHeader(
                    "User-Agent",
                    "Mozilla/5.0 (Linux; Android 11; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36");
        }

        String method = options.method == null || options.method.trim().isEmpty()
                ? "GET"
                : options.method.trim().toUpperCase();
        if ("GET".equals(method)) {
            builder.get();
        } else if ("HEAD".equals(method)) {
            builder.head();
        } else {
            builder.method(method, buildRequestBody(options));
        }

        try (Response response = client.newCall(builder.build()).execute()) {
            byte[] bodyBytes = response.body() != null ? response.body().bytes() : new byte[0];
            return new HttpExecutionResult(
                    response.code(),
                    response.request().url().toString(),
                    bodyBytes,
                    response.headers().toMultimap());
        }
    }

    private RequestBody buildRequestBody(RequestOptions options) {
        String contentType = findHeader(options.headers, "Content-Type");
        if ("form".equals(options.postType)) {
            FormBody.Builder builder = new FormBody.Builder();
            if (options.formBody != null) {
                for (Map.Entry<String, String> entry : options.formBody.entrySet()) {
                    builder.add(entry.getKey(), entry.getValue() == null ? "" : entry.getValue());
                }
            }
            return builder.build();
        }
        if ("form-data".equals(options.postType)) {
            MultipartBody.Builder builder = new MultipartBody.Builder().setType(MultipartBody.FORM);
            if (options.formBody != null) {
                for (Map.Entry<String, String> entry : options.formBody.entrySet()) {
                    builder.addFormDataPart(entry.getKey(), entry.getValue() == null ? "" : entry.getValue());
                }
            }
            return builder.build();
        }

        String mediaType = contentType;
        String body = options.body == null ? "" : options.body;
        if (mediaType == null || mediaType.trim().isEmpty()) {
            mediaType = "json".equals(options.postType)
                    ? "application/json; charset=utf-8"
                    : "text/plain; charset=utf-8";
        }
        return RequestBody.create(MediaType.parse(mediaType), body);
    }

    private Scriptable buildResponseObject(String url, HttpExecutionResult result, String errorMessage, RequestOptions options) {
        Scriptable response = cx.newObject(scope);
        int code = result != null ? result.statusCode : 500;
        Object body = renderResponseBody(result == null ? new byte[0] : result.bodyBytes, result, options);

        ScriptableObject.putProperty(response, "ok", errorMessage == null && code >= 200 && code < 300);
        ScriptableObject.putProperty(response, "status", code);
        ScriptableObject.putProperty(response, "code", code);
        ScriptableObject.putProperty(response, "url", result != null ? result.finalUrl : url);
        ScriptableObject.putProperty(response, "body", body);
        ScriptableObject.putProperty(response, "content", body);
        ScriptableObject.putProperty(response, "error", errorMessage == null ? "" : errorMessage);

        Scriptable headers = cx.newObject(scope);
        if (result != null && result.headers != null) {
            for (Map.Entry<String, List<String>> entry : result.headers.entrySet()) {
                if (entry.getKey() == null || entry.getKey().trim().isEmpty()) {
                    continue;
                }
                Object headerValue = toJsHeaderValue(entry.getValue());
                ScriptableObject.putProperty(headers, entry.getKey(), headerValue);
                ScriptableObject.putProperty(headers, entry.getKey().toLowerCase(), headerValue);
            }
        }
        ScriptableObject.putProperty(response, "header", headers);
        ScriptableObject.putProperty(response, "headers", headers);
        return response;
    }

    private Object renderResponseBody(byte[] bodyBytes, HttpExecutionResult result, RequestOptions options) {
        if (options != null && options.buffer == 1) {
            Object[] signed = new Object[bodyBytes.length];
            for (int index = 0; index < bodyBytes.length; index++) {
                signed[index] = Integer.valueOf((int) bodyBytes[index]);
            }
            return cx.newArray(scope, signed);
        }
        if (options != null && options.buffer == 2) {
            return Base64.getEncoder().withoutPadding().encodeToString(bodyBytes);
        }
        return decodeResponseText(bodyBytes, result, options);
    }

    private String decodeResponseText(byte[] bodyBytes, HttpExecutionResult result, RequestOptions options) {
        String charsetName = "";
        if (result != null) {
            charsetName = extractCharset(findHeaderList(result.headers, "Content-Type"));
        }
        if (charsetName.isEmpty() && options != null) {
            charsetName = extractCharset(findHeader(options.headers, "Content-Type"));
        }
        if (charsetName.isEmpty()) {
            charsetName = "UTF-8";
        }
        try {
            return new String(bodyBytes, Charset.forName(charsetName));
        } catch (Exception ignored) {
            return new String(bodyBytes, StandardCharsets.UTF_8);
        }
    }

    private String extractCharset(String contentType) {
        if (contentType == null || contentType.trim().isEmpty()) {
            return "";
        }
        String[] parts = contentType.split(";");
        for (String part : parts) {
            String trimmed = part.trim();
            if (trimmed.regionMatches(true, 0, "charset=", 0, 8)) {
                return trimmed.substring(8).trim().replace("\"", "");
            }
        }
        return "";
    }

    private String findHeaderList(Map<String, List<String>> headers, String name) {
        if (headers == null || headers.isEmpty()) {
            return "";
        }
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (!name.equalsIgnoreCase(entry.getKey())) {
                continue;
            }
            if (entry.getValue() == null || entry.getValue().isEmpty()) {
                return "";
            }
            return entry.getValue().get(0);
        }
        return "";
    }

    private String inferPostType(String contentType, Object bodyValue) {
        String normalizedContentType = contentType == null ? "" : contentType.toLowerCase();
        if (normalizedContentType.contains("multipart/form-data")) {
            return "form-data";
        }
        if (normalizedContentType.contains("application/x-www-form-urlencoded")) {
            return "form";
        }
        if (normalizedContentType.contains("json")) {
            return "json";
        }
        if (bodyValue instanceof Scriptable && !(bodyValue instanceof NativeArray)) {
            return "json";
        }
        return "raw";
    }

    private String normalizePostType(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase();
        if ("form".equals(normalized) || "form-data".equals(normalized) || "raw".equals(normalized)) {
            return normalized;
        }
        return "json";
    }

    private Scriptable createWordArray(final byte[] bytes) {
        final String encoded = Base64.getEncoder().encodeToString(bytes == null ? new byte[0] : bytes);
        Scriptable wordArray = cx.newObject(scope);
        ScriptableObject.putProperty(wordArray, "__haloBytes", encoded);
        ScriptableObject.putProperty(wordArray, "sigBytes", bytes == null ? 0 : bytes.length);
        ScriptableObject.putProperty(wordArray, "toString", new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                byte[] raw = Base64.getDecoder().decode(encoded);
                if (args.length > 0 && args[0] instanceof Scriptable) {
                    String encoding = readStringProperty((Scriptable) args[0], "__haloEncoding");
                    if (!encoding.isEmpty()) {
                        return encodeBytes(raw, encoding);
                    }
                }
                return encodeBytes(raw, "hex");
            }
        });
        return wordArray;
    }

    private Scriptable createCipherParams(final byte[] cipherBytes) {
        Scriptable params = cx.newObject(scope);
        final Scriptable ciphertext = createWordArray(cipherBytes);
        ScriptableObject.putProperty(params, "ciphertext", ciphertext);
        ScriptableObject.putProperty(params, "toString", new BaseFunction() {
            @Override
            public Object call(org.mozilla.javascript.Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return encodeBytes(resolveBytes(ciphertext, "base64"), "base64");
            }
        });
        return params;
    }

    private String encodeBytes(byte[] bytes, String encoding) {
        if (bytes == null) {
            return "";
        }
        if ("utf8".equalsIgnoreCase(encoding)) {
            return new String(bytes, StandardCharsets.UTF_8);
        }
        if ("base64".equalsIgnoreCase(encoding)) {
            return Base64.getEncoder().encodeToString(bytes);
        }
        return bytesToHex(bytes);
    }

    private byte[] parseBytes(String value, String encoding) {
        if (value == null || value.isEmpty()) {
            return new byte[0];
        }
        try {
            if ("hex".equalsIgnoreCase(encoding)) {
                return hexToBytes(value);
            }
            if ("base64".equalsIgnoreCase(encoding)) {
                return Base64.getDecoder().decode(value);
            }
        } catch (IllegalArgumentException ignored) {
            // Fall back to UTF-8 for malformed inputs that are not actually encoded data.
        }
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private byte[] resolveBytes(Object value, String preferredEncoding) {
        if (isUndefined(value)) {
            return new byte[0];
        }
        if (value instanceof Scriptable) {
            Scriptable scriptable = (Scriptable) value;
            Object stored = readProperty(scriptable, "__haloBytes");
            if (!isUndefined(stored)) {
                return parseBytes(toJsString(stored), "base64");
            }
            Object ciphertext = readProperty(scriptable, "ciphertext");
            if (!isUndefined(ciphertext)) {
                return resolveBytes(ciphertext, preferredEncoding);
            }
        }
        return parseBytes(toJsString(value), preferredEncoding);
    }

    private byte[] resolveCipherBytes(Object value) {
        if (isUndefined(value)) {
            return new byte[0];
        }
        if (value instanceof Scriptable) {
            Scriptable scriptable = (Scriptable) value;
            Object ciphertext = readProperty(scriptable, "ciphertext");
            if (!isUndefined(ciphertext)) {
                return resolveBytes(ciphertext, "base64");
            }
            Object stored = readProperty(scriptable, "__haloBytes");
            if (!isUndefined(stored)) {
                return parseBytes(toJsString(stored), "base64");
            }
        }
        String text = toJsString(value).trim();
        if (text.matches("^[0-9a-fA-F]+$") && text.length() % 2 == 0) {
            return hexToBytes(text);
        }
        return parseBytes(text, "base64");
    }

    private byte[] normalizeAesKey(byte[] keyBytes) {
        if (keyBytes == null || keyBytes.length == 0) {
            return new byte[16];
        }
        if (keyBytes.length <= 16) {
            return Arrays.copyOf(keyBytes, 16);
        }
        if (keyBytes.length <= 24) {
            return Arrays.copyOf(keyBytes, 24);
        }
        return Arrays.copyOf(keyBytes, 32);
    }

    private byte[] normalizeIv(byte[] ivBytes) {
        return Arrays.copyOf(ivBytes == null ? new byte[0] : ivBytes, 16);
    }

    private String normalizeMode(String value) {
        String normalized = value == null ? "" : value.trim().toUpperCase();
        if ("ECB".equals(normalized)) {
            return "ECB";
        }
        return "CBC";
    }

    private String normalizePadding(String value) {
        String normalized = value == null ? "" : value.trim().toUpperCase();
        if ("NOPADDING".equals(normalized)) {
            return "NoPadding";
        }
        return "PKCS5Padding";
    }

    private String bytesToHex(byte[] value) {
        StringBuilder hex = new StringBuilder(value.length * 2);
        for (byte current : value) {
            String part = Integer.toHexString(current & 0xff);
            if (part.length() == 1) {
                hex.append('0');
            }
            hex.append(part);
        }
        return hex.toString();
    }

    private byte[] hexToBytes(String hex) {
        int length = hex.length();
        byte[] data = new byte[length / 2];
        for (int index = 0; index < length; index += 2) {
            data[index / 2] = (byte) Integer.parseInt(hex.substring(index, index + 2), 16);
        }
        return data;
    }

    private Object toJsHeaderValue(List<String> values) {
        if (values == null || values.isEmpty()) {
            return "";
        }
        if (values.size() == 1) {
            return values.get(0);
        }
        return cx.newArray(scope, values.toArray());
    }

    private void notifyComplete(Function complete, Scriptable response) {
        if (complete == null) {
            return;
        }
        try {
            complete.call(cx, scope, scope, new Object[] { response });
        } catch (Exception error) {
            System.err.println("DEBUG: JS request complete callback failed: " + error.getMessage());
        }
    }

    private void putGlobal(String name, Object value) {
        ScriptableObject.putProperty(scope, name, value);
    }

    private Scriptable resolveSpiderObject() {
        Object directSpider = materializeSpiderCandidate(readProperty(scope, "__JS_SPIDER__"));
        if (directSpider instanceof Scriptable) {
            return (Scriptable) directSpider;
        }

        Object evalReturn = readProperty(scope, "__jsEvalReturn");
        if (evalReturn instanceof Function) {
            Object candidate = ((Function) evalReturn).call(cx, scope, scope, new Object[0]);
            candidate = materializeSpiderCandidate(candidate);
            if (candidate instanceof Scriptable) {
                putGlobal("__JS_SPIDER__", candidate);
                return (Scriptable) candidate;
            }
        }

        Object moduleValue = readProperty(scope, "module");
        if (moduleValue instanceof Scriptable) {
            Object exportsValue = readProperty((Scriptable) moduleValue, "exports");
            Object candidate = materializeSpiderCandidate(exportsValue);
            if (candidate instanceof Scriptable) {
                return (Scriptable) candidate;
            }
        }

        Object defaultExport = materializeSpiderCandidate(readProperty(scope, "__default_export__"));
        if (!(defaultExport instanceof Scriptable)) {
            defaultExport = materializeSpiderCandidate(readProperty(scope, "default"));
        }
        if (defaultExport instanceof Scriptable) {
            return (Scriptable) defaultExport;
        }

        return null;
    }

    private Object materializeSpiderCandidate(Object candidate) {
        if (candidate instanceof Function) {
            Object resolved = ((Function) candidate).call(cx, scope, scope, new Object[0]);
            return isUndefined(resolved) ? candidate : resolved;
        }
        return candidate;
    }

    private Object invokeJS(String methodName, Object... args) {
        Object func = readProperty(scope, methodName);
        if (func instanceof Function) {
            return ((Function) func).call(cx, scope, scope, args);
        }

        if (spiderObject != null) {
            Object member = readProperty(spiderObject, methodName);
            if (member instanceof Function) {
                return ((Function) member).call(cx, scope, spiderObject, args);
            }
        }

        return "";
    }

    private Object readProperty(Scriptable scriptable, String name) {
        Object value = ScriptableObject.getProperty(scriptable, name);
        return isUndefined(value) ? Undefined.instance : value;
    }

    private String readStringProperty(Scriptable scriptable, String name) {
        Object value = readProperty(scriptable, name);
        return isUndefined(value) ? "" : toJsString(value);
    }

    private boolean isUndefined(Object value) {
        return value == null || value == Undefined.instance || value == Scriptable.NOT_FOUND;
    }

    private String toJsString(Object value) {
        if (isUndefined(value)) {
            return "";
        }
        return org.mozilla.javascript.Context.toString(value);
    }

    private String findHeader(Map<String, String> headers, String name) {
        if (headers == null || headers.isEmpty()) {
            return "";
        }
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) {
                return entry.getValue() == null ? "" : entry.getValue();
            }
        }
        return "";
    }

    private String getProxyBaseUrl() {
        String value = System.getProperty("halo.proxy.baseUrl", "").trim();
        if (value.endsWith("/proxy")) {
            value = value.substring(0, value.length() - "/proxy".length());
        }
        return value;
    }

    private String getProxyUrl() {
        String baseUrl = getProxyBaseUrl();
        if (baseUrl.isEmpty()) {
            return "";
        }
        return baseUrl.endsWith("/proxy") ? baseUrl : baseUrl + "/proxy";
    }

    private Map<String, String> toStringMap(Scriptable scriptable) {
        Map<String, String> result = new HashMap<>();
        for (Object id : scriptable.getIds()) {
            String key = String.valueOf(id);
            Object value = ScriptableObject.getProperty(scriptable, key);
            if (!isUndefined(value)) {
                result.put(key, toJsString(value));
            }
        }
        return result;
    }

    private Map<String, Object> toObjectMap(Scriptable scriptable) {
        Map<String, Object> result = new HashMap<>();
        for (Object id : scriptable.getIds()) {
            String key = String.valueOf(id);
            Object value = ScriptableObject.getProperty(scriptable, key);
            if (!isUndefined(value)) {
                result.put(key, unwrapJsValue(value));
            }
        }
        return result;
    }

    private Object unwrapJsValue(Object value) {
        if (isUndefined(value)) {
            return JSONObject.NULL;
        }
        if (value instanceof Scriptable && !(value instanceof NativeArray)) {
            return new JSONObject(toObjectMap((Scriptable) value));
        }
        if (value instanceof NativeArray) {
            NativeArray array = (NativeArray) value;
            JSONArray jsonArray = new JSONArray();
            long length = array.getLength();
            for (int index = 0; index < length; index++) {
                jsonArray.put(unwrapJsValue(array.get(index, array)));
            }
            return jsonArray;
        }
        if (value instanceof CharSequence || value instanceof Number || value instanceof Boolean) {
            return value;
        }
        return toJsString(value);
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

    @Override
    public void destroy() {
        if (cx != null) {
            org.mozilla.javascript.Context.exit();
            cx = null;
        }
    }

    private static final class RequestOptions {
        String method = "GET";
        String body = "";
        Map<String, String> formBody;
        Map<String, String> headers = new HashMap<>();
        Function complete;
        boolean async;
        String postType = "json";
        long timeoutMs = 15_000L;
        boolean followRedirects = true;
        int buffer;
    }

    private static final class HttpExecutionResult {
        final int statusCode;
        final String finalUrl;
        final byte[] bodyBytes;
        final Map<String, List<String>> headers;

        HttpExecutionResult(int statusCode, String finalUrl, byte[] bodyBytes, Map<String, List<String>> headers) {
            this.statusCode = statusCode;
            this.finalUrl = finalUrl == null ? "" : finalUrl;
            this.bodyBytes = bodyBytes == null ? new byte[0] : bodyBytes;
            this.headers = headers == null ? new HashMap<String, List<String>>() : headers;
        }
    }
}
