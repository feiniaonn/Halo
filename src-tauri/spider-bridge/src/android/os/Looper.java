package android.os;

/**
 * Looper stub for desktop.
 */
public class Looper {
    private static final Looper mainLooper = new Looper();
    
    public static Looper getMainLooper() {
        return mainLooper;
    }
    
    public static Looper myLooper() {
        return mainLooper;
    }
}
