package com.github.catvod.utils;

import java.io.File;

/**
 * Path utility for CatVod spiders. Provides standard paths on desktop.
 */
public class Path {

    private static File root;

    public static File root() {
        if (root == null) {
            String dir = System.getProperty("halo.compat.dir",
                System.getProperty("java.io.tmpdir") + File.separator + "halo_compat");
            root = new File(dir);
            if (!root.exists()) root.mkdirs();
        }
        return root;
    }

    public static File files() {
        File f = new File(root(), "files");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    public static File cache() {
        File f = new File(root(), "cache");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    public static File jar() {
        File f = new File(root(), "jar");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    public static File thunder() {
        File f = new File(root(), "thunder");
        if (!f.exists()) f.mkdirs();
        return f;
    }

    public static File local(String name) {
        return new File(files(), name);
    }

    public static File cache(String name) {
        return new File(cache(), name);
    }

    public static File jar(String name) {
        return new File(jar(), name);
    }

    public static String rootPath() {
        return root().getAbsolutePath();
    }
}