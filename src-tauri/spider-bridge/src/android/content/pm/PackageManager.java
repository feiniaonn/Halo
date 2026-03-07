package android.content.pm;

import java.util.ArrayList;
import java.util.List;

public class PackageManager {
    public static final int GET_SIGNATURES = 64;

    public PackageInfo getPackageInfo(String packageName, int flags) throws Exception {
        PackageInfo info = new PackageInfo();
        info.packageName = packageName;
        info.versionName = "1.0.0";
        info.versionCode = 1;
        info.signatures = new Signature[] { new Signature("7fb5...dummy") };
        return info;
    }
}
