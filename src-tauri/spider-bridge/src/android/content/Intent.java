package android.content;

import java.util.HashMap;
import java.util.Map;

/**
 * Minimal Intent stub for desktop.
 */
public class Intent {
    private String action;
    private final Map<String, Object> extras = new HashMap<>();

    public Intent() {}
    public Intent(String action) { this.action = action; }
    public Intent(Context packageContext, Class<?> cls) {}

    public Intent setAction(String action) { this.action = action; return this; }
    public String getAction() { return action; }

    public Intent putExtra(String name, String value) { extras.put(name, value); return this; }
    public String getStringExtra(String name) { return (String) extras.get(name); }
    
    public Intent setFlags(int flags) { return this; }
}
