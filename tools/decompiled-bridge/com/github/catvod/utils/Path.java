/*
 * Decompiled with CFR 0.152.
 */
package com.github.catvod.utils;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

public class Path {
    private static final String TAG = Path.class.getSimpleName();
    private static final String RUNDIR = System.getProperty("user.dir");

    private static File check(File file) {
        if (!file.exists()) {
            file.mkdirs();
        }
        return file;
    }

    public static File root() {
        return new File(RUNDIR);
    }

    public static File tv() {
        return Path.check(new File(String.valueOf(Path.root()) + File.separator + "TV"));
    }

    public static File tv(String object) {
        if (!((String)object).startsWith(".")) {
            object = "." + (String)object;
        }
        return new File(Path.tv(), (String)object);
    }

    public static String read(File file) {
        try {
            return Path.read(new FileInputStream(file));
        }
        catch (Exception exception) {
            return "";
        }
    }

    public static String read(String string) {
        try {
            return Path.read(new FileInputStream(string));
        }
        catch (Exception exception) {
            return "";
        }
    }

    public static String read(InputStream inputStream) {
        try {
            byte[] byArray = new byte[inputStream.available()];
            inputStream.read(byArray);
            inputStream.close();
            return new String(byArray, "UTF-8");
        }
        catch (IOException iOException) {
            iOException.printStackTrace();
            return "";
        }
    }

    public static File write(File file, String string) {
        return Path.write(file, string.getBytes());
    }

    public static File write(File file, byte[] byArray) {
        try {
            FileOutputStream fileOutputStream = new FileOutputStream(file);
            fileOutputStream.write(byArray);
            fileOutputStream.flush();
            fileOutputStream.close();
            return file;
        }
        catch (Exception exception) {
            return file;
        }
    }

    public static void move(File file, File file2) {
        Path.copy(file, file2);
        Path.clear(file);
    }

    public static void copy(File file, File file2) {
        try {
            Path.copy((InputStream)new FileInputStream(file), new FileOutputStream(file2));
        }
        catch (Exception exception) {
            // empty catch block
        }
    }

    public static void copy(InputStream inputStream, File file) {
        try {
            Path.copy(inputStream, new FileOutputStream(file));
        }
        catch (Exception exception) {
            // empty catch block
        }
    }

    public static void copy(InputStream inputStream, OutputStream outputStream) throws IOException {
        int n;
        byte[] byArray = new byte[8192];
        while ((n = inputStream.read(byArray)) != -1) {
            outputStream.write(byArray, 0, n);
        }
    }

    public static List<File> list(File file) {
        File[] fileArray = file.listFiles();
        return fileArray == null ? Collections.emptyList() : Arrays.asList(fileArray);
    }

    public static void clear(File file) {
        if (file == null) {
            return;
        }
        if (file.isDirectory()) {
            for (File file2 : Path.list(file)) {
                Path.clear(file2);
            }
        }
        if (file.delete()) {
            Logger.getLogger(TAG).log(Level.FINE, "Deleted:" + file.getAbsolutePath());
        }
    }
}

