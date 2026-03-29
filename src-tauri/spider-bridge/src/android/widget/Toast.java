package android.widget;

import android.content.Context;

/**
 * Minimal Toast stub for desktop spider runtimes.
 */
public class Toast {
    public static final int LENGTH_SHORT = 0;
    public static final int LENGTH_LONG = 1;

    private final CharSequence text;

    private Toast(CharSequence text) {
        this.text = text == null ? "" : text;
    }

    public static Toast makeText(Context context, CharSequence text, int duration) {
        return new Toast(text);
    }

    public void show() {
    }

    @Override
    public String toString() {
        return text.toString();
    }
}
