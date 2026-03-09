package android.widget;

import android.view.ViewGroup;

/**
 * Minimal FrameLayout stub for desktop compatibility.
 */
public class FrameLayout extends ViewGroup {
    public static class LayoutParams extends ViewGroup.LayoutParams {
        public LayoutParams() {
            super(0, 0);
        }

        public LayoutParams(int width, int height) {
            super(width, height);
        }
    }
}
