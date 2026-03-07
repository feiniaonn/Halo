/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.google.gson.Gson
 *  com.google.gson.annotations.SerializedName
 *  com.google.gson.reflect.TypeToken
 */
package com.github.catvod.bean;

import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;
import java.lang.invoke.CallSite;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

public class Class {
    @SerializedName(value="type_id")
    private String typeId;
    @SerializedName(value="type_name")
    private String typeName;
    @SerializedName(value="type_flag")
    private String typeFlag;

    public static List<Class> arrayFrom(String string) {
        Type type = new TypeToken<List<Class>>(){}.getType();
        return (List)new Gson().fromJson(string, type);
    }

    public Class(String string) {
        this(string, string);
    }

    public Class(String string, String string2) {
        this(string, string2, null);
    }

    public Class(String string, String string2, String string3) {
        this.typeId = string;
        this.typeName = string2;
        this.typeFlag = string3;
    }

    public String getTypeId() {
        return this.typeId;
    }

    public boolean equals(Object object) {
        if (this == object) {
            return true;
        }
        if (!(object instanceof Class)) {
            return false;
        }
        Class clazz = (Class)object;
        return this.getTypeId().equals(clazz.getTypeId());
    }

    public static List<Class> parseFromFormatStr(String string) {
        String[] stringArray;
        ArrayList<Class> arrayList = new ArrayList<Class>();
        for (String string2 : stringArray = string.split("&")) {
            String[] stringArray2 = string2.split("=");
            if (stringArray2.length != 2) continue;
            arrayList.add(new Class(stringArray2[1], stringArray2[0]));
        }
        return arrayList;
    }

    public static String listToFormatStr(List<Class> list) {
        ArrayList<CallSite> arrayList = new ArrayList<CallSite>();
        for (Class clazz : list) {
            arrayList.add((CallSite)((Object)(clazz.typeName + "=" + clazz.typeId)));
        }
        return String.join((CharSequence)"&", arrayList);
    }
}

