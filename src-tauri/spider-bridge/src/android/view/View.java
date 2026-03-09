package android.view;

import android.content.Context;

/**
 * Minimal View stub for desktop spider runtimes.
 */
public class View {
    public interface OnClickListener {
        void onClick(View v);
    }

    private final Context context;

    public View() {
        this(null);
    }

    public View(Context context) {
        this.context = context;
    }

    public Context getContext() {
        return context;
    }

    public void setOnClickListener(OnClickListener listener) {
    }

    public void setVisibility(int visibility) {
    }

    @SuppressWarnings("unchecked")
    public <T extends View> T findViewById(int id) {
        return null;
    }
}
