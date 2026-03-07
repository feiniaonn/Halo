                    video.addEventListener("playing", playingHandler, { once: true });
                }
                waitForStartupBufferAndPlay(index, attemptId, () => {
                    if (playingHandler) {
                        video.removeEventListener("playing", playingHandler);
                    }
                    onTimeout();
                });
            };

            // Silent Failover Timer (if no progress after timeout, try next line)
            const dynamicFailoverSec = STARTUP_TIMEOUT_SECONDS;
            failoverTimerRef.current = window.setTimeout(() => {
                if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                if (!hasPlaybackProgress) {
                    if (startupPhaseRef.current) {
                        if (!switchToSameLineRecover("startup phase no progress", "warn")) {
                            switchKernelOrLine("[LivePlayer] Startup phase no progress", "warn");
                        }
                        return;
                    }
                    switchKernelOrLine(`[LivePlayer] Line ${index + 1} silent failover (${dynamicFailoverSec}s no-progress), switching...`, "warn");
                }
            }, dynamicFailoverSec * 1000);

            // Priority 1: DASH
            if (isDash) {
                kernelRef.current = "dash";
                setActiveKernelDisplay("dash");
                termLog("[LivePlayer] Initializing dash.js kernel", "info");
                const player = dashjs.MediaPlayer().create();
                player.initialize(video, url, false);
                player.on(dashjs.MediaPlayer.events.ERROR, (e) => {
                    if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                    switchToNextLine(`[LivePlayer] dash.js Fatal Error: ${JSON.stringify(e)}`, "warn");
                });
                player.on(dashjs.MediaPlayer.events.PLAYBACK_STARTED, () => {
                    if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                    markPlaybackProgress("[LivePlayer] dash.js: Playback started");
                });
                dashRef.current = player;
                waitForStartupGate("dash.js", () => {
                    if (!switchToSameLineRecover("dash startup timeout", "warn")) {
                        switchToNextLine("[LivePlayer] dash startup timeout", "warn");
                    }
                }, true);
            }
            // Priority 2: FLV/TS (MSE)
            else if (isMpegts) {
                kernelRef.current = "mpegts";
                setActiveKernelDisplay("mpegts");
                termLog("[LivePlayer] Initializing mpegts.js kernel", "info");
                if (mpegts.getFeatureList().mseLivePlayback) {
                    const type: "flv" | "mse" = lowerUrl.includes(".flv") ? "flv" : "mse";
                    const player = mpegts.createPlayer({ type, isLive: true, url, cors: true });
                    player.attachMediaElement(video);
                    player.load();

                    player.on(mpegts.Events.ERROR, (type, detail) => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        switchToNextLine(`[LivePlayer] mpegts.js Error: Type=${type}, Detail=${detail}`, "warn");
                    });
                    mpegtsRef.current = player;
                    waitForStartupGate("mpegts.js", () => {
                        if (!switchToSameLineRecover("mpegts startup timeout", "warn")) {
                            switchToNextLine("[LivePlayer] mpegts startup timeout", "warn");
                        }
                    }, true);
                } else {
                    switchToNextLine("[LivePlayer] Browser lacks mpegts.js support, skipping to next", "warn");
                }
            }
            // Priority 3: HLS (hls.js)
            else {
                const wantsMpv = selectedHlsKernel === "mpv";
                const wantsNative = selectedHlsKernel === "native";
                const wantsProxy = selectedHlsKernel === "proxy";
                if (wantsMpv) {
                    if (!isTauri()) {
                        noteKernelFailure(activeChannel, index, "mpv", "fatal");
                        switchKernelOrLine("[LivePlayer] mpv kernel requires Tauri runtime", "warn");
                        return;
                    }
                    kernelRef.current = "mpv";
                    setActiveKernelDisplay("mpv");
                    termLog("[LivePlayer] Initializing mpv kernel", "info");

                    const mpvArgs = [
                        "--profile=low-latency",
                        "--cache=yes",
                        "--cache-secs=20",
                        "--demuxer-max-bytes=64MiB",
                        "--demuxer-max-back-bytes=32MiB",
                        "--hwdec=auto-safe",
                        "--keep-open=yes",
                        "--force-window=yes",
                        "--background=color",
                        "--background-color=#00000000",
                    ];

                    const mpvConfig: MpvConfig = {
                        args: mpvArgs,
                        observedProperties: MPV_OBSERVED_PROPERTIES,
                        ipcTimeoutMs: 3000,
                    };

                    try {
                        const builtinMpvPath = await invoke<string>("get_builtin_mpv_path");
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        mpvConfig.path = builtinMpvPath;
                        termLog(`[LivePlayer] mpv using bundled binary: ${builtinMpvPath}`, "info");
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        noteKernelFailure(activeChannel, index, "mpv", "fatal");
                        switchKernelOrLine(`[LivePlayer] mpv bundled binary unavailable: ${msg}`, "warn");
                        return;
                    }

                    const initMpvForWindow = async () => {
                        const usedLabel = await initMpv(mpvConfig, MPV_WINDOW_LABEL);
                        if (usedLabel !== MPV_WINDOW_LABEL) {
                            throw new Error(
                                `mpv initialized on unexpected window label: ${usedLabel}`
                            );
                        }
                    };

                    try {
                        await initMpvForWindow();
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        mpvInitializedRef.current = true;
                        setIsMpvActive(true);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        // Single retry after short delay — allows Rust mutex to recover from poison
                        termLog(`[LivePlayer] mpv init failed (attempt 1): ${msg}, retrying...`, "warn");
                        try {
                            await new Promise(r => setTimeout(r, 500));
                            if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                            await initMpvForWindow();
                            if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                            mpvInitializedRef.current = true;
                            setIsMpvActive(true);
                            termLog("[LivePlayer] mpv init retry succeeded", "info");
                        } catch (e2) {
                            const msg2 = e2 instanceof Error ? e2.message : String(e2);
                            noteKernelFailure(activeChannel, index, "mpv", "fatal");
                            switchKernelOrLine(`[LivePlayer] mpv init failed: ${msg2}`, "warn");
                            return;
                        }
                    }

                    if (mpvUnlistenRef.current) {
                        try {
                            mpvUnlistenRef.current();
                        } catch {
                            // ignore stale unlisten
                        }
                        mpvUnlistenRef.current = null;
                    }

                    try {
                        mpvUnlistenRef.current = await observeMpvProperties(
                            MPV_OBSERVED_PROPERTIES,
                            (evt) => {
                                if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                                if (evt.name === "time-pos" && typeof evt.data === "number" && evt.data >= 0.2) {
                                    markPlaybackProgress("[LivePlayer] mpv: time advancing");
                                } else if (evt.name === "pause") {
                                    if (evt.data === false) {
                                        markPlaybackProgress("[LivePlayer] mpv: resumed");
                                    }
                                    handleSetIsPlaying(evt.data === false);
                                } else if (evt.name === "eof-reached" && evt.data === true) {
                                    switchKernelOrLine("[LivePlayer] mpv reached eof", "warn");
                                } else if (evt.name === "demuxer-cache-duration" && typeof evt.data === "number") {
                                    setBufferAheadSeconds(evt.data);
                                } else if (evt.name === "video-bitrate" && typeof evt.data === "number") {
                                    mpvBitrateRefs.current.video = evt.data;
                                    setMpvBitrate(mpvBitrateRefs.current.video + mpvBitrateRefs.current.audio);
                                } else if (evt.name === "audio-bitrate" && typeof evt.data === "number") {
                                    mpvBitrateRefs.current.audio = evt.data;
                                    setMpvBitrate(mpvBitrateRefs.current.video + mpvBitrateRefs.current.audio);
                                }
                            },
                            MPV_WINDOW_LABEL
                        );
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                    } catch (e) {
                        termLog(
                            `[LivePlayer] mpv observe failed: ${e instanceof Error ? e.message : String(e)}`,
                            "warn"
                        );
                    }

                    const headers = currentLineHeadersRef.current ?? {};
                    const referer = headers.Referer ?? headers.Referrer;
                    const userAgent = headers["User-Agent"] ?? headers["user-agent"];
                    const headerPairs = Object.entries(headers)
                        .filter(([, value]) => !!value)
                        .map(([key, value]) => `${key}: ${value}`);
                    try {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        if (headerPairs.length > 0) {
                            await setMpvProperty("http-header-fields", headerPairs.join(", "), MPV_WINDOW_LABEL);
                        }
                        if (referer) {
                            await setMpvProperty("referrer", referer, MPV_WINDOW_LABEL);
                        }
                        if (userAgent) {
                            await setMpvProperty("user-agent", userAgent, MPV_WINDOW_LABEL);
                        }
                    } catch (e) {
                        termLog(
                            `[LivePlayer] mpv header apply failed: ${e instanceof Error ? e.message : String(e)}`,
                            "warn"
                        );
                    }

                    try {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        await mpvCommand("loadfile", [url, "replace"], MPV_WINDOW_LABEL);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        noteKernelFailure(activeChannel, index, "mpv", "fatal");
                        switchKernelOrLine(`[LivePlayer] mpv load failed: ${msg}`, "warn");
                        return;
                    }

                    if (mpvVideoProbeTimerRef.current !== null) {
                        window.clearTimeout(mpvVideoProbeTimerRef.current);
                        mpvVideoProbeTimerRef.current = null;
                    }
                    mpvVideoProbeTimerRef.current = window.setTimeout(async () => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current || kernelRef.current !== "mpv") {
                            return;
                        }

                        // Probe with retry: MPV may not have decoded a frame yet (property unavailable)
                        const MAX_PROBE_RETRIES = 2;
                        for (let probeAttempt = 0; probeAttempt < MAX_PROBE_RETRIES; probeAttempt++) {
                            if (!isMountedRef.current || attemptId !== attemptTokenRef.current || kernelRef.current !== "mpv" || !mpvInitializedRef.current) {
                                return;
                            }
                            try {
                                const widthRaw = await mpvCommand("get_property", ["width"], MPV_WINDOW_LABEL);
                                const heightRaw = await mpvCommand("get_property", ["height"], MPV_WINDOW_LABEL);
                                const voConfiguredRaw = await mpvCommand("get_property", ["vo-configured"], MPV_WINDOW_LABEL);
                                const width = Number(widthRaw ?? 0);
                                const height = Number(heightRaw ?? 0);
                                const voConfigured = voConfiguredRaw === true;
                                if (width <= 0 || height <= 0 || !voConfigured) {
                                    // Not decoded yet — retry if we have attempts left
                                    if (probeAttempt < MAX_PROBE_RETRIES - 1) {
                                        termLog(`[LivePlayer] mpv video probe retry (${probeAttempt + 1}): ${width}x${height}, vo=${String(voConfiguredRaw)}`, "info");
                                        await new Promise(r => setTimeout(r, 3000));
                                        continue;
                                    }
                                    noteKernelFailure(activeChannel, index, "mpv", "fatal");
                                    switchKernelOrLine(`[LivePlayer] mpv video probe failed: ${width}x${height}, vo=${String(voConfiguredRaw)}`, "warn");
                                    return;
                                }
                                termLog(`[LivePlayer] mpv video probe ok: ${width}x${height}, vo=true`, "info");
                                return; // Success, exit probe loop
                            } catch (e) {
                                const msg = e instanceof Error ? e.message : String(e);
                                if (probeAttempt < MAX_PROBE_RETRIES - 1 && msg.includes("property unavailable")) {
                                    termLog(`[LivePlayer] mpv video probe retry (${probeAttempt + 1}): ${msg}`, "info");
                                    await new Promise(r => setTimeout(r, 3000));
                                    continue;
                                }
                                noteKernelFailure(activeChannel, index, "mpv", "fatal");
                                switchKernelOrLine(`[LivePlayer] mpv video probe error: ${msg}`, "warn");
                                return;
                            }
                        }
                    }, 5000);
                } else if (!wantsNative && Hls.isSupported()) {
                    kernelRef.current = "hls";
                    setActiveKernelDisplay(`hls-${selectedHlsKernel}`);
                    let attemptedMediaRecovery = false;
                    let repeatedFragIssueCount = 0;
                    const hlsConfig: Partial<HlsConfig> = {
                        lowLatencyMode: true,
                        maxBufferLength: HLS_MAX_BUFFER_SECONDS,
                        maxMaxBufferLength: HLS_MAX_BUFFER_CEILING_SECONDS,
                        backBufferLength: HLS_BACK_BUFFER_SECONDS,
                        manifestLoadingMaxRetry: 2,
                        levelLoadingMaxRetry: 2,
                        fragLoadingMaxRetry: 2,
                        enableWorker: true,
                        startFragPrefetch: true,
                        liveSyncDuration: HLS_LIVE_SYNC_SECONDS,
                        liveMaxLatencyDuration: HLS_LIVE_MAX_LATENCY_SECONDS,
                        maxLiveSyncPlaybackRate: 1,
                        abrBandWidthFactor: 0.6,
                        abrBandWidthUpFactor: 0.5,
                        maxFragLookUpTolerance: 0.25,
                        nudgeOffset: 0.12,
                        nudgeMaxRetry: 8,
                        highBufferWatchdogPeriod: 2,
                        xhrSetup: (xhr: XMLHttpRequest) => {
                            xhr.withCredentials = false;
                            if (!wantsProxy) {
                                const headers = currentLineHeadersRef.current ?? {};
                                Object.entries(headers).forEach(([key, value]) => {
                                    if (!value) return;
                                    xhr.setRequestHeader(key, value);
                                });
                            }
                        }
                    };

                    if (wantsProxy) {
                        hlsConfig.loader = TauriHlsLoader as unknown as typeof Hls.DefaultConfig.loader;
                    }
                    const hls = new Hls(hlsConfig as HlsConfig);

                    termLog(
                        wantsProxy
                            ? "[LivePlayer] Initializing hls.js kernel with Rust proxy mode"
                            : "[LivePlayer] Initializing hls.js kernel with direct HTTP mode",
                        "info"
                    );
                    armManifestWatchdog();
                    hls.loadSource(url);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        clearManifestWatchdog();
                        waitForStartupGate("hls.js", () => {
                            noteKernelFailure(activeChannel, index, selectedHlsKernel, "startup_timeout");
                            if (!switchToSameLineRecover("startup timeout", "warn")) {
                                switchKernelOrLine("[LivePlayer] startup timeout", "warn");
                            }
                        });
                    });
                    hls.on(Hls.Events.ERROR, async (_event, data) => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        termLog(`[LivePlayer] hls.js Error: ${data.type} - ${data.details} (fatal=${String(data.fatal)})`, "warn");
                        const lastLoaderErr = lastLoaderErrorRef.current;
                        const currentStreamKey = currentStreamKeyRef.current;
                        const loaderErrRecent = !!lastLoaderErr &&
                            Date.now() - lastLoaderErr.at < 8000 &&
                            lastLoaderErr.streamKey === currentStreamKey &&
                            lastLoaderErr.attemptToken === attemptId;
                        const loaderMsg = loaderErrRecent ? lastLoaderErr?.message ?? "" : "";
                        const hasDecodeTransportIssue =
                            loaderMsg.includes("error decoding response body") ||
                            loaderMsg.includes("decoder error") ||
                            loaderMsg.includes("invalid gzip header");
                        const hasHardHttpStatus =
                            loaderMsg.includes("404 Not Found") ||
                            loaderMsg.includes("bad status 403") ||
                            loaderMsg.includes("bad status 404") ||
                            loaderMsg.includes("bad status 410") ||
                            loaderMsg.includes("status code 403") ||
                            loaderMsg.includes("status code 404") ||
                            loaderMsg.includes("status code 410");
                        const detailForSwitch = String(data.details ?? "");
                        const isManifestLevelFailure =
                            detailForSwitch.includes("manifestLoadError") ||
                            detailForSwitch.includes("levelLoadError");
                        const isHardSourceFailure =
                            loaderErrRecent &&
                            isManifestLevelFailure &&
                            (loaderMsg.includes("Manifest request failed") || hasHardHttpStatus);
                        if (
                            isHardSourceFailure &&
                            isManifestLevelFailure
                        ) {
                            noteKernelFailure(activeChannel, index, selectedHlsKernel, "manifest");
                            const rec = getOrCreateLineHealth(activeChannel, index);
                            noteLineHardFailure(rec, Date.now());
                            refreshLineHealthBadge(activeChannel, index);
                            termLog(`[LivePlayer] hard source failure on line ${index + 1}, force switch`, "warn");
                            switchToNextLine(`[LivePlayer] hard source failure: ${detailForSwitch}`, "warn");
                            return;
                        }
                        if (!data.fatal) {
                            const detail = String(data.details ?? "");
                            if (
                                selectedHlsKernel === "proxy" &&
                                hasDecodeTransportIssue &&
                                (detail === "fragLoadError" || detail === "fragLoadTimeOut" || detail === "manifestLoadError")
                            ) {
                                noteKernelFailure(activeChannel, index, selectedHlsKernel, "transport");
                                switchKernelOrLine(
                                    "[LivePlayer] proxy transport unstable, switch to direct kernel",
                                    "warn"
                                );
                                return;
                            }
                            if (detail === "fragLoadError" || detail === "fragLoadTimeOut" || detail === "fragParsingError") {
                                repeatedFragIssueCount += 1;
                                if (repeatedFragIssueCount >= 3) {
                                    noteKernelFailure(activeChannel, index, selectedHlsKernel, "frag");
                                    switchKernelOrLine(`[LivePlayer] hls.js repeated ${detail} x${repeatedFragIssueCount}, switching`, "warn");
                                    return;
                                }
                            }
                        }
                        if (data.fatal) {
                            const fatalDetail = String(data.details ?? "");
                            if (
                                selectedHlsKernel === "direct" &&
                                (fatalDetail.includes("manifestLoadError") || fatalDetail.includes("levelLoadError")) &&
                                hlsKernelModeRef.current !== "auto"
                            ) {
                                hlsKernelModeRef.current = "auto";
                                setHlsKernelMode("auto");
                                termLog("[LivePlayer] manual direct overridden to auto after manifest fatal", "warn");
                            }
                            if (fatalDetail.includes("manifestLoadError") || fatalDetail.includes("levelLoadError")) {
                                noteKernelFailure(activeChannel, index, selectedHlsKernel, "manifest");
                            } else {
                                noteKernelFailure(activeChannel, index, selectedHlsKernel, "fatal");
                            }
                            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !attemptedMediaRecovery) {
                                attemptedMediaRecovery = true;
                                termLog("[LivePlayer] hls.js Fatal MEDIA_ERROR, trying recoverMediaError() once", "warn");
                                hls.recoverMediaError();
                                return;
                            }
                            switchKernelOrLine(`[LivePlayer] hls.js Fatal Error: ${data.type} - ${data.details}`, "error");
                        }
                    });
                    hls.on(Hls.Events.FRAG_CHANGED, () => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        repeatedFragIssueCount = 0;
                        noteKernelSuccess(activeChannel, index, selectedHlsKernel);
                        markPlaybackProgress("[LivePlayer] hls.js: Fragments advancing");
                        setLatency(Math.max(0, hls.latency));
                    });
                    hlsRef.current = hls;
                } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                    kernelRef.current = "native";
                    setActiveKernelDisplay("native-hls");
                    termLog("[LivePlayer] Kernel: Native HLS", "info");
                    video.src = url;
                    video.load();
                    waitForStartupGate("native-hls", () => {
                        noteKernelFailure(activeChannel, index, "native", "startup_timeout");
                        if (!switchToSameLineRecover("native hls startup timeout", "warn")) {
                            switchKernelOrLine("[LivePlayer] native hls startup timeout", "warn");
                        }
                    }, true);
                } else {
                    kernelRef.current = "native";
                    setActiveKernelDisplay("native-video");
                    termLog("[LivePlayer] Kernel: Native Video Fallback", "info");
                    video.src = url;
                    video.load();
                    waitForStartupGate("native-video", () => {
                        noteKernelFailure(activeChannel, index, "native", "startup_timeout");
                        if (!switchToSameLineRecover("native fallback startup timeout", "warn")) {
                            switchKernelOrLine("[LivePlayer] native fallback startup timeout", "warn");
                        }
                    }, true);
                }
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            termLog(`[LivePlayer] Runtime exception: ${msg}`, "error");
            setPlaybackState("failed");
            setErrorInfo(`播放初始化异常: ${msg}`);
        } finally {
            releasePlayInvokeLock();
        }
    }, [
        activeChannel,
        applyAdaptiveStartupTargets,
        clearManifestWatchdog,
        destroyPlayers,
        getOrCreateLineHealth,
        handleSetIsPlaying,
        noteKernelFailure,
        noteKernelSuccess,
        refreshLineHealthBadge,
        resolveAutoLineCandidates,
        resolveHlsKernelPlan,
        setActiveKernelDisplay,
        termLog,
        TauriHlsLoader,
        waitForStartupBufferAndPlay,
    ]);

    // Handle Channel Change
    useEffect(() => {
        isMountedRef.current = true;
        const forcedStartup = forcedStartupLineRef.current;
        const startupIndex =
            forcedStartup !== null &&
                forcedStartup >= 0 &&
                forcedStartup < activeChannel.urls.length
                ? forcedStartup
                : resolveStartupLineIndex(activeChannel);
        forcedStartupLineRef.current = null;
        setLineIndex(startupIndex);
        lineIndexRef.current = startupIndex;
        manualLineLockUntilRef.current = 0;
        void playLine(startupIndex, 0, 0, "initial");
        return () => {
            isMountedRef.current = false;
            attemptTokenRef.current += 1;
            destroyPlayers();
        };
    }, [activeChannel, destroyPlayers, playLine, resolveStartupLineIndex]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const video = videoRef.current;
            if (!video) return;
            const ahead = sanitizeBufferedAhead(getBufferedAheadSeconds(video));
            setBufferAheadSeconds(ahead);
            const runtimeTarget = computeRuntimeBufferTargetSec(startupTargetRef.current);
            setBufferFillPercent(Math.min(100, (ahead / runtimeTarget) * 100));

            const now = performance.now();
            const currentTime = video.currentTime;
            if (!Number.isFinite(currentTime)) return;
            const latestBufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : currentTime;
            const rawTailAhead = Number.isFinite(latestBufferedEnd) ? Math.max(0, latestBufferedEnd - currentTime) : 0;
            const isBufferAnomaly = rawTailAhead > BUFFER_ANOMALY_AHEAD_SECONDS;
            if (isBufferAnomaly && now > bufferAnomalyDebounceUntilRef.current) {
                bufferAnomalyDebounceUntilRef.current = now + BUFFER_ANOMALY_DEBOUNCE_MS;
                termLog(
                    `[LivePlayer] buffer_anomaly_detected: rawAhead=${rawTailAhead.toFixed(2)}s, current=${currentTime.toFixed(2)}`,
                    "warn"
                );
                invoke("note_live_buffer_anomaly").catch(() => void 0);
                let rebased = false;
                if (video.buffered.length > 0 && Number.isFinite(latestBufferedEnd) && latestBufferedEnd > 0) {
                    const target = Math.max(0, latestBufferedEnd - Math.min(12, startupTargetRef.current + 4));
                    if (Number.isFinite(target) && target >= 0) {
                        try {
                            video.currentTime = target;
                            startupTimelineRebaseAtRef.current = now;
                            rebased = true;
                            termLog(
                                `[LivePlayer] buffer_anomaly_detected: timeline rebase to ${target.toFixed(2)}s`,
                                "warn"
                            );
                        } catch {
                            rebased = false;
                        }
                    }
                }
                if (!rebased) {
                    termLog("[LivePlayer] buffer_anomaly_detected: rebase failed, recover same line", "warn");
                    void playLine(lineIndexRef.current, 0, 0, "recover", null);
                    return;
                }
            }

            if (currentTime > stallGuardRef.current.lastVideoTime + 0.05) {
                stallGuardRef.current.lastVideoTime = currentTime;
                stallGuardRef.current.lastAdvanceAt = now;
            }

            if (
                startupPhaseRef.current &&
                !isPlayingRef.current &&
                kernelRef.current === null &&
                now > startupIdleRecoverDebounceUntilRef.current
            ) {
                const waited = Date.now() - startupStartedAtRef.current;
                if (waited >= STARTUP_IDLE_RECOVER_MS) {
                    startupIdleRecoverDebounceUntilRef.current = now + STARTUP_IDLE_RECOVER_COOLDOWN_MS;
                    termLog(
                        `[LivePlayer] startup idle watchdog triggered after ${Math.round(waited / 1000)}s, recover same line`,
                        "warn"
                    );
                    void playLine(lineIndexRef.current, 0, 0, "recover", null);
                    return;
                }
            }

            if (
                kernelRef.current === "native" &&
                isPlayingRef.current &&
                !video.paused &&
                now - stallGuardRef.current.lastAdvanceAt > 9000 &&
                now > nativeStallDebounceUntilRef.current
            ) {
                nativeStallDebounceUntilRef.current = now + 15_000;
                noteKernelFailure(activeChannel, lineIndexRef.current, "native", "stall");
                termLog("[LivePlayer] native stall watchdog triggered, recover same line", "warn");
                void playLine(lineIndexRef.current, 0, 0, "recover");
                return;
            }

            if (REALTIME_MODE) {
                if (kernelRef.current === "hls" && hlsRef.current) {
                    hlsRef.current.startLoad(-1);
                }
                if (video.playbackRate !== 1) {
                    video.playbackRate = 1;
                }
                return;
            }

            if (
                kernelRef.current === "hls" &&
                hlsRef.current &&
                ahead < STEADY_TOPUP_TARGET_SECONDS
            ) {
                hlsRef.current.startLoad(-1);
            }

            if (
                kernelRef.current === "hls" &&
                hlsRef.current &&
                !emergencyHoldRef.current &&
                isPlayingRef.current &&
                !video.paused
            ) {
                const inEarlyWindow = playbackStartedAtRef.current > 0 && (now - playbackStartedAtRef.current) <= EARLY_REBUFFER_GRACE_MS;
                const holdThreshold = inEarlyWindow ? Math.min(SOFT_HOLD_BUFFER_SECONDS, 8) : SOFT_HOLD_BUFFER_SECONDS;
                const stalledLong = now - stallGuardRef.current.lastAdvanceAt > 1400;
                const mustHold = ahead <= HARD_GUARD_BUFFER_SECONDS || (ahead < holdThreshold && stalledLong);
                if (mustHold) {
                    emergencyHoldRef.current = true;
                    emergencyCooldownUntilRef.current = now + 12_000;
                    setPlaybackState("emergency_hold");
                    const rec = getOrCreateLineHealth(activeChannel, lineIndexRef.current);
                    noteLineStall(rec, Date.now());
                    refreshLineHealthBadge(activeChannel, lineIndexRef.current);
                    termLog(
                        `[LivePlayer] Enter emergency rebuffer, low buffer=${ahead.toFixed(2)}s threshold=${holdThreshold.toFixed(1)}s`,
                        "warn"
                    );
                    video.pause();
                    hlsRef.current.startLoad(-1);
                } else if (ahead < holdThreshold) {
                    hlsRef.current.startLoad(-1);
                    if (video.playbackRate > 0.96) {
                        video.playbackRate = 0.96;
                    }
                } else if (ahead < SOFT_HOLD_RESUME_SECONDS) {
                    if (video.playbackRate > 0.98) {
                        video.playbackRate = 0.98;
                    }
                } else if (ahead < STEADY_TOPUP_TARGET_SECONDS) {
                    if (video.playbackRate > 0.99) {
                        video.playbackRate = 0.99;
                    }
                } else if (video.playbackRate !== 1) {
                    video.playbackRate = 1;
                }
            }

            if (
                kernelRef.current === "hls" &&
                hlsRef.current &&
                emergencyHoldRef.current
            ) {
                const inEarlyWindow = playbackStartedAtRef.current > 0 && (now - playbackStartedAtRef.current) <= EARLY_REBUFFER_GRACE_MS;
                const resumeThreshold = inEarlyWindow
                    ? Math.max(EARLY_EMERGENCY_RESUME_SECONDS + 2, SOFT_HOLD_RESUME_SECONDS - 2)
                    : SOFT_HOLD_RESUME_SECONDS;
                hlsRef.current.startLoad(-1);
                if (isBufferAnomaly) {
                    termLog("[LivePlayer] buffer_anomaly_detected: skip emergency resume until timeline stabilized", "warn");
                    return;
                }
                if (ahead <= HARD_GUARD_BUFFER_SECONDS && now > emergencyCooldownUntilRef.current) {
                    emergencyCooldownUntilRef.current = now + 7_000;
                    termLog(
                        `[LivePlayer] Hard guard active, forcing rebuffer grow from ${ahead.toFixed(2)}s`,
                        "warn"
                    );
                }
                if (ahead >= resumeThreshold) {
                    emergencyHoldRef.current = false;
                    video.playbackRate = 0.98;
                    video.play().catch(() => void 0);
                    setPlaybackState("playing");
                    termLog(
                        `[LivePlayer] Emergency rebuffer recovered, resume at ${ahead.toFixed(2)}s threshold=${resumeThreshold.toFixed(1)}s`,
                        "info"
                    );
                }
                return;
            }

            if (kernelRef.current === "hls" && hlsRef.current) {
                if (
                    isPlayingRef.current &&
                    !video.paused &&
                    ahead <= HARD_GUARD_BUFFER_SECONDS &&
                    now - stallGuardRef.current.lastAdvanceAt > 3200
                ) {
                    emergencyHoldRef.current = true;
                    emergencyCooldownUntilRef.current = now + 10_000;
                    termLog(`[LivePlayer] Guard preemptive hold at ${ahead.toFixed(2)}s`, "warn");
                    video.pause();
                    hlsRef.current.startLoad(-1);
                    return;
                }
            }

            if (
                !emergencyHoldRef.current &&
                (kernelRef.current !== "hls" || ahead >= STEADY_TOPUP_TARGET_SECONDS) &&
                video.playbackRate !== 1
            ) {
                video.playbackRate = 1;
            }
        }, 600);

        return () => window.clearInterval(timer);
    }, [
        activeChannel,
        getBufferedAheadSeconds,
        getOrCreateLineHealth,
        noteKernelFailure,
        playLine,
        refreshLineHealthBadge,
        sanitizeBufferedAhead,
        termLog,
    ]);

    useEffect(() => {
        let stopped = false;
        const poll = async () => {
            try {
                const metrics = await invoke<LiveProxyMetrics>("get_live_proxy_metrics");
                if (!stopped) {
                    proxyMetricsRef.current = metrics;
                    setProxyMetrics(metrics);
                    if (startupPhaseRef.current) {
                        applyAdaptiveStartupTargets(activeChannel, lineIndexRef.current, true);
                    }
                }
            } catch {
                // ignore command failures
            }
        };
        void poll();
        const timer = window.setInterval(() => {
            void poll();
        }, 1000);
        return () => {
            stopped = true;
            window.clearInterval(timer);
        };
    }, [activeChannel, applyAdaptiveStartupTargets]);

    const handleKernelModeChange = (mode: HlsKernelMode) => {
        hlsKernelModeRef.current = mode;
        setHlsKernelMode(mode);
        setErrorInfo(null);
        void playLine(lineIndexRef.current, 0, 0, "manual");
    };

    const handleNativeError = () => {
        if (!isMountedRef.current) return;
        if (kernelRef.current !== "native") {
            termLog(`[LivePlayer] Ignore native error outside native kernel: ${kernelRef.current ?? "none"}`, "warn");
            return;
        }
        const now = Date.now();
        if (now < nativeErrorDebounceUntilRef.current) return;
        nativeErrorDebounceUntilRef.current = now + 6000;
        termLog("[LivePlayer] Native video element emitted error event", "warn");
        noteKernelFailure(activeChannel, lineIndexRef.current, "native", "fatal");
        if (hlsKernelModeRef.current !== "auto") {
            hlsKernelModeRef.current = "auto";
            setHlsKernelMode("auto");
            termLog("[LivePlayer] manual kernel overridden to auto after native fatal", "warn");
        }
        switchInProgressRef.current = true;
        void playLine(lineIndexRef.current, 0, 0, "recover", null);
    };

    const handleVideoPlay = () => {
        startupPhaseRef.current = false;
        playbackStartedAtRef.current = performance.now();
        handleSetIsPlaying(true);
    };

    const handleVideoPause = () => {
        handleSetIsPlaying(false);
    };

    const handleVideoWaiting = () => {
        if (isMpvActive) return;
        const video = videoRef.current;
        if (!video) return;
        if (REALTIME_MODE) {
            if (kernelRef.current === "hls" && hlsRef.current) {
                hlsRef.current.startLoad(-1);
            }
            video.play().catch(() => void 0);
            return;
        }
        const ahead = sanitizeBufferedAhead(getBufferedAheadSeconds(video));
        const now = performance.now();
        const latestBufferedEnd = video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : video.currentTime;
        const rawTailAhead = Number.isFinite(latestBufferedEnd) && Number.isFinite(video.currentTime)
            ? Math.max(0, latestBufferedEnd - video.currentTime)
            : 0;
        if (rawTailAhead > BUFFER_ANOMALY_AHEAD_SECONDS) {
            termLog(`[LivePlayer] buffer_anomaly_detected: waiting rawAhead=${rawTailAhead.toFixed(2)}s`, "warn");
            invoke("note_live_buffer_anomaly").catch(() => void 0);
            return;
        }
        const inEarlyWindow = playbackStartedAtRef.current > 0 && (now - playbackStartedAtRef.current) <= EARLY_REBUFFER_GRACE_MS;
        const holdThreshold = inEarlyWindow ? Math.min(SOFT_HOLD_BUFFER_SECONDS, 8) : SOFT_HOLD_BUFFER_SECONDS;
        if (kernelRef.current === "hls" && hlsRef.current) {
            hlsRef.current.startLoad(-1);
        }
        const stalledLong = now - stallGuardRef.current.lastAdvanceAt > 1400;
        if (kernelRef.current === "hls" && (ahead <= HARD_GUARD_BUFFER_SECONDS || (ahead < holdThreshold && stalledLong))) {
            emergencyHoldRef.current = true;
            emergencyCooldownUntilRef.current = now + 10_000;
            setPlaybackState("emergency_hold");
            const rec = getOrCreateLineHealth(activeChannel, lineIndexRef.current);
            noteLineStall(rec, Date.now());
            refreshLineHealthBadge(activeChannel, lineIndexRef.current);
            termLog(
                `[LivePlayer] waiting detected, enter hold with buffer=${ahead.toFixed(2)}s threshold=${holdThreshold.toFixed(1)}s`,
                "warn"
            );
            video.pause();
            return;
        }
        if (kernelRef.current === "hls" && hlsRef.current && ahead < holdThreshold && !stalledLong) {
            if (video.playbackRate > 0.96) {
                video.playbackRate = 0.96;
            }
        }
        video.play().catch(() => void 0);
    };

    const kernelBadgeClass = useMemo(() => {
        if (activeKernelName.startsWith("hls")) return "bg-emerald-500/80";
        if (activeKernelName === "mpegts" || activeKernelName === "dash") return "bg-sky-500/80";
        if (activeKernelName.startsWith("native")) return "bg-amber-500/80";
        return "bg-zinc-500/80";
    }, [activeKernelName]);
    const kernelDisplayName = useMemo(() => {
        const mapping: Record<string, string> = {
            idle: "空闲",
            dash: "DASH",
            mpegts: "MPEGTS",
            "hls-proxy": "HLS 代理",
            "hls-direct": "HLS 直连",
            "hls-native": "HLS 原生",
            "native-hls": "原生 HLS",
            "native-video": "原生视频",
            mpv: "MPV 内核",
            auto: "自动",
        };
        return mapping[activeKernelName] ?? activeKernelName;
    }, [activeKernelName]);

    const playbackStateName = useMemo(() => {
        const mapping: Record<string, string> = {
            playing: "正在播放",
            startup_buffering: "正在启动",
            emergency_hold: "缓冲中",
            stalled: "卡顿",
        };
        return mapping[playbackState] ?? playbackState;
    }, [playbackState]);

    const backendRateKbps = proxyMetrics ? (proxyMetrics.bytes_per_second / 1024) : 0;

