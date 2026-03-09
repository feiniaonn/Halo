package android.app;

import android.content.Context;
import android.view.View;

/**
 * Minimal Dialog stub for desktop compatibility.
 */
public class Dialog {
    private final Context context;

    public Dialog() {
        this(new Application());
    }

    public Dialog(Context context) {
        this.context = context;
    }

    public Context getContext() {
        return context;
    }

    public void setContentView(int layoutId) {
    }

    public void setContentView(View view) {
    }

    public void show() {
    }

    public void dismiss() {
    }

    @SuppressWarnings("unchecked")
    public <T extends View> T findViewById(int id) {
        return null;
    }
}
