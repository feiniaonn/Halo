/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  org.apache.commons.lang3.StringUtils
 */
package com.github.catvod.utils;

import com.github.catvod.utils.Path;
import java.io.File;
import java.net.URLConnection;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import org.apache.commons.lang3.StringUtils;

public class FileUtil {
    public static void unzip(File file, File file2) {
        try (ZipFile zipFile = new ZipFile(file.getAbsolutePath());){
            Enumeration<? extends ZipEntry> enumeration = zipFile.entries();
            while (enumeration.hasMoreElements()) {
                ZipEntry zipEntry = enumeration.nextElement();
                File file3 = new File(file2, zipEntry.getName());
                if (zipEntry.isDirectory()) {
                    file3.mkdirs();
                    continue;
                }
                Path.copy(zipFile.getInputStream(zipEntry), file3);
            }
        }
        catch (Exception exception) {
            exception.printStackTrace();
        }
    }

    private static String getMimeType(String string) {
        String string2 = URLConnection.guessContentTypeFromName(string);
        return StringUtils.isEmpty((CharSequence)string2) ? "*/*" : string2;
    }
}

