/*
 * Decompiled with CFR 0.152.
 */
package com.github.catvod.net;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.X509TrustManager;

public class SSLCompat
extends SSLSocketFactory {
    private SSLSocketFactory factory;
    private String[] cipherSuites;
    private String[] protocols;
    public static final X509TrustManager TM = new X509TrustManager(){

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
    };

    public SSLCompat() {
        try {
            LinkedList<String> linkedList = new LinkedList<String>();
            SSLSocket sSLSocket = (SSLSocket)SSLSocketFactory.getDefault().createSocket();
            for (String string : sSLSocket.getSupportedProtocols()) {
                if (string.toUpperCase().contains("SSL")) continue;
                linkedList.add(string);
            }
            this.protocols = linkedList.toArray(new String[0]);
            List<String> list = Arrays.asList("TLS_RSA_WITH_AES_256_GCM_SHA384", "TLS_RSA_WITH_AES_128_GCM_SHA256", "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256", "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256", "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384", "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256", "TLS_ECHDE_RSA_WITH_AES_128_GCM_SHA256", "TLS_RSA_WITH_3DES_EDE_CBC_SHA", "TLS_RSA_WITH_AES_128_CBC_SHA", "TLS_RSA_WITH_AES_256_CBC_SHA", "TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA", "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA", "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA", "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA");
            List<String> list2 = Arrays.asList(sSLSocket.getSupportedCipherSuites());
            HashSet<String> hashSet = new HashSet<String>(list);
            hashSet.retainAll(list2);
            hashSet.addAll(new HashSet<String>(Arrays.asList(sSLSocket.getEnabledCipherSuites())));
            this.cipherSuites = hashSet.toArray(new String[0]);
            SSLContext sSLContext = SSLContext.getInstance("TLS");
            sSLContext.init(null, new X509TrustManager[]{TM}, null);
            this.factory = sSLContext.getSocketFactory();
            HttpsURLConnection.setDefaultSSLSocketFactory(this.factory);
        }
        catch (Exception exception) {
            exception.printStackTrace();
        }
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return this.cipherSuites;
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return this.cipherSuites;
    }

    @Override
    public Socket createSocket(Socket socket, String string, int n, boolean bl) throws IOException {
        Socket socket2 = this.factory.createSocket(socket, string, n, bl);
        if (socket2 instanceof SSLSocket) {
            this.upgradeTLS((SSLSocket)socket2);
        }
        return socket2;
    }

    @Override
    public Socket createSocket(String string, int n) throws IOException {
        Socket socket = this.factory.createSocket(string, n);
        if (socket instanceof SSLSocket) {
            this.upgradeTLS((SSLSocket)socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(String string, int n, InetAddress inetAddress, int n2) throws IOException {
        Socket socket = this.factory.createSocket(string, n, inetAddress, n2);
        if (socket instanceof SSLSocket) {
            this.upgradeTLS((SSLSocket)socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(InetAddress inetAddress, int n) throws IOException {
        Socket socket = this.factory.createSocket(inetAddress, n);
        if (socket instanceof SSLSocket) {
            this.upgradeTLS((SSLSocket)socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(InetAddress inetAddress, int n, InetAddress inetAddress2, int n2) throws IOException {
        Socket socket = this.factory.createSocket(inetAddress, n, inetAddress2, n2);
        if (socket instanceof SSLSocket) {
            this.upgradeTLS((SSLSocket)socket);
        }
        return socket;
    }

    private void upgradeTLS(SSLSocket sSLSocket) {
        if (this.protocols != null) {
            sSLSocket.setEnabledProtocols(this.protocols);
        }
        if (this.cipherSuites != null) {
            sSLSocket.setEnabledCipherSuites(this.cipherSuites);
        }
    }
}

