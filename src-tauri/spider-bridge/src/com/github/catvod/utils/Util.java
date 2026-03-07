/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.github.catvod.spider.Init
 *  com.github.catvod.spider.Proxy
 *  com.github.catvod.utils.Swings
 *  okhttp3.Response
 *  org.apache.commons.lang3.StringUtils
 *  org.apache.http.client.utils.DateUtils
 */
package com.github.catvod.utils;

import com.github.catvod.crawler.SpiderDebug;
import com.github.catvod.net.OkHttp;
import com.github.catvod.spider.Init;
import com.github.catvod.spider.Proxy;
import com.github.catvod.utils.Swings;
import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.Frame;
import java.awt.Point;
import java.awt.TextField;
import java.io.IOException;
import java.math.BigInteger;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.swing.BoxLayout;
import javax.swing.ImageIcon;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.Timer;
import javax.swing.UIManager;
import javax.swing.UnsupportedLookAndFeelException;
import javax.swing.border.EmptyBorder;
import okhttp3.Response;
import org.apache.commons.lang3.StringUtils;
import java.text.SimpleDateFormat;

public class Util {
    public static final String patternAli = "(https:\\/\\/www\\.aliyundrive\\.com\\/s\\/[^\"]+|https:\\/\\/www\\.alipan\\.com\\/s\\/[^\"]+)";
    public static final String patternQuark = "(https:\\/\\/pan\\.quark\\.cn\\/s\\/[^\"]+)";
    public static final String patternUC = "(https:\\/\\/drive\\.uc\\.cn\\/s\\/[^\"]+)";
    public static final Pattern RULE = Pattern.compile("http((?!http).){12,}?\\.(m3u8|mp4|flv|avi|mkv|rm|wmv|mpg|m4a|mp3)\\?.*|http((?!http).){12,}\\.(m3u8|mp4|flv|avi|mkv|rm|wmv|mpg|m4a|mp3)|http((?!http).)*?video/tos*");
    public static final String CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36";
    public static final String SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.33";
    public static final String ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
    public static final List<String> MEDIA = Arrays.asList("mp4", "mkv", "wmv", "flv", "avi", "iso", "mpg", "ts", "mp3", "aac", "flac", "m4a", "ape", "ogg");
    public static final List<String> SUB = Arrays.asList("srt", "ass", "ssa", "vtt");
    private static HashMap<String, String> webHttpHeaderMap;
    public static final String CLIENT_ID = "76917ccccd4441c39457a04f6084fb2f";

    public static boolean isVip(String string) {
        List<String> list = Arrays.asList("iqiyi.com", "v.qq.com", "youku.com", "le.com", "tudou.com", "mgtv.com", "sohu.com", "acfun.cn", "bilibili.com", "baofeng.com", "pptv.com");
        for (String string2 : list) {
            if (!string.contains(string2)) continue;
            return true;
        }
        return false;
    }

    public static boolean isBlackVodUrl(String string) {
        List<String> list = Arrays.asList("973973.xyz", ".fit:");
        for (String string2 : list) {
            if (!string.contains(string2)) continue;
            return true;
        }
        return false;
    }

    public static boolean isVideoFormat(String string) {
        if (string.contains("url=http") || string.contains(".js") || string.contains(".css") || string.contains(".html")) {
            return false;
        }
        return RULE.matcher(string).find();
    }

    public static String findByRegex(String string, String string2, Integer n) {
        Pattern pattern = Pattern.compile(string);
        Matcher matcher = pattern.matcher(string2);
        if (matcher.find()) {
            return matcher.group(n);
        }
        return "";
    }

    public static byte[] toUtf8(byte[] byArray) {
        return new String(byArray, StandardCharsets.UTF_8).getBytes();
    }

    public static boolean isSub(String string) {
        return SUB.contains(string);
    }

    public static boolean isMedia(String string) {
        return MEDIA.contains(Util.getExt(string));
    }

    public static String getExt(String string) {
        return string.contains(".") ? string.substring(string.lastIndexOf(".") + 1) : string;
    }

