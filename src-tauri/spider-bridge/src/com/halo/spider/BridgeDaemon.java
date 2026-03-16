package com.halo.spider;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

public final class BridgeDaemon {
    private static final Object STDOUT_LOCK = new Object();
    private static final ConcurrentHashMap<Long, InFlightCall> IN_FLIGHT_CALLS = new ConcurrentHashMap<>();

    private BridgeDaemon() {
    }

    public static void main(String[] ignoredArgs) throws Exception {
        PrintStream originalOut = System.out;
        System.setOut(System.err);

        ExecutorService executor = Executors.newCachedThreadPool();
        try (BufferedReader reader =
                new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }

                JSONObject request;
                try {
                    request = new JSONObject(trimmed);
                } catch (Throwable error) {
                    writeError(originalOut, -1L, "invalid daemon request: " + error.getMessage());
                    continue;
                }

                long id = request.optLong("id", -1L);
                String method = request.optString("method", "").trim();
                if ("ping".equals(method)) {
                    writeOk(originalOut, id, "pong");
                    continue;
                }
                if ("cancel".equals(method)) {
                    JSONObject params = request.optJSONObject("params");
                    long targetRequestId = params == null ? -1L : params.optLong("requestId", -1L);
                    InFlightCall inFlight = targetRequestId < 0L ? null : IN_FLIGHT_CALLS.get(targetRequestId);
                    if (inFlight != null) {
                        inFlight.cancelled.set(true);
                        Future<?> future = inFlight.future;
                        if (future != null) {
                            future.cancel(true);
                        }
                    }
                    writeOk(originalOut, id, inFlight == null ? "cancel_missing" : "cancelled");
                    continue;
                }
                if ("shutdown".equals(method)) {
                    writeOk(originalOut, id, "shutdown");
                    break;
                }
                if (!"call".equals(method)) {
                    writeError(originalOut, id, "unsupported daemon method: " + method);
                    continue;
                }

                JSONObject params = request.optJSONObject("params");
                if (params == null) {
                    writeError(originalOut, id, "daemon call params missing");
                    continue;
                }

                InFlightCall inFlight = new InFlightCall();
                IN_FLIGHT_CALLS.put(id, inFlight);
                Future<?> future = executor.submit(() -> {
                    try {
                        JSONObject response = BridgeRuntimeHost.executeFromJson(params);
                        if (inFlight.cancelled.get()) {
                            return;
                        }
                        response.put("id", id);
                        writeResponse(originalOut, response);
                    } catch (Throwable error) {
                        if (inFlight.cancelled.get()) {
                            return;
                        }
                        writeError(originalOut, id, "daemon call failed: " + error.getMessage());
                    } finally {
                        IN_FLIGHT_CALLS.remove(id, inFlight);
                    }
                });
                inFlight.future = future;
                if (inFlight.cancelled.get()) {
                    future.cancel(true);
                }
            }
        } finally {
            BridgeRuntimeHost.shutdownSessions();
            executor.shutdownNow();
            executor.awaitTermination(1, TimeUnit.SECONDS);
        }
    }

    private static final class InFlightCall {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile Future<?> future;
    }

    private static void writeOk(PrintStream out, long id, String result) {
        JSONObject payload = new JSONObject();
        payload.put("id", id);
        payload.put("ok", true);
        payload.put("className", "");
        payload.put("result", result);
        payload.put("error", "");
        writeResponse(out, payload);
    }

    private static void writeError(PrintStream out, long id, String error) {
        JSONObject payload = new JSONObject();
        payload.put("id", id);
        payload.put("ok", false);
        payload.put("className", "");
        payload.put("result", "");
        payload.put("error", error == null ? "unknown daemon error" : error);
        writeResponse(out, payload);
    }

    private static void writeResponse(PrintStream out, JSONObject payload) {
        synchronized (STDOUT_LOCK) {
            out.println(payload.toString());
            out.flush();
        }
    }
}
