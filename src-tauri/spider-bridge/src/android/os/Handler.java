package android.os;

/**
 * Handler stub for desktop.
 */
public class Handler {
    public Handler() {}
    public Handler(Looper looper) {}
    
    public final boolean post(Runnable r) {
        if (r != null) r.run();
        return true;
    }
    
    public final boolean postDelayed(Runnable r, long delayMillis) {
        if (r != null) r.run();
        return true;
    }
}