    public static String getSize(double d) {
        if (d <= 0.0) {
            return "";
        }
        if (d > 1.099511627776E12) {
            return String.format(Locale.getDefault(), "%.2f%s", d /= 1.099511627776E12, "TB");
        }
        if (d > 1.073741824E9) {
            return String.format(Locale.getDefault(), "%.2f%s", d /= 1.073741824E9, "GB");
        }
        if (d > 1048576.0) {
            return String.format(Locale.getDefault(), "%.2f%s", d /= 1048576.0, "MB");
        }
        return String.format(Locale.getDefault(), "%.2f%s", d /= 1024.0, "KB");
    }

    public static String fixUrl(String string, String string2) {
        if (string2.startsWith("//")) {
            URI uRI = URI.create(string);
            return uRI.getScheme() + ":" + string2;
        }
        if (!string2.contains("://")) {
            URI uRI = URI.create(string);
            return uRI.getScheme() + "://" + uRI.getHost() + string2;
        }
        return string2;
    }

    public static String removeExt(String string) {
        return string.contains(".") ? string.substring(0, string.lastIndexOf(".")) : string;
    }

    public static String substring(String string) {
        return Util.substring(string, 1);
    }

    public static String substring(String string, int n) {
        if (string != null && string.length() > n) {
            return string.substring(0, string.length() - n);
        }
        return string;
    }

    public static String getVar(String string, String string2) {
        for (String string3 : string.split("var")) {
            if (!string3.contains(string2)) continue;
            return Util.checkVar(string3);
        }
        return "";
    }

    private static String checkVar(String string) {
        if (string.contains("'")) {
            return string.split("'")[1];
        }
        if (string.contains("\"")) {
            return string.split("\"")[1];
        }
        return "";
    }

    public static String md5(String string) {
        return Util.MD5(string);
    }

    public static String MD5(String string) {
        return Util.MD5(string, "UTF-8");
    }

    public static String joinUrl(String parent, String child) {
        if (parent == null || child == null) return "";
        try {
            URI parentUri = new URI(parent);
            return parentUri.resolve(child).toString();
        } catch (Exception e) {
            return child;
        }
    }

    public static String MD5(String string, String string2) {
        try {
            MessageDigest messageDigest = MessageDigest.getInstance("MD5");
            byte[] byArray = messageDigest.digest(string.getBytes(string2));
            BigInteger bigInteger = new BigInteger(1, byArray);
            StringBuilder stringBuilder = new StringBuilder(bigInteger.toString(16));
            while (stringBuilder.length() < 32) {
                stringBuilder.insert(0, "0");
            }
            return stringBuilder.toString().toLowerCase();
        }
        catch (Exception exception) {
            return "";
        }
    }

    public static String ShowInputDialog(String string, CallBack callBack) {
        JDialog jDialog = new JDialog();
        jDialog.setUndecorated(true);
        jDialog.setLocationRelativeTo(null);
        JPanel jPanel = new JPanel(new FlowLayout(1));
        jPanel.setBackground(Color.darkGray);
        jPanel.setForeground(Color.white);
        jPanel.setBorder(Util.getBorder(15));
        jPanel.setSize(Swings.dp2px((int)200), Swings.dp2px((int)80));
        JLabel jLabel = new JLabel(string);
        jLabel.setForeground(Color.white);
        jPanel.add(jLabel);
        TextField textField = new TextField();
        textField.setBackground(Color.darkGray);
        textField.setForeground(Color.white);
        textField.setColumns(32);
        jPanel.add(textField);
        JButton jButton = new JButton("\u5173\u95ed(X)");
        jButton.setBackground(Color.darkGray);
        jButton.setForeground(Color.white);
        jButton.addActionListener(actionEvent -> {
            callBack.apply(textField.getText());
            jDialog.setVisible(false);
            jDialog.dispose();
        });
        jPanel.add(jButton);
        jDialog.add(jPanel);
        jDialog.pack();
        jDialog.setLocation(Swings.getCenter((int)jPanel.getWidth(), (int)jPanel.getHeight()));
        jDialog.setVisible(true);
        return textField.getText();
    }

