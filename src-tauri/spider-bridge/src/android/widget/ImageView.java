package android.widget;

import android.content.Context;
import android.view.View;

/**
 * Minimal ImageView stub for desktop compatibility.
 */
public class ImageView extends View {
    public enum ScaleType {
        CENTER_CROP,
        FIT_CENTER,
        FIT_XY
    }

    public ImageView() {
        super();
    }

    public ImageView(Context context) {
        super(context);
    }

    public void setImageBitmap(Object bitmap) {
    }

    public void setImageDrawable(Object drawable) {
    }

    public void setImageURI(Object uri) {
    }

    public void setScaleType(ScaleType scaleType) {
    }
}
