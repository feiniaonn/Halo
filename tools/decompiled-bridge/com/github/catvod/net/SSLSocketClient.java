/*
 * Decompiled with CFR 0.152.
 */
package com.github.catvod.net;

import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

public class SSLSocketClient {
    public static SSLSocketFactory getSSLSocketFactory() {
        try {
            SSLContext sSLContext = SSLContext.getInstance("SSL");
            sSLContext.init(null, SSLSocketClient.getTrustManager(), new SecureRandom());
            return sSLContext.getSocketFactory();
        }
        catch (Exception exception) {
            throw new RuntimeException(exception);
        }
    }

    private static TrustManager[] getTrustManager() {
        return new TrustManager[]{new X509TrustManager(){

            @Override
            public void checkClientTrusted(X509Certificate[] x509CertificateArray, String string) {
            }

            @Override
            public void checkServerTrusted(X509Certificate[] x509CertificateArray, String string) {
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }};
    }

    public static HostnameVerifier getHostnameVerifier() {
        return (string, sSLSession) -> true;
    }

    public static X509TrustManager getX509TrustManager() {
        X509TrustManager x509TrustManager = null;
        try {
            TrustManagerFactory trustManagerFactory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            trustManagerFactory.init((KeyStore)null);
            Object[] objectArray = trustManagerFactory.getTrustManagers();
            if (objectArray.length != 1 || !(objectArray[0] instanceof X509TrustManager)) {
                throw new IllegalStateException("Unexpected default trust managers:" + Arrays.toString(objectArray));
            }
            x509TrustManager = (X509TrustManager)objectArray[0];
        }
        catch (Exception exception) {
            exception.printStackTrace();
        }
        return x509TrustManager;
    }
}

