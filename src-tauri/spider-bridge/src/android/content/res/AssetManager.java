package android.content.res;

import java.io.InputStream;
import java.io.IOException;
import java.io.ByteArrayInputStream;

public class AssetManager {
    public InputStream open(String fileName) throws IOException {
        return new ByteArrayInputStream(new byte[0]);
    }

    public String[] list(String path) throws IOException {
        return new String[0];
    }
}
