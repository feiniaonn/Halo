export function LivePlayer({
    groups,
    initialGroup,
    initialChannel,
    initialLineIndex,
    initialKernelMode,
    onClose,
    onMpvActiveChange
}: {
    groups: LiveGroup[];
    initialGroup: string;
    initialChannel: LiveChannel;
    initialLineIndex?: number;
    initialKernelMode?: HlsKernelMode;
    onClose?: () => void;
    onMpvActiveChange?: (active: boolean) => void;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const videoAreaRef = useRef<HTMLDivElement>(null);

    // Player references
    const hlsRef = useRef<Hls | null>(null);
    const mpegtsRef = useRef<mpegts.Player | null>(null);
    const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);

    // State
    const [activeGroup, setActiveGroup] = useState<string>(initialGroup);
    const [activeChannel, setActiveChannel] = useState<LiveChannel>(initialChannel);
    const [lineIndex, setLineIndex] = useState(() => Math.max(0, initialLineIndex ?? 0));
    const lineIndexRef = useRef(Math.max(0, initialLineIndex ?? 0));

    const termLog = useCallback((msg: string, level: "info" | "warn" | "error" = "info") => {
        console[level](msg);
        invoke("rust_log", { message: msg, level }).catch(() => void 0);
    }, []);

    const [isPlaying, setIsPlaying] = useState(false);
    const isPlayingRef = useRef(false);
    const handleSetIsPlaying = useCallback((val: boolean) => {
        setIsPlaying(val);
        isPlayingRef.current = val;
    }, []);

    const [errorInfo, setErrorInfo] = useState<string | null>(null);
    const [latency, setLatency] = useState<number | null>(null);
    const isMountedRef = useRef(true);
    const attemptTokenRef = useRef(0);
    const switchInProgressRef = useRef(false);
    const startupPhaseRef = useRef(false);
    const failoverTimerRef = useRef<number | null>(null);
    const manifestWatchdogTimerRef = useRef<number | null>(null);
    const startupStartedAtRef = useRef(0);
    const kernelRef = useRef<"dash" | "mpegts" | "hls" | "native" | "mpv" | null>(null);
    const activeKernelNameRef = useRef<string>("auto");
    const [activeKernelName, setActiveKernelName] = useState<string>("auto");
    const nativeErrorDebounceUntilRef = useRef(0);
    const currentLineHeadersRef = useRef<Record<string, string> | null>(null);
    const currentStreamKeyRef = useRef<string | null>(null);
    const previousStreamKeyRef = useRef<string | null>(null);
    const manualLineLockUntilRef = useRef(0);
    const switchRateLimiterRef = useRef<SwitchRateLimiterState>(createSwitchRateLimiterState());
    const [hlsKernelMode, setHlsKernelMode] = useState<HlsKernelMode>(initialKernelMode ?? "mpv");
    const hlsKernelModeRef = useRef<HlsKernelMode>(initialKernelMode ?? "mpv");
    const [bufferAheadSeconds, setBufferAheadSeconds] = useState(0);
    const [bufferFillPercent, setBufferFillPercent] = useState(0);
    const startupTargetRef = useRef(10);
    const lastStartupTargetLogAtRef = useRef(0);
    const [playbackState, setPlaybackState] = useState<PlaybackState>("startup_buffering");
    const playbackStateRef = useRef<PlaybackState>("startup_buffering");
    const stallGuardRef = useRef({ lastVideoTime: 0, lastAdvanceAt: 0 });
    const playbackStartedAtRef = useRef(0);
    const emergencyHoldRef = useRef(false);
    const emergencyCooldownUntilRef = useRef(0);
    const waitForBufferTimerRef = useRef<number | null>(null);
    const [proxyMetrics, setProxyMetrics] = useState<LiveProxyMetrics | null>(null);
    const proxyMetricsRef = useRef<LiveProxyMetrics | null>(null);
    const nativeStallDebounceUntilRef = useRef(0);
    const startupIdleRecoverDebounceUntilRef = useRef(0);
    const startupTimelineRebaseAtRef = useRef(0);
    const lastPlayRequestRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
    const playInvokeLockRef = useRef(false);
    const pendingPlayRequestRef = useRef<PendingPlayRequest | null>(null);
    const relaySeqModeLogRef = useRef(false);
    const mpvUnlistenRef = useRef<(() => void) | null>(null);
    const mpvVideoProbeTimerRef = useRef<number | null>(null);
    const mpvInitializedRef = useRef(false);
    const [isMpvActive, setIsMpvActive] = useState(false);
    const [mpvBitrate, setMpvBitrate] = useState(0);
    const mpvBitrateRefs = useRef({ video: 0, audio: 0 });
    const bufferAnomalyDebounceUntilRef = useRef(0);
    const forcedStartupLineRef = useRef<number | null>(
        typeof initialLineIndex === "number" && Number.isFinite(initialLineIndex)
            ? Math.max(0, initialLineIndex)
            : null
    );
    const lastLoaderErrorRef = useRef<{
        message: string;
        at: number;
        streamKey: string | null;
        attemptToken: number;
    } | null>(null);


    useEffect(() => {
        playbackStateRef.current = playbackState;
    }, [playbackState]);

    useEffect(() => {
        onMpvActiveChange?.(isMpvActive);
        return () => {
            onMpvActiveChange?.(false);
        };
    }, [isMpvActive, onMpvActiveChange]);

    // Custom HLS Loader to bypass CORS and inject headers via Rust
    const TauriHlsLoader = useMemo(() => {
        const BaseLoader = Hls.DefaultConfig.loader as unknown as {
            new(config: unknown): {
                load: (context: unknown, config: unknown, callbacks: unknown) => void;
            };
        };

        return class extends BaseLoader {
            constructor(config: unknown) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = async (context: unknown, config: unknown, callbacks: unknown) => {
                    const ctx = context as {
                        url: string;
                        type?: string;
                        responseType?: string;
                        rangeStart?: number;
                        rangeEnd?: number;
                        frag?: unknown;
                        keyInfo?: unknown;
                    };
                    const makeStats = (loaded = 0) => {
                        const now = performance.now();
                        return {
                            aborted: false,
                            loaded,
                            total: loaded,
                            retry: 0,
                            chunkCount: 0,
                            bwEstimate: 0,
                            loading: { start: now, first: now, end: now },
                            parsing: { start: now, end: now },
                            buffering: { start: now, end: now, first: now },
                        };
                    };
                    const cbs = callbacks as {
                        onSuccess: (
                            response: { url: string; data: ArrayBuffer | string },
                            stats: {
                                aborted: boolean;
                                loaded: number;
                                total: number;
                                retry: number;
                                chunkCount: number;
                                bwEstimate: number;
                                loading: { start: number; first: number; end: number };
                                parsing: { start: number; end: number };
                                buffering: { start: number; first: number; end: number };
                            },
                            context: unknown,
                            networkDetails?: unknown
                        ) => void;
                        onError: (
                            error: { code: number; text: string },
                            context: unknown,
                            networkDetails?: unknown,
                            stats?: unknown
                        ) => void;
                    };
                    const url = ctx.url;
                    const shouldProxyManifest =
                        ctx.type === 'manifest' ||
                        ctx.type === 'level' ||
                        ctx.type === 'audioTrack' ||
                        ctx.type === 'subtitleTrack';
                    const shouldProxyBinary =
                        ctx.responseType === 'arraybuffer' ||
                        typeof ctx.frag !== 'undefined' ||
                        typeof ctx.keyInfo !== 'undefined';

                    if (shouldProxyManifest || shouldProxyBinary) {
                        try {
                            if (shouldProxyManifest) {
                                const rewrittenManifest = await invoke<string>("proxy_hls_manifest", {
                                    url,
                                    headers: currentLineHeadersRef.current,
                                    streamKey: currentStreamKeyRef.current
                                });
                                cbs.onSuccess({ url, data: rewrittenManifest }, makeStats(rewrittenManifest.length), context, null);
                                return;
                            }

                            if (shouldProxyBinary) {
                                if (url.startsWith("halo-relay://segment/") && !relaySeqModeLogRef.current) {
                                    relaySeqModeLogRef.current = true;
                                    termLog("[LivePlayer] relay_seq_only_mode", "info");
                                }
                                const headers: Record<string, string> = { ...(currentLineHeadersRef.current ?? {}) };

                                const b64 = await invoke<string>("proxy_hls_segment", {
                                    url,
                                    headers: Object.keys(headers).length > 0 ? headers : null,
                                    streamKey: currentStreamKeyRef.current
                                });
                                const binary = atob(b64);
                                const bytes = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i += 1) {
                                    bytes[i] = binary.charCodeAt(i);
                                }
                                const response = {
                                    url: url,
                                    data: bytes.buffer,
                                };
                                cbs.onSuccess(response, makeStats(bytes.length), context, null);
                                return;
                            }
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            lastLoaderErrorRef.current = {
                                message,
                                at: Date.now(),
                                streamKey: currentStreamKeyRef.current,
                                attemptToken: attemptTokenRef.current,
                            };
                            const reqType = ctx.type ?? (shouldProxyBinary ? 'binary' : 'unknown');
                            termLog(`[LivePlayer] TauriHlsLoader proxy failed (${reqType}): ${url}, reason=${message}`, "warn");
                            cbs.onError({ code: 0, text: message }, context, null, makeStats(0));
                            return;
                        }
                    }
                    originalLoad(context, config, callbacks);
                };
            }
        };
    }, [termLog]);

    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const dragRegionStyle = useMemo(
        () => ({ WebkitAppRegion: "drag" } as CSSProperties),
        []
    );
    const noDragRegionStyle = useMemo(
        () => ({ WebkitAppRegion: "no-drag" } as CSSProperties),
        []
    );

    // Derived Data
    const currentGroupChannels = useMemo(() => {
        return groups.find(g => g.groupName === activeGroup)?.channels || [];
    }, [groups, activeGroup]);

    const getLineKey = useCallback((channel: LiveChannel, index: number): string => {
        const url = channel.urls[index] ?? "";
        const headers = channel.lines?.[index]?.headers;
        return `${channel.name}::${lineIdentity(url, headers)}`;
    }, []);

    const getOrCreateKernelHealth = useCallback((channel: LiveChannel, index: number): LineKernelHealthRecord => {
        const key = getLineKey(channel, index);
        let rec = LINE_KERNEL_HEALTH_REGISTRY.get(key);
        if (!rec) {
            rec = createLineKernelHealthRecord();
            LINE_KERNEL_HEALTH_REGISTRY.set(key, rec);
        }
        return rec;
    }, [getLineKey]);

    const noteKernelSuccess = useCallback((channel: LiveChannel, index: number, kernel: HlsKernel) => {
        const rec = getOrCreateKernelHealth(channel, index);
        rec[kernel].failures = Math.max(0, rec[kernel].failures - 1);
        rec[kernel].blockedUntil = 0;
    }, [getOrCreateKernelHealth]);

    const noteKernelFailure = useCallback((
        channel: LiveChannel,
        index: number,
        kernel: HlsKernel,
        reason: KernelFailureReason
    ) => {
        const now = Date.now();
        const rec = getOrCreateKernelHealth(channel, index);
        const cell = rec[kernel];
        cell.failures += 1;
        cell.lastFailureAt = now;
        let blockMs = 0;
        if (kernel === "direct" && reason === "manifest") {
            // Direct mode manifest failures are usually CORS/anti-hotlink; avoid retry storm.
            blockMs = 8 * 60_000;
        } else if (kernel === "proxy" && reason === "transport") {
            blockMs = 90_000;
        } else if (kernel === "mpv" && reason === "startup_timeout") {
            blockMs = 2 * 60_000;
        } else if (kernel === "native" && reason === "stall") {
            blockMs = 3 * 60_000;
        } else if (cell.failures >= 3) {
            blockMs = 120_000;
        } else if (cell.failures >= 2) {
            blockMs = 45_000;
        }
        if (blockMs > 0) {
            cell.blockedUntil = Math.max(cell.blockedUntil, now + blockMs);
            termLog(
                `[LivePlayer] kernel_penalty: line=${index + 1} kernel=${kernel} reason=${reason} ttl=${Math.ceil((cell.blockedUntil - now) / 1000)}s`,
                "warn"
            );
        }
    }, [getOrCreateKernelHealth, termLog]);

    const hasSensitiveHeaders = useCallback((headers: Record<string, string> | null | undefined): boolean => {
        if (!headers) return false;
        const keys = Object.keys(headers).map((k) => k.toLowerCase());
        return keys.some((k) =>
            k === "referer" ||
            k === "referrer" ||
            k === "origin" ||
            k === "cookie" ||
            k === "authorization" ||
            k === "x-auth-token" ||
            k === "x-token"
        );
    }, []);

    const getOrCreateLineHealth = useCallback((channel: LiveChannel, index: number): LineHealthRecord => {
        const key = getLineKey(channel, index);
        let rec = LINE_HEALTH_REGISTRY.get(key);
        if (!rec) {
            rec = createLineHealthRecord();
            LINE_HEALTH_REGISTRY.set(key, rec);
        }
        return rec;
    }, [getLineKey]);

    const refreshLineHealthBadge = useCallback((channel: LiveChannel, index: number) => {
        void getOrCreateLineHealth(channel, index);
    }, [getOrCreateLineHealth]);

    const resolveAutoLineCandidates = useCallback((channel: LiveChannel, currentIndex: number): number[] => {
        const now = Date.now();
        const allIndices = channel.urls.map((_, i) => i);
        const notCurrent = allIndices.filter((i) => i !== currentIndex);
        const scored = notCurrent.map((idx) => {
            const rec = getOrCreateLineHealth(channel, idx);
            const quarantined = ENABLE_LINE_CIRCUIT_BREAKER && isLineQuarantined(rec, now);
            return {
                idx,
                rec,
                quarantined,
                score: getLineHealthScore(rec),
            };
        });
        const available = scored
            .filter((item) => !item.quarantined)
            .sort((a, b) => b.score - a.score || a.idx - b.idx)
            .map((item) => item.idx);
        if (available.length > 0) {
            return available;
        }
        const probed = scored
            .filter((item) => canHalfOpenProbe(item.rec, now))
            .sort((a, b) => b.score - a.score || a.idx - b.idx);
        if (probed.length > 0) {
            const selected = probed[0];
            markHalfOpenProbe(selected.rec, now);
            termLog(`[LivePlayer] line_half_open_probe: line=${selected.idx + 1}`, "warn");
            return [selected.idx];
        }
        return [];
    }, [getOrCreateLineHealth, termLog]);

    const resolveStartupLineIndex = useCallback((channel: LiveChannel): number => {
        if (!channel.urls.length) return 0;
        const now = Date.now();
        const scored = channel.urls.map((_, idx) => {
            const rec = getOrCreateLineHealth(channel, idx);
            return {
                idx,
                rec,
                quarantined: ENABLE_LINE_CIRCUIT_BREAKER && isLineQuarantined(rec, now),
                score: getLineHealthScore(rec),
            };
        });
        const preferred = scored
            .filter((item) => !item.quarantined)
            .sort((a, b) => b.score - a.score || a.idx - b.idx);
        if (preferred.length > 0) {
            return preferred[0].idx;
        }
        const probe = scored
            .filter((item) => canHalfOpenProbe(item.rec, now))
            .sort((a, b) => b.score - a.score || a.idx - b.idx);
        if (probe.length > 0) {
            markHalfOpenProbe(probe[0].rec, now);
            termLog(`[LivePlayer] line_half_open_probe: startup line=${probe[0].idx + 1}`, "warn");
            return probe[0].idx;
        }
        return 0;
    }, [getOrCreateLineHealth, termLog]);

    const computeAdaptiveStartupTarget = useCallback((channel: LiveChannel, index: number): number => {
        const rec = getOrCreateLineHealth(channel, index);
        const score = getLineHealthScore(rec);
        return computeStartupTargetSec(proxyMetricsRef.current, score);
    }, [getOrCreateLineHealth]);

    const sanitizeBufferedAhead = useCallback((ahead: number): number => {
        if (!Number.isFinite(ahead) || ahead < 0) return 0;
        return clamp(0, MAX_LIVE_BUFFER_AHEAD_SECONDS, ahead);
    }, []);

    const applyAdaptiveStartupTargets = useCallback((
        channel: LiveChannel,
        index: number,
        allowLog = true
    ) => {
        const targetSec = computeAdaptiveStartupTarget(channel, index);
        const prevTarget = startupTargetRef.current;
        const targetDelta = clamp(-STARTUP_TARGET_STEP_SECONDS, STARTUP_TARGET_STEP_SECONDS, targetSec - prevTarget);
        const nextTarget = clamp(STARTUP_TARGET_MIN_SECONDS, STARTUP_TARGET_MAX_SECONDS, prevTarget + targetDelta);
        startupTargetRef.current = nextTarget;
        if (allowLog && Date.now() - lastStartupTargetLogAtRef.current > 2500) {
            lastStartupTargetLogAtRef.current = Date.now();
            termLog(
                `[LivePlayer] startup_target_update: target=${nextTarget}s timeout=${STARTUP_TIMEOUT_SECONDS}s line=${index + 1}`,
                "info"
            );
        }
        return { targetSec: nextTarget, timeoutSec: STARTUP_TIMEOUT_SECONDS };
    }, [computeAdaptiveStartupTarget, termLog]);

    const getBufferedAheadSeconds = useCallback((video: HTMLVideoElement): number => {
        const t = video.currentTime;
        if (!Number.isFinite(t)) return 0;
        const ranges = video.buffered;
        let nearestFutureEnd = 0;
        let nearestFutureStart = Number.POSITIVE_INFINITY;
        for (let i = 0; i < ranges.length; i += 1) {
            const start = ranges.start(i);
            const end = ranges.end(i);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
            if (t >= start - 0.1 && t <= end + 0.1) {
                return sanitizeBufferedAhead(Math.max(0, end - t));
            }
            if (start > t && start < nearestFutureStart) {
                nearestFutureStart = start;
                nearestFutureEnd = end;
            }
        }
        if (Number.isFinite(nearestFutureStart)) {
            const gap = nearestFutureStart - t;
            if (gap <= BUFFER_GAP_TOLERANCE_SECONDS) {
                return sanitizeBufferedAhead(Math.max(0, nearestFutureEnd - nearestFutureStart));
            }
        }
        return 0;
    }, [sanitizeBufferedAhead]);

    const setActiveKernelDisplay = useCallback((name: string) => {
        activeKernelNameRef.current = name;
        setActiveKernelName(name);
    }, []);

    const resolveHlsKernelPlan = useCallback((channel: LiveChannel, index: number): HlsKernel[] => {
        const mode = hlsKernelModeRef.current;
        if (mode !== "auto") return [mode];

        const headers = channel.lines?.[index]?.headers;
        const sensitiveHeaders = hasSensitiveHeaders(headers);
        const decodeErrors = proxyMetricsRef.current?.transport_decode_error_count ?? 0;
        const retryCount = proxyMetricsRef.current?.segment_retry_count ?? 0;

        let plan: HlsKernel[] = sensitiveHeaders ? ["proxy", "native", "direct", "mpv"] : [...HLS_AUTO_PLAN];
        if (!sensitiveHeaders && decodeErrors >= 4 && retryCount >= 8) {
            plan = ["native", "proxy", "direct", "mpv"];
        }

        const now = Date.now();
        const health = getOrCreateKernelHealth(channel, index);
        const available = plan.filter((k) => health[k].blockedUntil <= now);
        const blocked = plan.filter((k) => health[k].blockedUntil > now);
        if (available.length === 0) {
            return [...blocked].sort((a, b) => health[a].blockedUntil - health[b].blockedUntil);
        }
        return [...available, ...blocked];
    }, [getOrCreateKernelHealth, hasSensitiveHeaders]);

    const clearStartupWaitTimer = useCallback(() => {
        if (waitForBufferTimerRef.current !== null) {
            window.clearInterval(waitForBufferTimerRef.current);
            waitForBufferTimerRef.current = null;
        }
    }, []);

    const clearManifestWatchdog = useCallback(() => {
        if (manifestWatchdogTimerRef.current !== null) {
            window.clearTimeout(manifestWatchdogTimerRef.current);
            manifestWatchdogTimerRef.current = null;
        }
    }, []);

    const waitForStartupBufferAndPlay = useCallback((
        index: number,
        attemptToken: number,
        onTimeout: () => void
    ) => {
        startupStartedAtRef.current = Date.now();
        startupPhaseRef.current = false;
        startupIdleRecoverDebounceUntilRef.current = 0;
        clearStartupWaitTimer();
        if (!isMountedRef.current || attemptTokenRef.current !== attemptToken) return;
        const video = videoRef.current;
        if (!video) return;
        if (kernelRef.current === "hls" && hlsRef.current) {
            hlsRef.current.startLoad(-1);
        }
        video.play().then(() => {
            setPlaybackState("playing");
            termLog(`[LivePlayer] Startup play (realtime): line=${index + 1}`, "info");
        }).catch((e) => {
            termLog(`[LivePlayer] Startup play blocked: ${e.message}`, "warn");
            onTimeout();
        });
    }, [clearStartupWaitTimer, termLog]);

    // Controls Auto-Hide
    const controlsTimeout = useRef<number | null>(null);
    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeout.current) window.clearTimeout(controlsTimeout.current);
        controlsTimeout.current = window.setTimeout(() => {
            setShowControls(false);
        }, 3500);
    };

    const handleFullscreen = async () => {
        if (isTauri()) {
            const win = getCurrentWindow();
            const nextFullscreen = !(await win.isFullscreen().catch(() => false));
            await win.setFullscreen(nextFullscreen).catch(() => void 0);
            setIsFullscreen(nextFullscreen);
            if (nextFullscreen) {
                setIsSidebarOpen(false);
            } else {
                setIsSidebarOpen(true);
            }
            return;
        }

        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            await containerRef.current.requestFullscreen().catch(() => void 0);
            setIsFullscreen(true);
            setIsSidebarOpen(false);
        } else {
            await document.exitFullscreen().catch(() => void 0);
            setIsFullscreen(false);
            setIsSidebarOpen(true);
        }
    };

    useEffect(() => {
        if (!isTauri()) {
            const handleFsChange = () => {
                const isFs = !!document.fullscreenElement;
                setIsFullscreen(isFs);
                if (!isFs) setIsSidebarOpen(true);
            };
            document.addEventListener("fullscreenchange", handleFsChange);
            return () => document.removeEventListener("fullscreenchange", handleFsChange);
        }

        const win = getCurrentWindow();
        let resizeTimer: number | null = null;
        let unlistenResize: (() => void) | undefined;
        let removed = false;

        const syncFullscreenState = async () => {
            const full = await win.isFullscreen().catch(() => false);
            if (removed) return;
            setIsFullscreen(full);
            if (!full) {
                setIsSidebarOpen(true);
            }
        };

        void syncFullscreenState();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            window.setTimeout(() => {
                void syncFullscreenState();
            }, 0);
        };
        window.addEventListener("keydown", onKeyDown);

        void win.onResized(() => {
            if (resizeTimer !== null) {
                window.clearTimeout(resizeTimer);
            }
            resizeTimer = window.setTimeout(() => {
                void syncFullscreenState();
            }, 120);
        }).then((off) => {
            unlistenResize = off;
        }).catch(() => {
            void 0;
        });

        return () => {
            removed = true;
            if (resizeTimer !== null) {
                window.clearTimeout(resizeTimer);
            }
            unlistenResize?.();
            window.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    const destroyPlayers = useCallback(() => {
        const streamToRelease = currentStreamKeyRef.current ?? previousStreamKeyRef.current;
        if (failoverTimerRef.current !== null) {
            window.clearTimeout(failoverTimerRef.current);
            failoverTimerRef.current = null;
        }
        clearManifestWatchdog();
        clearStartupWaitTimer();
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }
        if (mpegtsRef.current) {
            mpegtsRef.current.destroy();
            mpegtsRef.current = null;
        }
        if (dashRef.current) {
            dashRef.current.destroy();
            dashRef.current = null;
        }
        if (mpvUnlistenRef.current) {
            try {
                mpvUnlistenRef.current();
            } catch {
                // ignore event unlisten errors
            }
            mpvUnlistenRef.current = null;
        }
        if (mpvVideoProbeTimerRef.current !== null) {
            window.clearTimeout(mpvVideoProbeTimerRef.current);
            mpvVideoProbeTimerRef.current = null;
        }
        // Mark as not initialized BEFORE destroying — prevents cleanup effects from
        // calling property writes after the Rust instance is removed.
        mpvInitializedRef.current = false;
        if (isTauri()) {
            void destroyMpv(MPV_WINDOW_LABEL).catch(() => void 0);
        }
        setIsMpvActive(false);
        kernelRef.current = null;
        currentLineHeadersRef.current = null;
        previousStreamKeyRef.current = currentStreamKeyRef.current;
        currentStreamKeyRef.current = null;
        emergencyHoldRef.current = false;
        emergencyCooldownUntilRef.current = 0;
        startupPhaseRef.current = false;
        playbackStartedAtRef.current = 0;
        startupIdleRecoverDebounceUntilRef.current = 0;
        startupTimelineRebaseAtRef.current = 0;
        switchInProgressRef.current = false;
        playInvokeLockRef.current = false;
        pendingPlayRequestRef.current = null;
        relaySeqModeLogRef.current = false;
        lastPlayRequestRef.current = { key: "", at: 0 };
        const video = videoRef.current;
        if (video) {
            try {
                video.pause();
                video.removeAttribute("src");
                video.load();
            } catch {
                // ignore media reset failures during teardown
            }
            video.playbackRate = 1;
        }
        if (streamToRelease) {
            invoke("release_live_stream", { streamKey: streamToRelease }).catch(() => void 0);
        }
        setActiveKernelDisplay("idle");
        setLatency(null);
    }, [clearManifestWatchdog, clearStartupWaitTimer]);

    const playLine = useCallback(async (
        index: number,
        hlsKernelAttempt = 0,
        recoverAttempt = 0,
        trigger: PlayTrigger = "auto",
        kernelPlanOverride: HlsKernel[] | null = null
    ) => {
        if (!isMountedRef.current) return;
        if (trigger === "auto" && switchInProgressRef.current) return;
        const nowReq = Date.now();
        const reqKey = `${activeChannel.name}|${index}|${hlsKernelAttempt}|${recoverAttempt}|${trigger}|${kernelPlanOverride?.join("->") ?? "auto"}|${hlsKernelModeRef.current}`;
        const shouldDedup = true;
        if (shouldDedup && lastPlayRequestRef.current.key === reqKey && nowReq - lastPlayRequestRef.current.at < 900) {
            return;
        }
        const queuedRequest: PendingPlayRequest = {
            index,
            hlsKernelAttempt,
            recoverAttempt,
            trigger,
            kernelPlanOverride,
        };
        const transitionState = playbackStateRef.current;
        const inTransition =
            transitionState === "startup_buffering" ||
            transitionState === "recovering_same_line" ||
            transitionState === "switching_line";
        if (playInvokeLockRef.current || (inTransition && trigger !== "manual" && trigger !== "initial")) {
            pendingPlayRequestRef.current = queuedRequest;
            termLog(
                `[LivePlayer] singleflight_drop: queued trigger=${trigger} line=${index + 1} state=${transitionState}`,
                "warn"
            );
            return;
        }
        playInvokeLockRef.current = true;
        const releasePlayInvokeLock = () => {
            if (!playInvokeLockRef.current) return;
            playInvokeLockRef.current = false;
            const pending = pendingPlayRequestRef.current;
            if (!pending) return;
            pendingPlayRequestRef.current = null;
            if (!isMountedRef.current) return;
            termLog(
                `[LivePlayer] singleflight_drop: flush queued trigger=${pending.trigger} line=${pending.index + 1}`,
                "info"
            );
            void playLine(
                pending.index,
                pending.hlsKernelAttempt,
                pending.recoverAttempt,
                pending.trigger,
                pending.kernelPlanOverride
            );
        };
        try {
            lastPlayRequestRef.current = { key: reqKey, at: nowReq };
            const attemptId = ++attemptTokenRef.current;
            switchInProgressRef.current = false;
            lastLoaderErrorRef.current = null;
            destroyPlayers();
            setErrorInfo(null);
            handleSetIsPlaying(false);

            if (index >= activeChannel.urls.length || index < 0) {
                termLog(`[LivePlayer] All lines failed for channel: ${activeChannel.name}`, "error");
                setPlaybackState("failed");
                setErrorInfo("所有线路和内核都已尝试，仍无法播放。可能是源失效或受地区限制。");
                return;
            }

            setLineIndex(index);
            lineIndexRef.current = index;
            const url = activeChannel.urls[index];
            currentLineHeadersRef.current = activeChannel.lines?.[index]?.headers ?? null;
            currentStreamKeyRef.current = `${activeChannel.name}::${lineIdentity(url, currentLineHeadersRef.current)}`;
            invoke("reset_live_proxy_metrics", { streamKey: currentStreamKeyRef.current }).catch(() => void 0);
            relaySeqModeLogRef.current = false;
            stallGuardRef.current = { lastVideoTime: 0, lastAdvanceAt: performance.now() };
            emergencyHoldRef.current = false;
            emergencyCooldownUntilRef.current = 0;
            startupPhaseRef.current = true;
            setPlaybackState("startup_buffering");
            startupStartedAtRef.current = Date.now();
            applyAdaptiveStartupTargets(activeChannel, index, false);
            refreshLineHealthBadge(activeChannel, index);
            if (hlsKernelAttempt === 0 && recoverAttempt === 0) {
                setBufferAheadSeconds(0);
                setBufferFillPercent(0);
            }
            const video = videoRef.current;
            if (!video) {
                termLog("[LivePlayer] Video element ref is null, cannot play", "error");
                return;
            }

            const lowerUrl = url.toLowerCase();
            const isDash = lowerUrl.includes(".mpd");
            const isMpegts = lowerUrl.includes(".flv") || (lowerUrl.includes(".ts") && !lowerUrl.includes(".m3u8"));
            const isHlsLine = !isDash && !isMpegts;
            const hlsKernelPlan = kernelPlanOverride && kernelPlanOverride.length > 0
                ? [...kernelPlanOverride]
                : resolveHlsKernelPlan(activeChannel, index);
            const selectedHlsKernel = hlsKernelPlan[Math.min(hlsKernelAttempt, hlsKernelPlan.length - 1)];
            const canTryNextHlsKernel = isHlsLine && hlsKernelAttempt + 1 < hlsKernelPlan.length;
            if (isHlsLine) {
                termLog(
                    `[LivePlayer] kernel_plan: line=${index + 1} plan=${hlsKernelPlan.join("->")} selected=${selectedHlsKernel}`,
                    "info"
                );
            }

            termLog(
                `[LivePlayer] Attempting Line ${index + 1}/${activeChannel.urls.length}: ${url} (kernel=${isHlsLine ? selectedHlsKernel : isDash ? "dash" : "mpegts"}, recover=${recoverAttempt})`,
                "info"
            );
            kernelRef.current = null;

            let switched = false;
            let hasPlaybackProgress = false;
            const switchToSameLineRecover = (reason: string, level: "warn" | "error" = "warn") => {
                if (switched) return false;
                if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return true;
                if (recoverAttempt >= 1) return false;
                const rec = getOrCreateLineHealth(activeChannel, index);
                noteLineRecoveryFailure(rec, Date.now());
                refreshLineHealthBadge(activeChannel, index);
                termLog(`[LivePlayer] same_line_recover_attempt: ${reason} | line=${index + 1}`, level);
                setPlaybackState("recovering_same_line");
                switchInProgressRef.current = true;
                switched = true;
                void playLine(index, hlsKernelAttempt, recoverAttempt + 1, "recover", hlsKernelPlan);
                return true;
            };
            const switchToNextLine = (reason: string, level: "warn" | "error" = "warn") => {
                if (switched) return;
                switched = true;
                if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                if (failoverTimerRef.current !== null) {
                    window.clearTimeout(failoverTimerRef.current);
                    failoverTimerRef.current = null;
                }
                const now = Date.now();
                if (manualLineLockUntilRef.current > now) {
                    termLog(
                        `[LivePlayer] line switch blocked by manual lock ${Math.ceil((manualLineLockUntilRef.current - now) / 1000)}s`,
                        "warn"
                    );
                    if (switchToSameLineRecover("manual line lock", "warn")) return;
                    return;
                }
                if (ENABLE_SWITCH_RATE_LIMIT) {
                    const allowed = registerAutoSwitch(
                        switchRateLimiterRef.current,
                        now,
                        AUTO_SWITCH_WINDOW_MS,
                        AUTO_SWITCH_LIMIT,
                        AUTO_SWITCH_COOLDOWN_MS
                    );
                    if (!allowed) {
                        termLog("[LivePlayer] line_switch_rate_limited", "warn");
                        if (switchToSameLineRecover("switch rate limited", "warn")) return;
                        return;
                    }
                }
                const currentRec = getOrCreateLineHealth(activeChannel, index);
                noteLineAutoSwitchFailure(currentRec, now);
                refreshLineHealthBadge(activeChannel, index);
                if (ENABLE_LINE_CIRCUIT_BREAKER && currentRec.quarantineUntil > now) {
                    termLog(
                        `[LivePlayer] line_quarantined: line=${index + 1} ttl=${Math.ceil((currentRec.quarantineUntil - now) / 1000)}s`,
                        "warn"
                    );
                }
                const candidates = resolveAutoLineCandidates(activeChannel, index);
                const nextIndex = candidates[0];
                if (typeof nextIndex !== "number") {
                    if (switchToSameLineRecover("no candidate line available", "warn")) return;
                    setPlaybackState("failed");
                    setErrorInfo("当前频道线路都处于隔离或失败状态，请稍后重试或手动切线。");
                    return;
                }
                setPlaybackState("switching_line");
                termLog(reason, level);
                void playLine(nextIndex, 0, 0, "auto", null);
            };
            const switchKernelOrLine = (reason: string, level: "warn" | "error" = "warn") => {
                if (switched) return;
                if (canTryNextHlsKernel) {
                    switched = true;
                    if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                    if (failoverTimerRef.current !== null) {
                        window.clearTimeout(failoverTimerRef.current);
                        failoverTimerRef.current = null;
                    }
                    const nextKernel = hlsKernelPlan[hlsKernelAttempt + 1];
                    termLog(`[LivePlayer] same_line_recover_attempt: ${reason} | switch HLS kernel ${selectedHlsKernel} -> ${nextKernel}`, level);
                    setPlaybackState("recovering_same_line");
                    switchInProgressRef.current = true;
                    void playLine(index, hlsKernelAttempt + 1, recoverAttempt, "kernel", hlsKernelPlan);
                    return;
                }
                if (switchToSameLineRecover(reason, level)) return;
                switchToNextLine(reason, level);
            };
            const armManifestWatchdog = () => {
                clearManifestWatchdog();
                if (!isHlsLine || selectedHlsKernel === "native") return;
                manifestWatchdogTimerRef.current = window.setTimeout(() => {
                    if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                    if (hasPlaybackProgress) return;
                    if (!startupPhaseRef.current) return;
                    noteKernelFailure(activeChannel, index, selectedHlsKernel, "startup_timeout");
                    termLog(
                        `[LivePlayer] manifest watchdog timeout ${MANIFEST_WATCHDOG_MS}ms (kernel=${selectedHlsKernel})`,
                        "warn"
                    );
                    switchKernelOrLine("[LivePlayer] manifest watchdog timeout", "warn");
                }, MANIFEST_WATCHDOG_MS);
            };
            const markPlaybackProgress = (message: string) => {
                if (hasPlaybackProgress) return;
                hasPlaybackProgress = true;
                if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                if (isHlsLine) {
                    noteKernelSuccess(activeChannel, index, selectedHlsKernel);
                }
                playbackStartedAtRef.current = performance.now();
                startupPhaseRef.current = false;
                setPlaybackState("playing");
                if (failoverTimerRef.current !== null) {
                    window.clearTimeout(failoverTimerRef.current);
                    failoverTimerRef.current = null;
                }
                const ttff = Date.now() - startupStartedAtRef.current;
                const rec = getOrCreateLineHealth(activeChannel, index);
                noteLineStartupSuccess(rec, ttff, Date.now());
                refreshLineHealthBadge(activeChannel, index);
                termLog(`${message} | ttff=${ttff}ms score=${getLineHealthScore(rec)}`, "info");
            };
            const waitForStartupGate = (
                tag: string,
                onTimeout: () => void,
                attachPlayingMarker = false
            ) => {
                termLog(`[LivePlayer] ${tag}: realtime start`, "info");
                let playingHandler: (() => void) | null = null;
                if (attachPlayingMarker) {
                    playingHandler = () => {
                        if (!isMountedRef.current || attemptId !== attemptTokenRef.current) return;
                        markPlaybackProgress(`[LivePlayer] ${tag}: Playback started`);
                    };
