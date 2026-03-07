package com.github.catvod.bean;

import com.google.gson.Gson;
import com.google.gson.annotations.SerializedName;
import java.util.List;
import java.util.Map;

public class Result {
    @SerializedName("class")
    private List<Class> classes;
    @SerializedName("filters")
    private Map<String, List<Filter>> filters;
    @SerializedName("list")
    private List<Vod> list;
    
    @SerializedName("page")
    private Integer page;
    @SerializedName("pagecount")
    private Integer pagecount;
    @SerializedName("limit")
    private Integer limit;
    @SerializedName("total")
    private Integer total;

    public void setClasses(List<Class> classes) { this.classes = classes; }
    public void setFilters(Map<String, List<Filter>> filters) { this.filters = filters; }
    public void setList(List<Vod> list) { this.list = list; }
    public void setPage(Integer page) { this.page = page; }
    public void setPagecount(Integer pagecount) { this.pagecount = pagecount; }
    public void setLimit(Integer limit) { this.limit = limit; }
    public void setTotal(Integer total) { this.total = total; }

    public static Result get() {
        return new Result();
    }

    public static Result error(String text) {
        return new Result();
    }

    public String string() {
        return new Gson().toJson(this);
    }
}