    public static JDialog showDialog(JPanel jPanel, String string) {
        JDialog jDialog = new JDialog((Frame)null);
        jDialog.setUndecorated(true);
        jPanel.setBorder(Util.getBorder(20));
        jPanel.setLayout(new BoxLayout(jPanel, 1));
        jPanel.setBackground(Color.darkGray);
        JLabel jLabel = new JLabel(String.format("TV-%s", string));
        jLabel.setAlignmentX(0.0f);
        jLabel.setBackground(Color.DARK_GRAY);
        jLabel.setForeground(Color.white);
        jPanel.add(jLabel);
        JButton jButton = new JButton("\u5173\u95ed(X)");
        jButton.addActionListener(actionEvent -> {
            jDialog.setVisible(false);
            jDialog.dispose();
        });
        jButton.setForeground(Color.LIGHT_GRAY);
        jButton.setBackground(Color.darkGray);
        jPanel.add(jButton);
        jDialog.setContentPane(jPanel);
        jDialog.pack();
        jDialog.setLocationRelativeTo(null);
        jDialog.setLocation(Swings.getCenter((int)jPanel.getWidth(), (int)jPanel.getHeight()));
        jDialog.setVisible(true);
        return jDialog;
    }

    public static void notify(String string) {
        Init.execute(() -> {
            try {
                Util.postHttpMsg(string);
            }
            catch (IOException iOException) {
                SpiderDebug.log(iOException);
            }
        });
    }

    private static void postHttpMsg(String string) throws IOException {
        Response response = OkHttp.newCall(Proxy.getHostPort() + "/postMsg?msg=" + string);
        if (!response.isSuccessful()) {
            SpiderDebug.log("send msg fail\uff1a" + string);
        }
    }

    public static void notify(String string, Integer n) {
        Util.showToast(string, n);
    }

    public static void showToast(String string, Integer n) {
        int n2 = Swings.dp2px((int)80);
        int n3 = Swings.dp2px((int)(string.length() > 18 ? 450 : string.length() * 25));
        JDialog jDialog = new JDialog();
        jDialog.setUndecorated(true);
        Point point = Swings.screenRightDown((int)n3, (int)n2);
        jDialog.setBounds(point.x, point.y, n3, n2);
        JPanel jPanel = new JPanel();
        jPanel.setBackground(Color.darkGray);
        jPanel.setBorder(Util.getBorder(10));
        JLabel jLabel = new JLabel(string);
        jLabel.setBounds(0, 0, n3, n2);
        jLabel.setVerticalAlignment(0);
        jLabel.setIcon(new ImageIcon(Util.class.getResource("/TV-icon_1_s.png")));
        jLabel.setFont(jLabel.getFont().deriveFont(Float.valueOf(Swings.dp2px((int)25)).floatValue()));
        jLabel.setForeground(Color.white);
        jPanel.add(jLabel);
        jDialog.setContentPane(jPanel);
        jDialog.pack();
        jDialog.setVisible(true);
        new Timer(n, actionEvent -> jDialog.dispose()).start();
    }

    private static EmptyBorder getBorder(int n) {
        int n2 = Swings.dp2px((int)n);
        return new EmptyBorder(n2, n2, n2, n2);
    }

    public static String getDigit(String string) {
        try {
            Object object = string;
            Matcher matcher = Pattern.compile(".*(1080|720|2160|4k|4K).*").matcher(string);
            if (matcher.find()) {
                object = matcher.group(1) + " " + string;
            }
            if ((matcher = Pattern.compile("^([0-9]+)").matcher(string)).find()) {
                object = matcher.group(1) + " " + (String)object;
            }
            return ((String)object).replaceAll("\\D+", "") + " " + ((String)object).replaceAll("\\d+", "");
        }
        catch (Exception exception) {
            return "";
        }
    }

    public static String getMimeType(String string) {
        if (string.endsWith(".mp4")) {
            return "video/mp4";
        }
        if (string.endsWith(".webm")) {
            return "video/webm";
        }
        if (string.endsWith(".avi")) {
            return "video/x-msvideo";
        }
        if (string.endsWith(".wmv")) {
            return "video/x-ms-wmv";
        }
        if (string.endsWith(".flv")) {
            return "video/x-flv";
        }
        if (string.endsWith(".mov")) {
            return "video/quicktime";
        }
        if (string.endsWith(".mkv")) {
            return "video/x-matroska";
        }
        if (string.endsWith(".mpeg")) {
            return "video/mpeg";
        }
        if (string.endsWith(".3gp")) {
            return "video/3gpp";
        }
        if (string.endsWith(".ts")) {
            return "video/MP2T";
        }
        if (string.endsWith(".mp3")) {
            return "audio/mp3";
        }
        if (string.endsWith(".wav")) {
            return "audio/wav";
        }
        if (string.endsWith(".aac")) {
            return "audio/aac";
        }
        return null;
    }

