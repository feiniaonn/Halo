package com.halo.spider.mock;

import android.content.SharedPreferences;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * JSON-backed SharedPreferences implementation for desktop.
 */
public class MockSharedPreferences implements SharedPreferences {
    private final File file;
    private Map<String, Object> data = new HashMap<>();
    private final Gson gson = new Gson();

    public MockSharedPreferences(File file) {
        this.file = file;
        load();
    }

    private synchronized void load() {
        if (!file.exists()) return;
        try (FileReader reader = new FileReader(file)) {
            data = gson.fromJson(reader, new TypeToken<Map<String, Object>>() {}.getType());
            if (data == null) data = new HashMap<>();
        } catch (Exception ignored) {}
    }

    private synchronized void save() {
        try (FileWriter writer = new FileWriter(file)) {
            gson.toJson(data, writer);
        } catch (Exception ignored) {}
    }

    @Override public Map<String, ?> getAll() { return new HashMap<>(data); }

    @Override
    public String getString(String key, String defValue) {
        Object val = data.get(key);
        return val instanceof String ? (String) val : defValue;
    }

    @Override
    public Set<String> getStringSet(String key, Set<String> defValues) {
        return defValues; // Simple stub
    }

    @Override
    public int getInt(String key, int defValue) {
        Object val = data.get(key);
        return val instanceof Number ? ((Number) val).intValue() : defValue;
    }

    @Override
    public long getLong(String key, long defValue) {
        Object val = data.get(key);
        return val instanceof Number ? ((Number) val).longValue() : defValue;
    }

    @Override
    public float getFloat(String key, float defValue) {
        Object val = data.get(key);
        return val instanceof Number ? ((Number) val).floatValue() : defValue;
    }

    @Override
    public boolean getBoolean(String key, boolean defValue) {
        Object val = data.get(key);
        return val instanceof Boolean ? (Boolean) val : defValue;
    }

    @Override public boolean contains(String key) { return data.containsKey(key); }

    @Override
    public Editor edit() {
        return new EditorImpl();
    }

    private class EditorImpl implements Editor {
        private final Map<String, Object> temp = new HashMap<>(data);

        @Override public Editor putString(String key, String value) { temp.put(key, value); return this; }
        @Override public Editor putStringSet(String key, Set<String> values) { return this; }
        @Override public Editor putInt(String key, int value) { temp.put(key, value); return this; }
        @Override public Editor putLong(String key, long value) { temp.put(key, value); return this; }
        @Override public Editor putFloat(String key, float value) { temp.put(key, value); return this; }
        @Override public Editor putBoolean(String key, boolean value) { temp.put(key, value); return this; }
        @Override public Editor remove(String key) { temp.remove(key); return this; }
        @Override public Editor clear() { temp.clear(); return this; }

        @Override
        public boolean commit() {
            synchronized (MockSharedPreferences.this) {
                data = new HashMap<>(temp);
                save();
            }
            return true;
        }

        @Override
        public void apply() {
            commit();
        }
    }
}
