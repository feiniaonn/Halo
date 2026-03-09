package android.app;

import android.content.Context;
import android.content.DialogInterface;
import android.view.View;

/**
 * Minimal AlertDialog stub for desktop compatibility.
 */
public class AlertDialog extends Dialog implements DialogInterface {
    public AlertDialog() {
        super();
    }

    public AlertDialog(Context context) {
        super(context);
    }

    public void setTitle(CharSequence title) {
    }

    public void setMessage(CharSequence message) {
    }

    public void setView(View view) {
    }

    public void setButton(int whichButton, CharSequence text, DialogInterface.OnClickListener listener) {
    }

    @Override
    public void cancel() {
        dismiss();
    }

    public static class Builder {
        private final Context context;

        public Builder(Context context) {
            this.context = context;
        }

        public Builder setTitle(CharSequence title) {
            return this;
        }

        public Builder setMessage(CharSequence message) {
            return this;
        }

        public Builder setView(View view) {
            return this;
        }

        public Builder setCancelable(boolean cancelable) {
            return this;
        }

        public Builder setPositiveButton(CharSequence text, DialogInterface.OnClickListener listener) {
            return this;
        }

        public Builder setNegativeButton(CharSequence text, DialogInterface.OnClickListener listener) {
            return this;
        }

        public Builder setNeutralButton(CharSequence text, DialogInterface.OnClickListener listener) {
            return this;
        }

        public AlertDialog create() {
            return new AlertDialog(context);
        }

        public AlertDialog show() {
            AlertDialog dialog = create();
            dialog.show();
            return dialog;
        }
    }
}
