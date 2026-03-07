package com.github.catvod.net;

import okhttp3.Interceptor;
import okhttp3.Response;

import java.io.IOException;

/**
 * Simple pass-through interceptor for OkHttp.
 */
public class OkhttpInterceptor implements Interceptor {
    @Override
    public Response intercept(Chain chain) throws IOException {
        return chain.proceed(chain.request());
    }
}