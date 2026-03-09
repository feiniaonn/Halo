package dalvik.system;

/**
 * Minimal DexClassLoader stub for desktop compatibility.
 */
public class DexClassLoader extends ClassLoader {
    public DexClassLoader(String dexPath, String optimizedDirectory, String librarySearchPath, ClassLoader parent) {
        super(parent);
    }
}
