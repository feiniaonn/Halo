package android.widget;

import android.content.Context;
import android.view.View;

/**
 * Minimal TextView stub for desktop spider runtimes.
 */
public class TextView extends View {
    private CharSequence text = "";
    private CharSequence hint = "";

    public TextView() {
        super();
    }

    public TextView(Context context) {
        super(context);
    }

    public void setText(CharSequence value) {
        text = value == null ? "" : value;
    }

    public CharSequence getText() {
        return text;
    }

    public void setHint(CharSequence value) {
        hint = value == null ? "" : value;
    }

    public CharSequence getHint() {
        return hint;
    }
}
