package com.github.catvod.bean;

import com.google.gson.annotations.SerializedName;

public class Class {
    @SerializedName("type_id")
    private String typeId;
    @SerializedName("type_name")
    private String typeName;
    @SerializedName("type_flag")
    private String typeFlag;

    public Class(String typeId, String typeName, String typeFlag) {
        this.typeId = typeId;
        this.typeName = typeName;
        this.typeFlag = typeFlag;
    }

    public Class(String typeId, String typeName) {
        this(typeId, typeName, "1");
    }

    public String getTypeId() {
        return typeId;
    }

    public String getTypeName() {
        return typeName;
    }
    
    public String getTypeFlag() {
        return typeFlag;
    }
}