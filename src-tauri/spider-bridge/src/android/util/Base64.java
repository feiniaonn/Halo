package android.util;

/**
 * Base64 stub for desktop compatibility.
 */
public class Base64 {
    public static final int DEFAULT = 0;
    public static final int NO_PADDING = 1;
    public static final int NO_WRAP = 2;
    public static final int CRLF = 4;
    public static final int URL_SAFE = 8;
    
    public static String encodeToString(byte[] input, int flags) {
        return java.util.Base64.getEncoder().encodeToString(input);
    }
    
    public static byte[] decode(String str, int flags) {
        try {
            return java.util.Base64.getDecoder().decode(str);
        } catch (Exception e) {
            return new byte[0];
        }
    }
}
