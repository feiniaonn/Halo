package com.github.catvod.utils;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * File utility helpers for CatVod spiders.
 */
public class FileUtil {

    public static String read(String path) {
        try {
            return read(new File(path));
        } catch (Exception e) {
            return "";
        }
    }

    public static String read(File file) {
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            fis.read(data);
            return new String(data, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    public static void write(File file, String content) {
        try {
            if (!file.getParentFile().exists()) {
                file.getParentFile().mkdirs();
            }
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(content.getBytes("UTF-8"));
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public static void write(String path, String content) {
        write(new File(path), content);
    }

    public static byte[] readBytes(InputStream is) throws IOException {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        int n;
        byte[] data = new byte[4096];
        while ((n = is.read(data, 0, data.length)) != -1) {
            buffer.write(data, 0, n);
        }
        return buffer.toByteArray();
    }
}