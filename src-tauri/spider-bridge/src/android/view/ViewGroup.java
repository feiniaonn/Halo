package android.view;

import android.content.Context;

/**
 * Minimal ViewGroup stub for desktop compatibility.
 */
public class ViewGroup extends View {
    public static class LayoutParams {
        public int width;
        public int height;

        public LayoutParams() {
            this(0, 0);
        }

        public LayoutParams(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    public ViewGroup() {
        super();
    }

    public ViewGroup(Context context) {
        super(context);
    }
}
