package android.net;

import java.net.URL;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.Map;

/**
 * Minimal android.net.Uri stub for desktop.
 */
public class Uri {
    private String uriString;

    private Uri(String uriString) {
        this.uriString = uriString;
    }

    public static Uri parse(String uriString) {
        return new Uri(uriString);
    }

    public String getQueryParameter(String key) {
        try {
            URL url = new URL(uriString.replace(" ", "%20"));
            String query = url.getQuery();
            if (query == null) return null;
            String[] pairs = query.split("&");
            for (String pair : pairs) {
                int idx = pair.indexOf("=");
                String k = idx > 0 ? URLDecoder.decode(pair.substring(0, idx), "UTF-8") : pair;
                if (k.equals(key)) {
                    return idx > 0 && pair.length() > idx + 1 
                        ? URLDecoder.decode(pair.substring(idx + 1), "UTF-8") : "";
                }
            }
        } catch (Exception e) {}
        return null;
    }

    public String getHost() {
        try {
            return new URL(uriString).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    public String getPath() {
        try {
            return new URL(uriString).getPath();
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public String toString() {
        return uriString;
    }
}
