/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  org.apache.commons.lang3.StringUtils
 *  org.json.JSONArray
 *  org.json.JSONException
 *  org.json.JSONObject
 */
package com.github.catvod.spider;

import com.github.catvod.crawler.Spider;
import com.github.catvod.crawler.SpiderDebug;
import com.github.catvod.net.OkHttp;
import com.github.catvod.utils.Util;
import java.lang.invoke.CallSite;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.commons.lang3.StringUtils;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class AppYsV2
extends Spider {
    private static final Pattern urlPattern1 = Pattern.compile("api\\.php/.*?/vod");
    private static final Pattern urlPattern2 = Pattern.compile("api\\.php/.+?\\.vod");
    private static final Pattern parsePattern = Pattern.compile("/.+\\?.+=");
    private static final Pattern parsePattern1 = Pattern.compile(".*(url|v|vid|php\\?id)=");
    private static final Pattern parsePattern2 = Pattern.compile("https?://[^/]*");
    protected static final Pattern[] htmlVideoKeyMatch = new Pattern[]{Pattern.compile("player=new"), Pattern.compile("<div id=\"video\""), Pattern.compile("<div id=\"[^\"]*?player\""), Pattern.compile("//\u89c6\u9891\u94fe\u63a5"), Pattern.compile("HlsJsPlayer\\("), Pattern.compile("<iframe[\\s\\S]*?src=\"[^\"]+?\""), Pattern.compile("<video[\\s\\S]*?src=\"[^\"]+?\"")};
    protected final HashMap<String, ArrayList<String>> parseUrlMap = new HashMap();
    private String[] extInfos = null;

    @Override
    public void init(String string) throws Exception {
        super.init(string);
        try {
            JSONObject jSONObject;
            if (string != null && string.trim().startsWith("{") && (jSONObject = new JSONObject(string)).has("url")) {
                string = jSONObject.getString("url");
            }
            this.extInfos = string.split("###");
        }
        catch (Exception exception) {
            // empty catch block
        }
    }

    @Override
    public String homeContent(boolean bl) throws Exception {
        Object object;
        JSONObject jSONObject;
        int n;
        JSONArray jSONArray;
        String string;
        JSONArray jSONArray2;
        String string2;
        block25: {
            block23: {
                block26: {
                    block24: {
                        string2 = this.getCateUrl(this.getApiUrl());
                        jSONArray2 = null;
                        if (string2.isEmpty()) break block23;
                        SpiderDebug.log(string2);
                        string = OkHttp.string(string2, this.getHeaders(string2));
                        jSONArray = new JSONObject(string);
                        if (!jSONArray.has("list") || !(jSONArray.get("list") instanceof JSONArray)) break block24;
                        jSONArray2 = jSONArray.getJSONArray("list");
                        break block25;
                    }
                    if (!jSONArray.has("data") || !(jSONArray.get("data") instanceof JSONObject) || !jSONArray.getJSONObject("data").has("list") || !(jSONArray.getJSONObject("data").get("list") instanceof JSONArray)) break block26;
                    jSONArray2 = jSONArray.getJSONObject("data").getJSONArray("list");
                    break block25;
                }
                if (!jSONArray.has("data") || !(jSONArray.get("data") instanceof JSONArray)) break block25;
                jSONArray2 = jSONArray.getJSONArray("data");
                break block25;
            }
            string = this.getFilterTypes(string2, null);
            jSONArray = string.split("\n")[0].split("\\+");
            jSONArray2 = new JSONArray();
            for (n = 1; n < ((String[])jSONArray).length; ++n) {
                jSONObject = jSONArray[n].trim().split("=");
                if (((String[])jSONObject).length < 2) continue;
                object = new JSONObject();
                object.put("type_name", (Object)jSONObject[0].trim());
                object.put("type_id", (Object)jSONObject[1].trim());
                jSONArray2.put(object);
            }
        }
        string = new JSONObject();
        jSONArray = new JSONArray();
        if (jSONArray2 != null) {
            for (n = 0; n < jSONArray2.length(); ++n) {
                jSONObject = jSONArray2.getJSONObject(n);
                object = jSONObject.getString("type_name");
                String string3 = jSONObject.getString("type_id");
                JSONObject jSONObject2 = new JSONObject();
                jSONObject2.put("type_id", (Object)string3);
                jSONObject2.put("type_name", object);
                JSONObject jSONObject3 = jSONObject.optJSONObject("type_extend");
                if (bl) {
                    int n2;
                    String string4 = this.getFilterTypes(string2, jSONObject3);
                    String[] stringArray = string4.split("\n");
                    JSONArray jSONArray3 = new JSONArray();
                    int n3 = n2 = string2.isEmpty() ? 1 : 0;
                    while (n2 < stringArray.length) {
                        String string5 = stringArray[n2].trim();
                        if (!string5.isEmpty()) {
                            String string6;
                            String[] stringArray2 = string5.split("\\+");
                            String string7 = string6 = stringArray2[0].trim();
                            if (string6.contains("\u7b5b\u9009")) {
                                string6 = string6.replace("\u7b5b\u9009", "");
                                switch (string6) {
                                    case "class": {
                                        string7 = "\u7c7b\u578b";
                                        break;
                                    }
                                    case "area": {
                                        string7 = "\u5730\u533a";
                                        break;
                                    }
                                    case "lang": {
                                        string7 = "\u8bed\u8a00";
                                        break;
                                    }
                                    case "year": {
                                        string7 = "\u5e74\u4efd";
                                    }
                                }
                            }
                            Object object2 = new JSONObject();
                            object2.put("key", (Object)string6);
                            object2.put("name", (Object)string7);
                            JSONArray jSONArray4 = new JSONArray();
                            for (int i = 1; i < stringArray2.length; ++i) {
                                JSONObject jSONObject4 = new JSONObject();
                                String string8 = stringArray2[i].trim();
                                int n4 = string8.indexOf("=");
                                if (n4 == -1) {
                                    jSONObject4.put("n", (Object)string8);
                                    jSONObject4.put("v", (Object)string8);
                                } else {
                                    String string9 = string8.substring(0, n4);
                                    jSONObject4.put("n", (Object)string9.trim());
                                    jSONObject4.put("v", (Object)string8.substring(n4 + 1).trim());
                                }
                                jSONArray4.put((Object)jSONObject4);
                            }
                            object2.put("value", (Object)jSONArray4);
                            jSONArray3.put(object2);
                        }
                        ++n2;
                    }
                    if (!string.has("filters")) {
                        string.put("filters", (Object)new JSONObject());
                    }
                    string.getJSONObject("filters").put(string3, (Object)jSONArray3);
                }
                jSONArray.put((Object)jSONObject2);
            }
        }
        string.put("class", (Object)jSONArray);
        return string.toString();
    }

    @Override
    public String homeVideoContent() throws Exception {
        Object object;
        String string = this.getApiUrl();
        Object object2 = this.getRecommendUrl(string);
        boolean bl = false;
        if (((String)object2).isEmpty()) {
            object2 = this.getCateFilterUrlPrefix(string) + "movie&page=1&area=&type=&start=";
            bl = true;
        }
        SpiderDebug.log((String)object2);
        String string2 = OkHttp.string((String)object2, this.getHeaders((String)object2));
        JSONObject jSONObject = new JSONObject(string2);
        JSONArray jSONArray = new JSONArray();
        if (bl) {
            object = jSONObject.getJSONArray("data");
            for (int i = 0; i < object.length(); ++i) {
                JSONObject jSONObject2 = object.getJSONObject(i);
                JSONObject jSONObject3 = new JSONObject();
                jSONObject3.put("vod_id", (Object)jSONObject2.getString("nextlink"));
                jSONObject3.put("vod_name", (Object)jSONObject2.getString("title"));
                jSONObject3.put("vod_pic", (Object)jSONObject2.getString("pic"));
                jSONObject3.put("vod_remarks", (Object)jSONObject2.getString("state"));
                jSONArray.put((Object)jSONObject3);
            }
        } else {
            object = new ArrayList();
            this.findJsonArray(jSONObject, "vlist", (ArrayList<JSONArray>)object);
            if (((ArrayList)object).isEmpty()) {
                this.findJsonArray(jSONObject, "vod_list", (ArrayList<JSONArray>)object);
            }
            ArrayList<String> arrayList = new ArrayList<String>();
            Iterator iterator = ((ArrayList)object).iterator();
            while (iterator.hasNext()) {
                JSONArray jSONArray2 = (JSONArray)iterator.next();
                for (int i = 0; i < jSONArray2.length(); ++i) {
                    JSONObject jSONObject4 = jSONArray2.getJSONObject(i);
                    String string3 = jSONObject4.getString("vod_id");
                    if (arrayList.contains(string3)) continue;
                    arrayList.add(string3);
                    JSONObject jSONObject5 = new JSONObject();
                    jSONObject5.put("vod_id", (Object)string3);
                    jSONObject5.put("vod_name", (Object)jSONObject4.getString("vod_name"));
                    jSONObject5.put("vod_pic", (Object)jSONObject4.getString("vod_pic"));
                    jSONObject5.put("vod_remarks", (Object)jSONObject4.getString("vod_remarks"));
                    jSONArray.put((Object)jSONObject5);
                }
            }
        }
        object = new JSONObject();
        object.put("list", (Object)jSONArray);
        return object.toString();
    }

    @Override
    public String categoryContent(String string, String string2, boolean bl, HashMap<String, String> hashMap) throws Exception {
        String string3 = this.getApiUrl();
        if (string3 == null || string3.isEmpty() || !string3.startsWith("http")) {
            return new JSONObject().put("list", (Object)new JSONArray()).toString();
        }
        Object object = this.getCateFilterUrlPrefix(string3) + string + this.getCateFilterUrlSuffix(string3);
        object = ((String)object).replace("#PN#", string2);
        object = ((String)object).replace("\u7b5b\u9009class", hashMap != null && hashMap.containsKey("class") ? (CharSequence)hashMap.get("class") : "");
        object = ((String)object).replace("\u7b5b\u9009area", hashMap != null && hashMap.containsKey("area") ? (CharSequence)hashMap.get("area") : "");
        object = ((String)object).replace("\u7b5b\u9009lang", hashMap != null && hashMap.containsKey("lang") ? (CharSequence)hashMap.get("lang") : "");
        object = ((String)object).replace("\u7b5b\u9009year", hashMap != null && hashMap.containsKey("year") ? (CharSequence)hashMap.get("year") : "");
        object = ((String)object).replace("\u6392\u5e8f", hashMap != null && hashMap.containsKey("\u6392\u5e8f") ? (CharSequence)hashMap.get("\u6392\u5e8f") : "");
        SpiderDebug.log((String)object);
        String string4 = OkHttp.string((String)object, this.getHeaders((String)object));
        JSONObject jSONObject = new JSONObject(string4);
        int n = Integer.MAX_VALUE;
        try {
            if (jSONObject.has("totalpage") && jSONObject.get("totalpage") instanceof Integer) {
                n = jSONObject.getInt("totalpage");
            } else if (jSONObject.has("pagecount") && jSONObject.get("pagecount") instanceof Integer) {
                n = jSONObject.getInt("pagecount");
            } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("total") && jSONObject.getJSONObject("data").get("total") instanceof Integer && jSONObject.getJSONObject("data").has("limit") && jSONObject.getJSONObject("data").get("limit") instanceof Integer) {
                int n2 = jSONObject.getJSONObject("data").getInt("limit");
                int n3 = jSONObject.getJSONObject("data").getInt("total");
                n = n3 % n2 == 0 ? n3 / n2 : n3 / n2 + 1;
            }
        }
        catch (Exception exception) {
            SpiderDebug.log(exception);
        }
        JSONArray jSONArray = null;
        JSONArray jSONArray2 = new JSONArray();
        if (jSONObject.has("list") && jSONObject.get("list") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONArray("list");
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("list") && jSONObject.getJSONObject("data").get("list") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONObject("data").getJSONArray("list");
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONArray("data");
        }
        if (jSONArray != null) {
            for (int i = 0; i < jSONArray.length(); ++i) {
                JSONObject jSONObject2;
                JSONObject jSONObject3 = jSONArray.getJSONObject(i);
                if (jSONObject3.has("vod_id")) {
                    jSONObject2 = new JSONObject();
                    jSONObject2.put("vod_id", (Object)jSONObject3.getString("vod_id"));
                    jSONObject2.put("vod_name", (Object)jSONObject3.getString("vod_name"));
                    jSONObject2.put("vod_pic", (Object)jSONObject3.getString("vod_pic"));
                    jSONObject2.put("vod_remarks", (Object)jSONObject3.getString("vod_remarks"));
                    jSONArray2.put((Object)jSONObject2);
                    continue;
                }
                jSONObject2 = new JSONObject();
                jSONObject2.put("vod_id", (Object)jSONObject3.getString("nextlink"));
                jSONObject2.put("vod_name", (Object)jSONObject3.getString("title"));
                jSONObject2.put("vod_pic", (Object)jSONObject3.getString("pic"));
                jSONObject2.put("vod_remarks", (Object)jSONObject3.getString("state"));
                jSONArray2.put((Object)jSONObject2);
            }
        }
        JSONObject jSONObject4 = new JSONObject();
        jSONObject4.put("page", (Object)string2);
        jSONObject4.put("pagecount", n);
        jSONObject4.put("limit", 90);
        jSONObject4.put("total", Integer.MAX_VALUE);
        jSONObject4.put("list", (Object)jSONArray2);
        return jSONObject4.toString();
    }

    @Override
    public String detailContent(List<String> list) throws Exception {
        String string = this.getApiUrl();
        String string2 = this.getPlayUrlPrefix(string) + list.get(0);
        SpiderDebug.log(string2);
        String string3 = OkHttp.string(string2, this.getHeaders(string2));
        JSONObject jSONObject = new JSONObject(string3);
        JSONObject jSONObject2 = new JSONObject();
        JSONObject jSONObject3 = new JSONObject();
        this.genPlayList(string, jSONObject, string3, jSONObject3, list.get(0));
        JSONArray jSONArray = new JSONArray();
        jSONArray.put((Object)jSONObject3);
        jSONObject2.put("list", (Object)jSONArray);
        return jSONObject2.toString();
    }

    @Override
    public String searchContent(String string, boolean bl) throws Exception {
        String string2 = this.getApiUrl();
        String string3 = this.getSearchUrl(string2, URLEncoder.encode(string));
        String string4 = OkHttp.string(string3, this.getHeaders(string3));
        JSONObject jSONObject = new JSONObject(string4);
        JSONArray jSONArray = null;
        JSONArray jSONArray2 = new JSONArray();
        if (jSONObject.has("list") && jSONObject.get("list") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONArray("list");
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("list") && jSONObject.getJSONObject("data").get("list") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONObject("data").getJSONArray("list");
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONArray) {
            jSONArray = jSONObject.getJSONArray("data");
        }
        if (jSONArray != null) {
            for (int i = 0; i < jSONArray.length(); ++i) {
                JSONObject jSONObject2;
                JSONObject jSONObject3 = jSONArray.getJSONObject(i);
                if (jSONObject3.has("vod_id")) {
                    jSONObject2 = new JSONObject();
                    jSONObject2.put("vod_id", (Object)jSONObject3.getString("vod_id"));
                    jSONObject2.put("vod_name", (Object)jSONObject3.getString("vod_name"));
                    jSONObject2.put("vod_pic", (Object)jSONObject3.getString("vod_pic"));
                    jSONObject2.put("vod_remarks", (Object)jSONObject3.getString("vod_remarks"));
                    jSONArray2.put((Object)jSONObject2);
                    continue;
                }
                jSONObject2 = new JSONObject();
                jSONObject2.put("vod_id", (Object)jSONObject3.getString("nextlink"));
                jSONObject2.put("vod_name", (Object)jSONObject3.getString("title"));
                jSONObject2.put("vod_pic", (Object)jSONObject3.getString("pic"));
                jSONObject2.put("vod_remarks", (Object)jSONObject3.getString("state"));
                jSONArray2.put((Object)jSONObject2);
            }
        }
        JSONObject jSONObject4 = new JSONObject();
        jSONObject4.put("list", (Object)jSONArray2);
        return jSONObject4.toString();
    }

    @Override
    public String playerContent(String string, String string2, List<String> list) throws Exception {
        JSONObject jSONObject;
        if (string.contains("fanqie") && Util.isVideoFormat(string2)) {
            JSONObject jSONObject2 = new JSONObject();
            jSONObject2.put("parse", 0);
            jSONObject2.put("playUrl", (Object)"");
            jSONObject2.put("url", (Object)string2);
            return jSONObject2.toString();
        }
        ArrayList<String> arrayList = this.parseUrlMap.get(string);
        if (arrayList == null) {
            arrayList = new ArrayList();
        }
        if (!arrayList.isEmpty() && (jSONObject = this.getFinalVideo(string, arrayList, string2)) != null) {
            return jSONObject.toString();
        }
        if (Util.isVideoFormat(string2)) {
            jSONObject = new JSONObject();
            jSONObject.put("parse", 0);
            jSONObject.put("playUrl", (Object)"");
            jSONObject.put("url", (Object)string2);
            return jSONObject.toString();
        }
        jSONObject = new JSONObject();
        jSONObject.put("parse", 1);
        jSONObject.put("jx", (Object)"1");
        jSONObject.put("url", (Object)string2);
        return jSONObject.toString();
    }

    private void findJsonArray(JSONObject jSONObject, String string, ArrayList<JSONArray> arrayList) {
        Iterator iterator = jSONObject.keys();
        while (iterator.hasNext()) {
            String string2 = (String)iterator.next();
            try {
                Object object = jSONObject.get(string2);
                if (string2.equals(string) && object instanceof JSONArray) {
                    arrayList.add((JSONArray)object);
                }
                if (object instanceof JSONObject) {
                    this.findJsonArray((JSONObject)object, string, arrayList);
                    continue;
                }
                if (!(object instanceof JSONArray)) continue;
                JSONArray jSONArray = (JSONArray)object;
                for (int i = 0; i < jSONArray.length(); ++i) {
                    this.findJsonArray(jSONArray.getJSONObject(i), string, arrayList);
                }
            }
            catch (JSONException jSONException) {
                SpiderDebug.log(jSONException);
            }
        }
    }

    private String jsonArr2Str(JSONArray jSONArray) {
        try {
            ArrayList<String> arrayList = new ArrayList<String>();
            for (int i = 0; i < jSONArray.length(); ++i) {
                arrayList.add(jSONArray.getString(i));
            }
            return StringUtils.join(arrayList, (String)",");
        }
        catch (JSONException jSONException) {
            return "";
        }
    }

    private HashMap<String, String> getHeaders(String string) {
        HashMap<String, String> hashMap = new HashMap<String, String>();
        hashMap.put("User-Agent", this.UA(string));
        return hashMap;
    }

    private String getSearchUrl(String string, String string2) {
        if (string.contains(".vod")) {
            if (string.contains("iopenyun.com")) {
                return string + "/list?wd=" + string2 + "&page=";
            }
            return string + "?wd=" + string2 + "&page=";
        }
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            return string + "search?text=" + string2 + "&pg=";
        }
        if (urlPattern1.matcher(string).find()) {
            if (string.contains("esellauto") || string.contains("1.14.63.101") || string.contains("zjys") || string.contains("dcd") || string.contains("lxue") || string.contains("weetai.cn") || string.contains("haokanju1") || string.contains("fit:8") || string.contains("zjj.life") || string.contains("love9989") || string.contains("8d8q") || string.contains("lk.pxun") || string.contains("hgyx") || string.contains("521x5") || string.contains("lxyyy") || string.contains("0818tv") || string.contains("diyoui") || string.contains("diliktv") || string.contains("ppzhu") || string.contains("aitesucai") || string.contains("zz.ci") || string.contains("chxjon") || string.contains("watchmi") || string.contains("vipbp") || string.contains("bhtv") || string.contains("xfykl")) {
                return string + "?ac=list&wd=" + string2 + "&page=";
            }
            return string + "?ac=list&zm=" + string2 + "&page=";
        }
        return "";
    }

    private String UA(String string) {
        if (string.contains("vod.9e03.com")) {
            return "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Mobile Safari/537.36";
        }
        if (string.contains("api.php/app") || string.contains("xgapp") || string.contains("freekan")) {
            return "Dart/2.14 (dart:io)";
        }
        if (string.contains("zsb") || string.contains("fkxs") || string.contains("xays") || string.contains("xcys") || string.contains("szys") || string.contains("dxys") || string.contains("ytys") || string.contains("qnys")) {
            return "Dart/2.15 (dart:io)";
        }
        if (string.contains(".vod")) {
            return "okhttp/4.1.0";
        }
        return "Dalvik/2.1.0";
    }

    String getCateUrl(String string) {
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            return string + "nav?token=";
        }
        if (string.contains(".vod")) {
            if (string.contains("iopenyun.com")) {
                return string + "/list?type";
            }
            return string + "/types";
        }
        return "";
    }

    String getCateFilterUrlPrefix(String string) {
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            if (string.contains("dijiaxia")) {
                string = "http://www.dijiaxia.com/api.php/app/";
                return string + "video?tid=";
            }
            return string + "video?tid=";
        }
        if (string.contains(".vod")) {
            if (string.contains("tv.bulei.cc")) {
                return "https://tv.bulei.cc/api2.php/v1.vod?type=";
            }
            if (string.contains("iopenyun")) {
                return string + "/list?type=";
            }
            return string + "?type=";
        }
        return string + "?ac=list&class=";
    }

    String getCateFilterUrlSuffix(String string) {
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            return "&class=\u7b5b\u9009class&area=\u7b5b\u9009area&lang=\u7b5b\u9009lang&year=\u7b5b\u9009year&limit=18&pg=#PN#";
        }
        if (string.contains(".vod")) {
            return "&class=\u7b5b\u9009class&area=\u7b5b\u9009area&lang=\u7b5b\u9009lang&year=\u7b5b\u9009year&by=\u6392\u5e8f&limit=18&page=#PN#";
        }
        return "&page=#PN#&area=\u7b5b\u9009area&type=\u7b5b\u9009class&start=\u7b5b\u9009year";
    }

    String getFilterTypes(String string, JSONObject jSONObject) {
        Object object = "";
        if (jSONObject != null) {
            Iterator iterator = jSONObject.keys();
            while (iterator.hasNext()) {
                String string2 = (String)iterator.next();
                if (!string2.equals("class") && !string2.equals("area") && !string2.equals("lang") && !string2.equals("year")) continue;
                try {
                    object = (String)object + "\u7b5b\u9009" + string2 + "+\u5168\u90e8=+" + jSONObject.getString(string2).replace(",", "+") + "\n";
                }
                catch (JSONException jSONException) {}
            }
        }
        if (string.contains(".vod")) {
            object = (String)object + "\n\u6392\u5e8f+\u5168\u90e8=+\u6700\u65b0=time+\u6700\u70ed=hits+\u8bc4\u5206=score";
        } else if (!string.contains("api.php/app") && !string.contains("xgapp")) {
            object = "\u5206\u7c7b+\u5168\u90e8=+\u7535\u5f71=movie+\u8fde\u7eed\u5267=tvplay+\u7efc\u827a=tvshow+\u52a8\u6f2b=comic+4K=movie_4k+\u4f53\u80b2=tiyu\n\u7b5b\u9009class+\u5168\u90e8=+\u559c\u5267+\u7231\u60c5+\u6050\u6016+\u52a8\u4f5c+\u79d1\u5e7b+\u5267\u60c5+\u6218\u4e89+\u8b66\u532a+\u72af\u7f6a+\u52a8\u753b+\u5947\u5e7b+\u6b66\u4fa0+\u5192\u9669+\u67aa\u6218+\u6050\u6016+\u60ac\u7591+\u60ca\u609a+\u7ecf\u5178+\u9752\u6625+\u6587\u827a+\u5fae\u7535\u5f71+\u53e4\u88c5+\u5386\u53f2+\u8fd0\u52a8+\u519c\u6751+\u60ca\u609a+\u60ca\u609a+\u4f26\u7406+\u60c5\u8272+\u798f\u5229+\u4e09\u7ea7+\u513f\u7ae5+\u7f51\u7edc\u7535\u5f71\n\u7b5b\u9009area+\u5168\u90e8=+\u5927\u9646+\u9999\u6e2f+\u53f0\u6e7e+\u7f8e\u56fd+\u82f1\u56fd+\u6cd5\u56fd+\u65e5\u672c+\u97e9\u56fd+\u5fb7\u56fd+\u6cf0\u56fd+\u5370\u5ea6+\u897f\u73ed\u7259+\u52a0\u62ff\u5927+\u5176\u4ed6\n\u7b5b\u9009year+\u5168\u90e8=+2023+2022+2021+2020+2019+2018+2017+2016+2015+2014+2013+2012+2011+2010+2009+2008+2007+2006+2005+2004+2003+2002+2001+2000";
        }
        return object;
    }

    String getRecommendUrl(String string) {
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            return string + "index_video?token=";
        }
        if (string.contains(".vod")) {
            return string + "/vodPhbAll";
        }
        return "";
    }

    String getPlayUrlPrefix(String string) {
        if (string.contains("api.php/app") || string.contains("xgapp")) {
            if (string.contains("dijiaxia")) {
                string = "https://www.dijiaxia.com/api.php/app/";
                return string + "video_detail?id=";
            }
            if (string.contains("1010dy")) {
                string = "http://www.1010dy.cc/api.php/app/";
                return string + "video_detail?id=";
            }
            return string + "video_detail?id=";
        }
        if (string.contains(".vod")) {
            if (string.contains("iopenyun")) {
                return string + "/detailID?vod_id=";
            }
            return string + "/detail?vod_id=";
        }
        return string + "?ac=detail&id=";
    }

    /*
     * WARNING - void declaration
     */
    private void genPlayList(String string2, JSONObject jSONObject, String string3, JSONObject jSONObject2, String string4) throws JSONException {
        ArrayList<String> arrayList = new ArrayList<String>();
        ArrayList<String> arrayList2 = new ArrayList<String>();
        if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("vod_url_with_player")) {
            JSONObject jSONObject3 = jSONObject.getJSONObject("data");
            jSONObject2.put("vod_id", (Object)jSONObject3.optString("vod_id", string4));
            jSONObject2.put("vod_name", (Object)jSONObject3.getString("vod_name"));
            jSONObject2.put("vod_pic", (Object)jSONObject3.getString("vod_pic"));
            jSONObject2.put("type_name", (Object)jSONObject3.optString("vod_class"));
            jSONObject2.put("vod_year", (Object)jSONObject3.optString("vod_year"));
            jSONObject2.put("vod_area", (Object)jSONObject3.optString("vod_area"));
            jSONObject2.put("vod_remarks", (Object)jSONObject3.optString("vod_remarks"));
            jSONObject2.put("vod_actor", (Object)jSONObject3.optString("vod_actor"));
            jSONObject2.put("vod_director", (Object)jSONObject3.optString("vod_director"));
            jSONObject2.put("vod_content", (Object)jSONObject3.optString("vod_content"));
            JSONArray jSONArray = jSONObject3.getJSONArray("vod_url_with_player");
            for (int i = 0; i < jSONArray.length(); ++i) {
                JSONObject jSONObject4 = jSONArray.getJSONObject(i);
                String string5 = jSONObject4.optString("code").trim();
                if (string5.isEmpty()) {
                    string5 = jSONObject4.getString("name").trim();
                }
                arrayList2.add(string5);
                arrayList.add(jSONObject4.getString("url"));
                String string6 = jSONObject4.optString("parse_api").trim();
                ArrayList arrayList3 = this.parseUrlMap.computeIfAbsent(string5, string -> new ArrayList());
                if (string6.isEmpty() || arrayList3.contains(string6)) continue;
                arrayList3.add(string6);
            }
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("vod_info") && jSONObject.getJSONObject("data").getJSONObject("vod_info").has("vod_url_with_player")) {
            JSONObject jSONObject5 = jSONObject.getJSONObject("data").getJSONObject("vod_info");
            jSONObject2.put("vod_id", (Object)jSONObject5.optString("vod_id", string4));
            jSONObject2.put("vod_name", (Object)jSONObject5.getString("vod_name"));
            jSONObject2.put("vod_pic", (Object)jSONObject5.getString("vod_pic"));
            jSONObject2.put("type_name", (Object)jSONObject5.optString("vod_class"));
            jSONObject2.put("vod_year", (Object)jSONObject5.optString("vod_year"));
            jSONObject2.put("vod_area", (Object)jSONObject5.optString("vod_area"));
            jSONObject2.put("vod_remarks", (Object)jSONObject5.optString("vod_remarks"));
            jSONObject2.put("vod_actor", (Object)jSONObject5.optString("vod_actor"));
            jSONObject2.put("vod_director", (Object)jSONObject5.optString("vod_director"));
            jSONObject2.put("vod_content", (Object)jSONObject5.optString("vod_content"));
            JSONArray jSONArray = jSONObject5.getJSONArray("vod_url_with_player");
            for (int i = 0; i < jSONArray.length(); ++i) {
                JSONObject jSONObject6 = jSONArray.getJSONObject(i);
                String string7 = jSONObject6.optString("code").trim();
                if (string7.isEmpty()) {
                    string7 = jSONObject6.getString("name").trim();
                }
                arrayList2.add(string7);
                arrayList.add(jSONObject6.getString("url"));
                String string8 = jSONObject6.optString("parse_api").trim();
                ArrayList arrayList4 = this.parseUrlMap.computeIfAbsent(string7, string -> new ArrayList());
                if (string8.isEmpty() || arrayList4.contains(string8)) continue;
                arrayList4.add(string8);
            }
        } else if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && jSONObject.getJSONObject("data").has("vod_play_list")) {
            JSONObject jSONObject7 = jSONObject.getJSONObject("data");
            jSONObject2.put("vod_id", (Object)jSONObject7.optString("vod_id", string4));
            jSONObject2.put("vod_name", (Object)jSONObject7.getString("vod_name"));
            jSONObject2.put("vod_pic", (Object)jSONObject7.getString("vod_pic"));
            jSONObject2.put("type_name", (Object)jSONObject7.optString("vod_class"));
            jSONObject2.put("vod_year", (Object)jSONObject7.optString("vod_year"));
            jSONObject2.put("vod_area", (Object)jSONObject7.optString("vod_area"));
            jSONObject2.put("vod_remarks", (Object)jSONObject7.optString("vod_remarks"));
            jSONObject2.put("vod_actor", (Object)jSONObject7.optString("vod_actor"));
            jSONObject2.put("vod_director", (Object)jSONObject7.optString("vod_director"));
            jSONObject2.put("vod_content", (Object)jSONObject7.optString("vod_content"));
            JSONArray jSONArray = jSONObject7.getJSONArray("vod_play_list");
            for (int i = 0; i < jSONArray.length(); ++i) {
                JSONObject jSONObject8 = jSONArray.getJSONObject(i);
                String string9 = jSONObject8.getJSONObject("player_info").optString("from").trim();
                if (string9.isEmpty()) {
                    string9 = jSONObject8.getJSONObject("player_info").optString("show").trim();
                }
                arrayList2.add(string9);
                arrayList.add(jSONObject8.getString("url"));
                try {
                    ArrayList<String> arrayList5 = new ArrayList<String>();
                    String[] stringArray = jSONObject8.getJSONObject("player_info").optString("parse").split(",");
                    String[] stringArray2 = jSONObject8.getJSONObject("player_info").optString("parse2").split(",");
                    arrayList5.addAll(Arrays.asList(stringArray));
                    arrayList5.addAll(Arrays.asList(stringArray2));
                    ArrayList arrayList6 = this.parseUrlMap.computeIfAbsent(string9, string -> new ArrayList());
                    for (String n : arrayList5) {
                        void var18_50;
                        String object;
                        if (n.contains("http")) {
                            var19_52 = parsePattern1.matcher(n);
                            if (var19_52.find()) {
                                String string5 = var19_52.group(0);
                            }
                        } else if (n.contains("//")) {
                            var19_52 = parsePattern1.matcher(n);
                            if (var19_52.find()) {
                                String string6 = "http:" + var19_52.group(0);
                            }
                        } else {
                            Matcher matcher;
                            var19_52 = parsePattern2.matcher(string2);
                            if (var19_52.find() && (matcher = parsePattern1.matcher(string2)).find()) {
                                String string7 = var19_52.group(0) + matcher.group(0);
                            }
                        }
                        if ((object = var18_50.replace("..", ".").trim()).isEmpty() || arrayList6.contains(object)) continue;
                        arrayList6.add(object);
                    }
                    continue;
                }
                catch (Exception exception) {
                    SpiderDebug.log(exception);
                }
            }
        } else if (jSONObject.has("videolist")) {
            JSONObject jSONObject9 = jSONObject;
            jSONObject2.put("vod_id", (Object)jSONObject9.optString("vod_id", string4));
            jSONObject2.put("vod_name", (Object)jSONObject9.getString("title"));
            jSONObject2.put("vod_pic", (Object)jSONObject9.getString("img_url"));
            jSONObject2.put("type_name", (Object)this.jsonArr2Str(jSONObject9.optJSONArray("type")));
            jSONObject2.put("vod_year", (Object)jSONObject9.optString("pubtime"));
            jSONObject2.put("vod_area", (Object)this.jsonArr2Str(jSONObject9.optJSONArray("area")));
            jSONObject2.put("vod_remarks", (Object)jSONObject9.optString("trunk"));
            jSONObject2.put("vod_actor", (Object)this.jsonArr2Str(jSONObject9.optJSONArray("actor")));
            jSONObject2.put("vod_director", (Object)this.jsonArr2Str(jSONObject9.optJSONArray("director")));
            jSONObject2.put("vod_content", (Object)jSONObject9.optString("intro"));
            JSONObject jSONObject10 = jSONObject9.getJSONObject("videolist");
            Iterator iterator = jSONObject10.keys();
            while (iterator.hasNext()) {
                String string10 = (String)iterator.next();
                ArrayList<String> arrayList7 = this.parseUrlMap.get(string10);
                if (arrayList7 == null) {
                    arrayList7 = new ArrayList();
                    this.parseUrlMap.put(string10, arrayList7);
                }
                JSONArray jSONArray = jSONObject10.getJSONArray(string10);
                ArrayList<CallSite> arrayList8 = new ArrayList<CallSite>();
                for (int i = 0; i < jSONArray.length(); ++i) {
                    JSONObject jSONObject11 = jSONArray.getJSONObject(i);
                    String string11 = jSONObject11.getString("url");
                    if (string11.contains("url=")) {
                        int n = string11.indexOf("url=") + 4;
                        String string8 = string11.substring(0, n).trim();
                        if (!string8.isEmpty() && !arrayList7.contains(string8)) {
                            arrayList7.add(string8);
                        }
                        arrayList8.add((CallSite)((Object)(jSONObject11.getString("title") + "$" + string11.substring(n).trim())));
                        continue;
                    }
                    arrayList8.add((CallSite)((Object)(jSONObject11.getString("title") + "$" + string11)));
                }
                arrayList2.add(string10);
                arrayList.add(StringUtils.join(arrayList8, (String)"#"));
            }
        }
        jSONObject2.put("vod_play_from", (Object)StringUtils.join(arrayList2, (String)"$$$"));
        jSONObject2.put("vod_play_url", (Object)StringUtils.join(arrayList, (String)"$$$"));
    }

    protected JSONObject getFinalVideo(String string, ArrayList<String> arrayList, String string2) throws JSONException {
        String string3 = "";
        for (String string4 : arrayList) {
            if (string4.isEmpty() || string4.equals("null")) continue;
            String string5 = string4 + string2;
            String string6 = OkHttp.string(string5);
            JSONObject jSONObject = null;
            try {
                jSONObject = AppYsV2.jsonParse(string2, string6);
            }
            catch (Throwable throwable) {
                // empty catch block
            }
            if (jSONObject != null && jSONObject.has("url") && jSONObject.has("header")) {
                jSONObject.put("header", (Object)jSONObject.getJSONObject("header").toString());
                return jSONObject;
            }
            if (!string6.contains("<html")) continue;
            boolean bl = false;
            for (Pattern pattern : htmlVideoKeyMatch) {
                if (!pattern.matcher(string6).find()) continue;
                bl = true;
                break;
            }
            if (!bl) continue;
            string3 = string4;
        }
        if (!string3.isEmpty()) {
            JSONObject jSONObject = new JSONObject();
            jSONObject.put("parse", 1);
            jSONObject.put("playUrl", (Object)string3);
            jSONObject.put("url", (Object)string2);
            return jSONObject;
        }
        return null;
    }

    @Override
    public boolean manualVideoCheck() {
        return true;
    }

    @Override
    public boolean isVideoFormat(String string) {
        return Util.isVideoFormat(string);
    }

    private String getApiUrl() {
        if (this.extInfos == null || this.extInfos.length < 1) {
            return "";
        }
        return this.extInfos[0].trim();
    }

    public static JSONObject jsonParse(String string, String string2) throws JSONException {
        Object object;
        JSONObject jSONObject = new JSONObject(string2);
        if (jSONObject.has("data") && jSONObject.get("data") instanceof JSONObject && !jSONObject.has("url")) {
            jSONObject = jSONObject.getJSONObject("data");
        }
        if (((String)(object = jSONObject.getString("url"))).startsWith("//")) {
            object = "https:" + (String)object;
        }
        if (!((String)object).trim().startsWith("http")) {
            return null;
        }
        if (((String)object).equals(string) && (Util.isVip((String)object) || !Util.isVideoFormat((String)object))) {
            return null;
        }
        if (Util.isBlackVodUrl((String)object)) {
            return null;
        }
        JSONObject jSONObject2 = new JSONObject();
        if (jSONObject.has("header")) {
            jSONObject2 = jSONObject.optJSONObject("header");
        } else if (jSONObject.has("Header")) {
            jSONObject2 = jSONObject.optJSONObject("Header");
        } else if (jSONObject.has("headers")) {
            jSONObject2 = jSONObject.optJSONObject("headers");
        } else if (jSONObject.has("Headers")) {
            jSONObject2 = jSONObject.optJSONObject("Headers");
        }
        String string3 = "";
        if (jSONObject.has("user-agent")) {
            string3 = jSONObject.optString("user-agent", "");
        } else if (jSONObject.has("User-Agent")) {
            string3 = jSONObject.optString("User-Agent", "");
        }
        if (!string3.trim().isEmpty()) {
            jSONObject2.put("User-Agent", (Object)(" " + string3));
        }
        String string4 = "";
        if (jSONObject.has("referer")) {
            string4 = jSONObject.optString("referer", "");
        } else if (jSONObject.has("Referer")) {
            string4 = jSONObject.optString("Referer", "");
        }
        if (!string4.trim().isEmpty()) {
            jSONObject2.put("Referer", (Object)(" " + string4));
        }
        jSONObject2 = AppYsV2.fixJsonVodHeader(jSONObject2, string, (String)object);
        JSONObject jSONObject3 = new JSONObject();
        jSONObject3.put("header", (Object)jSONObject2);
        jSONObject3.put("url", object);
        jSONObject3.put("parse", (Object)"0");
        return jSONObject3;
    }

    public static JSONObject fixJsonVodHeader(JSONObject jSONObject, String string, String string2) throws JSONException {
        if (jSONObject == null) {
            jSONObject = new JSONObject();
        }
        if (string.contains("www.mgtv.com")) {
            jSONObject.put("Referer", (Object)" ");
            jSONObject.put("User-Agent", (Object)" Mozilla/5.0");
        } else if (string2.contains("titan.mgtv")) {
            jSONObject.put("Referer", (Object)" ");
            jSONObject.put("User-Agent", (Object)" Mozilla/5.0");
        } else if (string.contains("bilibili")) {
            jSONObject.put("Referer", (Object)" https://www.bilibili.com/");
            jSONObject.put("User-Agent", (Object)" Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36");
        }
        return jSONObject;
    }
}

