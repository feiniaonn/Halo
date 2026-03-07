package android.content;

/**
 * Minimal ComponentName stub for desktop.
 */
public class ComponentName {
    private final String mPackage;
    private final String mClass;

    public ComponentName(String pkg, String cls) {
        mPackage = pkg;
        mClass = cls;
    }

    public String getPackageName() { return mPackage; }
    public String getClassName() { return mClass; }
}
