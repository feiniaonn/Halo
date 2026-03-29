package android.widget;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;

/**
 * Minimal LinearLayout stub for desktop compatibility.
 */
public class LinearLayout extends ViewGroup {
    public static final int HORIZONTAL = 0;
    public static final int VERTICAL = 1;

    private int orientation = VERTICAL;

    public static class LayoutParams extends ViewGroup.LayoutParams {
        public float weight;

        public LayoutParams() {
            super(0, 0);
        }

        public LayoutParams(int width, int height) {
            super(width, height);
        }

        public LayoutParams(int width, int height, float weight) {
            super(width, height);
            this.weight = weight;
        }
    }

    public LinearLayout() {
        super();
    }

    public LinearLayout(Context context) {
        super(context);
    }

    public void setOrientation(int orientation) {
        this.orientation = orientation;
    }

    public int getOrientation() {
        return this.orientation;
    }

    public void addView(View child) {
    }

    public void addView(View child, LayoutParams params) {
    }
}
