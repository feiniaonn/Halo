package com.github.catvod.spider.merge.c;

import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.List;

public final class a {
    @SerializedName("type_id")
    private String a;

    @SerializedName("type_name")
    private String b;

    @SerializedName("type_flag")
    private String c;

    public a(String typeId, String typeName) {
        this(typeId, typeName, "1");
    }

    public a(String typeId, String typeName, String typeFlag) {
        this.a = typeId;
        this.b = typeName;
        this.c = typeFlag;
    }

    public static List<a> a(String raw) {
        Type type = new TypeToken<List<a>>() {}.getType();
        return new Gson().fromJson(raw, type);
    }

    @Override
    public final boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof a)) {
            return false;
        }
        a current = (a) other;
        if (a == null) {
            return current.a == null;
        }
        return a.equals(current.a);
    }
}