    public static void sleep(Integer n) {
        try {
            Thread.sleep(n.intValue());
        }
        catch (InterruptedException interruptedException) {
            // empty catch block
        }
    }

    public static HashMap<String, String> webHeaders(String string, String string2) {
        return Util.webHeaders(string, "", string2);
    }

    public static HashMap<String, String> webHeaders(String string) {
        return Util.webHeaders(string, "");
    }

    public static HashMap<String, String> webHeaders(String string, String string2, String string3) {
        webHttpHeaderMap = new HashMap();
        webHttpHeaderMap.put("Accept-Language", "zh-CN,zh;q=0.8,zh-TW;q=0.7,zh-HK;q=0.5,en-US;q=0.3,en;q=0.2");
        webHttpHeaderMap.put("Connection", "keep-alive");
        webHttpHeaderMap.put("User-Agent", CHROME);
        webHttpHeaderMap.put("Accept", "*/*");
        if (StringUtils.isNotBlank((CharSequence)string)) {
            webHttpHeaderMap.put("Referer", string);
        }
        if (StringUtils.isNotBlank((CharSequence)string2)) {
            try {
                URI uRI = new URI(string2);
                webHttpHeaderMap.put("Host", uRI.getHost());
            }
            catch (Exception exception) {
                // empty catch block
            }
        }
        if (StringUtils.isNotBlank((CharSequence)string3)) {
            webHttpHeaderMap.put("Cookie", string3);
        }
        return webHttpHeaderMap;
    }

    public static String timestampToDateStr(Long l) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date(l));
    }

    public static String base64Encode(String string) {
        return new String(Base64.getEncoder().encode(string.getBytes()));
    }

    public static String base64Encode(byte[] byArray) {
        return new String(Base64.getEncoder().encode(byArray));
    }

    public static String base64Decode(String string) {
        if (StringUtils.isBlank((CharSequence)string)) {
            return "";
        }
        return new String(Base64.getDecoder().decode(string));
    }

    public static String stringJoin(String string, Collection<String> collection) {
        return StringUtils.join(collection, (String)string);
    }

    public static String stringJoin(Collection<String> collection, String string) {
        return StringUtils.join(collection, (String)string);
    }

    public static LCSResult lcs(String string, String string2) {
        if (string == null || string2 == null) {
            return new LCSResult(0, "", 0);
        }
        StringBuilder stringBuilder = new StringBuilder();
        int n = string.length();
        int n2 = string2.length();
        int[][] nArray = new int[n][n2];
        int n3 = 0;
        int n4 = 0;
        for (int i = 0; i < n; ++i) {
            for (int j = 0; j < n2; ++j) {
                if (string.charAt(i) != string2.charAt(j)) {
                    nArray[i][j] = 0;
                    continue;
                }
                nArray[i][j] = i == 0 || j == 0 ? 1 : 1 + nArray[i - 1][j - 1];
                if (nArray[i][j] <= n3) continue;
                n3 = nArray[i][j];
                int n5 = i - nArray[i][j] + 1;
                if (n4 == n5) {
                    stringBuilder.append(string.charAt(i));
                    continue;
                }
                n4 = n5;
                stringBuilder.setLength(0);
                stringBuilder.append(string.substring(n4, i + 1));
            }
        }
        return new LCSResult(n3, stringBuilder.toString(), n4);
    }

    public static Integer findAllIndexes(List<String> list, String string) {
        for (int i = 0; i < list.size(); ++i) {
            if (!list.get(i).equals(string)) continue;
            return i;
        }
        return 0;
    }

    static {
        try {
            UIManager.setLookAndFeel("javax.swing.plaf.nimbus.NimbusLookAndFeel");
        }
        catch (ClassNotFoundException | IllegalAccessException | InstantiationException | UnsupportedLookAndFeelException exception) {
            exception.printStackTrace();
        }
    }

    @FunctionalInterface
    public static interface CallBack {
        public void apply(String var1);
    }

    public static class LCSResult {
        public int length;
        public String sequence;
        public int offset;

        public LCSResult(int n, String string, int n2) {
            this.length = n;
            this.sequence = string;
            this.offset = n2;
        }
    }
}

