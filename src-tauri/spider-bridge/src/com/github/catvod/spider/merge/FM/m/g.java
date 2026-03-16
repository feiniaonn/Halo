package com.github.catvod.spider.merge.FM.m;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.X509TrustManager;

public final class g extends SSLSocketFactory {
    public static final X509TrustManager d = new TrustAllManager();

    private final SSLSocketFactory a;
    private final String[] b;
    private final String[] c;

    public g() {
        List<String> supportedProtocols = new LinkedList<>();
        String[] enabledProtocols = new String[0];
        String[] enabledCipherSuites = new String[0];

        try {
            SSLSocket probe = (SSLSocket) SSLSocketFactory.getDefault().createSocket();
            try {
                for (String protocol : probe.getSupportedProtocols()) {
                    if (!protocol.toUpperCase().contains("SSL")) {
                        supportedProtocols.add(protocol);
                    }
                }
                enabledCipherSuites = probe.getEnabledCipherSuites();
            } finally {
                try {
                    probe.close();
                } catch (IOException ignored) {
                }
            }
            enabledProtocols = supportedProtocols.toArray(new String[0]);
        } catch (Exception ignored) {
            enabledProtocols = new String[] { "TLSv1", "TLSv1.1", "TLSv1.2" };
        }
        this.c = enabledProtocols;

        List<String> preferredCipherSuites = Arrays.asList(
                "TLS_RSA_WITH_AES_256_GCM_SHA384",
                "TLS_RSA_WITH_AES_128_GCM_SHA256",
                "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
                "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
                "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
                "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
                "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
                "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
                "TLS_RSA_WITH_AES_128_CBC_SHA",
                "TLS_RSA_WITH_AES_256_CBC_SHA",
                "TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA",
                "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
                "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
                "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA");

        Set<String> supportedCipherSet = new HashSet<>();
        try {
            SSLSocket probe = (SSLSocket) SSLSocketFactory.getDefault().createSocket();
            try {
                supportedCipherSet.addAll(Arrays.asList(probe.getSupportedCipherSuites()));
            } finally {
                try {
                    probe.close();
                } catch (IOException ignored) {
                }
            }
        } catch (Exception ignored) {
        }

        Set<String> resolvedCipherSuites = new HashSet<>(preferredCipherSuites);
        if (!supportedCipherSet.isEmpty()) {
            resolvedCipherSuites.retainAll(supportedCipherSet);
        }
        resolvedCipherSuites.addAll(Arrays.asList(enabledCipherSuites));
        this.b = resolvedCipherSuites.toArray(new String[0]);

        SSLSocketFactory socketFactory = null;
        try {
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, new javax.net.ssl.TrustManager[] { d }, new SecureRandom());
            socketFactory = sslContext.getSocketFactory();
            HttpsURLConnection.setDefaultSSLSocketFactory(socketFactory);
        } catch (Exception error) {
            error.printStackTrace();
        }
        this.a = socketFactory == null ? (SSLSocketFactory) SSLSocketFactory.getDefault() : socketFactory;
    }

    private void a(SSLSocket socket) {
        if (socket == null) {
            return;
        }
        if (c != null && c.length > 0) {
            socket.setEnabledProtocols(c);
        }
        if (b != null && b.length > 0) {
            socket.setEnabledCipherSuites(b);
        }
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        Socket socket = a.createSocket(host, port);
        if (socket instanceof SSLSocket) {
            a((SSLSocket) socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort)
            throws IOException {
        Socket socket = a.createSocket(host, port, localHost, localPort);
        if (socket instanceof SSLSocket) {
            a((SSLSocket) socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        Socket socket = a.createSocket(host, port);
        if (socket instanceof SSLSocket) {
            a((SSLSocket) socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort)
            throws IOException {
        Socket socket = a.createSocket(address, port, localAddress, localPort);
        if (socket instanceof SSLSocket) {
            a((SSLSocket) socket);
        }
        return socket;
    }

    @Override
    public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
        Socket socket = a.createSocket(s, host, port, autoClose);
        if (socket instanceof SSLSocket) {
            a((SSLSocket) socket);
        }
        return socket;
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return b;
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return b;
    }

    private static final class TrustAllManager implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {
        }

        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
