package com.github.catvod.spider.merge.m;

import android.util.Base64;
import com.github.catvod.crawler.SpiderDebug;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.spec.AlgorithmParameterSpec;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class a {
    private a() {
    }

    public static String a(String data, String key, String iv) {
        try {
            Cipher cipher = resolveCipher("AES/CBC/PKCS7Padding", "AES/CBC/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(), "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes());
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
            return new String(cipher.doFinal(Base64.decode(data, Base64.DEFAULT)), StandardCharsets.UTF_8);
        } catch (Exception error) {
            error.printStackTrace();
            SpiderDebug.log(error);
            return "";
        }
    }

    public static String b(String data, String key, String iv) {
        try {
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes("UTF-8"), "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes("UTF-8"));
            Cipher cipher = resolveCipher("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
            return new String(cipher.doFinal(Base64.decode(data, Base64.DEFAULT)), "UTF-8");
        } catch (Exception error) {
            SpiderDebug.log(String.valueOf(error));
            return null;
        }
    }

    public static String c(String data, String key, String iv) {
        try {
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes("UTF-8"), "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes("UTF-8"));
            Cipher cipher = resolveCipher("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
            String result = new String(cipher.doFinal(k(data)), "UTF-8");
            SpiderDebug.log("->" + result);
            return result;
        } catch (Exception error) {
            SpiderDebug.log(String.valueOf(error));
            return null;
        }
    }

    public static String d(String data, byte[] key, byte[] iv) {
        try {
            Cipher cipher = resolveCipher("AES/CBC/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);
            return Base64.encodeToString(cipher.doFinal(data.getBytes()), Base64.DEFAULT);
        } catch (Exception error) {
            error.printStackTrace();
            return null;
        }
    }

    public static String e(String data, byte[] key, byte[] iv) {
        try {
            Cipher cipher = resolveCipher("AES/CBC/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);
            byte[] encrypted = cipher.doFinal(data.getBytes());
            StringBuilder builder = new StringBuilder();
            for (byte next : encrypted) {
                builder.append(String.format("%02x", next));
            }
            return builder.toString();
        } catch (Exception error) {
            System.out.println("dec err::" + error);
            return null;
        }
    }

    public static String f(String data, String key, String iv) throws Exception {
        SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(), "AES");
        IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes());
        Cipher cipher = resolveCipher("AES/CTR/PKCS5Padding", "AES/CTR/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey, ivSpec);
        return new String(cipher.doFinal(Base64.decode(data, Base64.DEFAULT)));
    }

    public static String g(String data, String key, String iv) {
        try {
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(), "AES");
            IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes());
            Cipher cipher = resolveCipher("AES/CTR/PKCS5Padding", "AES/CTR/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);
            return Base64.encodeToString(cipher.doFinal(data.getBytes()), Base64.DEFAULT);
        } catch (Exception error) {
            error.printStackTrace();
            return "";
        }
    }

    public static String h(String data, String key) {
        try {
            Cipher cipher = resolveCipher("AES/ECB/PKCS7Padding", "AES/ECB/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(), "AES");
            cipher.init(Cipher.DECRYPT_MODE, secretKey);
            return new String(cipher.doFinal(Base64.decode(data, Base64.DEFAULT)), StandardCharsets.UTF_8);
        } catch (Exception error) {
            error.printStackTrace();
            return "";
        }
    }

    public static String i(String data, String key) {
        try {
            Cipher cipher = resolveCipher("AES/ECB/PKCS7Padding", "AES/ECB/PKCS5Padding");
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(), "AES");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            return Base64.encodeToString(cipher.doFinal(data.getBytes()), Base64.DEFAULT);
        } catch (Exception error) {
            error.printStackTrace();
            return "";
        }
    }

    public static String j(String hexData, byte[] key, byte[] iv, byte[] aad) {
        try {
            byte[] payload = k(hexData);
            byte[] combined = new byte[payload.length + aad.length];
            System.arraycopy(payload, 0, combined, 0, payload.length);
            System.arraycopy(aad, 0, combined, payload.length, aad.length);

            SecretKeySpec secretKey = new SecretKeySpec(key, "AES");
            AlgorithmParameterSpec params = null;
            if (android.os.Build.VERSION.SDK_INT >= 19) {
                params = new GCMParameterSpec(128, iv);
            }

            Cipher cipher = resolveCipher("AES/GCM/NoPadding");
            if (android.os.Build.VERSION.SDK_INT >= 19 && params != null) {
                cipher.init(Cipher.DECRYPT_MODE, secretKey, params);
            }
            return new String(cipher.doFinal(combined), "UTF-8");
        } catch (Exception error) {
            error.printStackTrace();
            return "";
        }
    }

    public static byte[] k(String hex) {
        if (hex.length() % 2 != 0) {
            throw new IllegalArgumentException("invalid hex string");
        }
        char[] chars = hex.toCharArray();
        byte[] result = new byte[hex.length() / 2];
        int outIndex = 0;
        for (int i = 0; i < hex.length(); i += 2) {
            StringBuilder builder = new StringBuilder();
            builder.append(chars[i]);
            builder.append(chars[i + 1]);
            result[outIndex++] = (byte) (Integer.parseInt(builder.toString(), 16) & 255);
        }
        return result;
    }

    public static byte[] l(String data, String key, String iv) {
        try {
            IvParameterSpec ivSpec = new IvParameterSpec(iv.getBytes(StandardCharsets.UTF_8));
            SecretKeySpec secretKey = new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "AES");
            Cipher cipher = resolveCipher("AES/CBC/PKCS5PADDING", "AES/CBC/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivSpec);
            return cipher.doFinal(data.getBytes());
        } catch (Exception ignored) {
            return "".getBytes();
        }
    }

    private static Cipher resolveCipher(String... transformations) throws Exception {
        Exception last = null;
        for (String transformation : transformations) {
            try {
                return Cipher.getInstance(transformation);
            } catch (Exception error) {
                last = error;
            }
        }
        throw last == null ? new IllegalStateException("No cipher transformation available") : last;
    }
}
