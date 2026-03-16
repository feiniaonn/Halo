package com.github.catvod.net;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.security.SecureRandom;

/**
 * SSLCompat - wraps SSLSocketFactory for TLS version compatibility.
 */
public class SSLCompat extends SSLSocketFactory {

    private final SSLSocketFactory delegate;

    public SSLCompat() {
        this(buildDefaultFactory());
    }

    public SSLCompat(SSLSocketFactory delegate) {
        this.delegate = delegate == null ? buildDefaultFactory() : delegate;
    }

    private static SSLSocketFactory buildDefaultFactory() {
        try {
            SSLContext sslContext = SSLContext.getInstance("TLS");
            sslContext.init(null, null, new SecureRandom());
            return sslContext.getSocketFactory();
        } catch (Exception e) {
            return (SSLSocketFactory) SSLSocketFactory.getDefault();
        }
    }

    @Override
    public String[] getDefaultCipherSuites() {
        return delegate.getDefaultCipherSuites();
    }

    @Override
    public String[] getSupportedCipherSuites() {
        return delegate.getSupportedCipherSuites();
    }

    @Override
    public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
        return enableTLS(delegate.createSocket(s, host, port, autoClose));
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
        return enableTLS(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(String host, int port, InetAddress localHost, int localPort) throws IOException {
        return enableTLS(delegate.createSocket(host, port, localHost, localPort));
    }

    @Override
    public Socket createSocket(InetAddress host, int port) throws IOException {
        return enableTLS(delegate.createSocket(host, port));
    }

    @Override
    public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort) throws IOException {
        return enableTLS(delegate.createSocket(address, port, localAddress, localPort));
    }

    private Socket enableTLS(Socket socket) {
        if (socket instanceof SSLSocket) {
            SSLSocket sslSocket = (SSLSocket) socket;
            String[] protocols = new String[] { "TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1" };
            java.util.List<String> supportedProtocols =
                    java.util.Arrays.asList(sslSocket.getSupportedProtocols());
            java.util.List<String> enabledProtocols = new java.util.ArrayList<>();
            for (String protocol : protocols) {
                if (supportedProtocols.contains(protocol)) {
                    enabledProtocols.add(protocol);
                }
            }
            if (!enabledProtocols.isEmpty()) {
                sslSocket.setEnabledProtocols(enabledProtocols.toArray(new String[0]));
            }
            sslSocket.setEnabledCipherSuites(sslSocket.getSupportedCipherSuites());
        }
        return socket;
    }
}
