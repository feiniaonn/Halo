package com.github.catvod.spider.merge.J;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Desktop-safe replacement for legacy merge.J playlist entries.
 */
public final class b {
    public final String type_id;
    public final String type_name;
    public final String type_flag;

    public b(String first, String second) {
        this(first, second, "");
    }

    public b(String first, String second, String third) {
        this.type_id = first == null ? "" : first;
        this.type_name = second == null ? "" : second;
        this.type_flag = third == null ? "" : third;
    }

    public static List<b> a(String raw) {
        List<b> items = new ArrayList<>();
        if (raw == null || raw.trim().isEmpty()) {
            return items;
        }

        String[] lines = raw.split("[#\\n]");
        for (String line : lines) {
            String trimmed = line == null ? "" : line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }

            String[] segments = trimmed.split("\\$", 3);
            if (segments.length >= 2) {
                String third = segments.length >= 3 ? segments[2] : "";
                items.add(new b(segments[0], segments[1], third));
            } else {
                items.add(new b(trimmed, trimmed, ""));
            }
        }

        return items;
    }

    public String b() {
        if (type_flag.isEmpty()) {
            return type_name + "$" + type_id;
        }
        return type_name + "$" + type_id + "$" + type_flag;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof b)) {
            return false;
        }
        b that = (b) other;
        return Objects.equals(type_id, that.type_id)
                && Objects.equals(type_name, that.type_name)
                && Objects.equals(type_flag, that.type_flag);
    }

    @Override
    public int hashCode() {
        return Objects.hash(type_id, type_name, type_flag);
    }

    @Override
    public String toString() {
        return b();
    }
}
