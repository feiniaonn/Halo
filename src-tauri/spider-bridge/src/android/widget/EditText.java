package android.widget;

import android.content.Context;

/**
 * Minimal EditText stub for desktop spider runtimes.
 * Android keeps EditText under the TextView hierarchy; some spiders rely on that assignability.
 */
public class EditText extends TextView {
    public EditText() {
        super();
    }

    public EditText(Context context) {
        super(context);
    }
}
