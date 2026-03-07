package android.util;

public final class Log {
    private Log() {}

    public static int d(String tag, String msg) {
        System.out.println(tag + ": " + msg);
        return 0;
    }

    public static int i(String tag, String msg) {
        System.out.println(tag + ": " + msg);
        return 0;
    }

    public static int w(String tag, String msg) {
        System.err.println(tag + ": " + msg);
        return 0;
    }

    public static int v(String tag, String msg) {
        System.out.println(tag + ": " + msg);
        return 0;
    }

    public static int w(String tag, String msg, Throwable tr) {
        System.err.println(tag + ": " + msg);
        if (tr != null) tr.printStackTrace(System.err);
        return 0;
    }

    public static int e(String tag, String msg) {
        System.err.println(tag + ": " + msg);
        return 0;
    }

    public static int e(String tag, String msg, Throwable tr) {
        System.err.println(tag + ": " + msg);
        if (tr != null) tr.printStackTrace(System.err);
        return 0;
    }
}
