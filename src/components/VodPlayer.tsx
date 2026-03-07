import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import Hls, { type HlsConfig } from "hls.js";
import flvjs from "flv.js";
import { cn } from "@/lib/utils";
import { VodProxyImage } from "@/components/VodProxyImage";
import {
    command as mpvCommand,
    destroy as destroyMpv,
    init as initMpv,
    listenEvents as listenMpvEvents,
    observeProperties as observeMpvProperties,
    setProperty as setMpvProperty,
} from "tauri-plugin-mpv-api";
import type { MpvConfig } from "tauri-plugin-mpv-api";
import {
    buildVodKernelPlan,
    type VodKernelDisplay,
    VOD_KERNEL_LABELS,
    VOD_KERNEL_MAX_ATTEMPTS,
} from "@/modules/media/services/vodKernelStateMachine";
import {
    isMpvIpcHardError,
    MPV_IMAGE_PROBE_FAIL_THRESHOLD,
    shouldFailForImageProbe,
    shouldIgnoreMpvProbeError,
} from "@/modules/media/services/vodMpvProbePolicy";
import {
    closeVodRelaySession,
    openVodRelaySession,
} from "@/modules/media/services/vodMpvRelayClient";
import {
    formatPlaybackTime,
    normalizeVodKernelMode,
    resolveEpisodePlayback,
    withTimeout,
} from "@/modules/media/services/vodPlayback";
import {
    probeVodStream,
    type VodStreamKind,
    type VodStreamProbeResult,
} from "@/modules/media/services/vodStreamProbe";
import { shouldUseProxyForUrl } from "@/modules/media/services/tvboxNetworkPolicy";

import type {
    TvBoxHostMapping,
    TvBoxParse,
    TvBoxPlaybackRule,
    TvBoxRequestHeaderRule,
    VodKernelMode,
    VodRoute,
    VodEpisode,
    VodDetail,
    VodSourceKind,
} from "@/modules/media/types/vodWindow.types";

const MPV_WINDOW_LABEL = "vod_player";
const MPV_IPC_TIMEOUT_MS = 3200;
const MPV_STEP_TIMEOUT_MS = 6000;
const MPV_INIT_RETRY_DELAY_MS = 450;
const MPV_STARTUP_PROBE_WINDOW_MS = 12000;
const MPV_STARTUP_PROBE_INTERVAL_MS = 900;
const HLS_STARTUP_TIMEOUT_MS = 9000;
const DIRECT_STARTUP_TIMEOUT_MS = 7000;
const MPV_DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";

interface KernelAttemptResult {
    ok: boolean;
    reason?: string;
    retryable: boolean;
}

function inferReasonCode(reason: string): string {
    const lower = reason.toLowerCase();
    if (lower.includes("403")) return "relay_manifest_403";
    if (lower.includes("404")) return "relay_manifest_404";
    if (lower.includes("not m3u8")) return "relay_manifest_not_m3u8";
    if (lower.includes("skip mpv")) return "mpv_skip_m3u8_initial";
    if (lower.includes("ipc")) return "mpv_ipc_error";
    if (lower.includes("probe timeout")) return "probe_timeout_no_progress";
    if (lower.includes("image") || lower.includes("png_pipe")) return "probe_transient_image";
    if (lower.includes("hls")) return "hls_error";
    if (lower.includes("flv")) return "flv_error";
    if (lower.includes("direct")) return "direct_error";
    return "unknown";
}

const KERNEL_MODE_OPTIONS: Array<{ value: VodKernelMode; label: string }> = [
    { value: "mpv", label: "MPV 内核" },
    { value: "direct", label: "HLS直连" },
    { value: "proxy", label: "HLS代理" },
    { value: "native", label: "原生HLS" },
];

export interface VodPlayerProps {
    sourceKind: VodSourceKind;
    spiderUrl: string;
    siteName?: string;
    siteKey: string;
    apiClass: string;
    ext: string;
    playUrl?: string;
    click?: string;
    playerType?: string;
    detail: VodDetail | null;
    routes: VodRoute[];
    initialRouteIdx: number;
    initialEpisodeIdx: number;
    initialKernelMode: VodKernelMode;
    parses?: TvBoxParse[];
    requestHeaders?: TvBoxRequestHeaderRule[];
    playbackRules?: TvBoxPlaybackRule[];
    proxyDomains?: string[];
    hostMappings?: TvBoxHostMapping[];
    adHosts?: string[];
    onClose?: () => void;
    onMpvActiveChange?: (active: boolean) => void;
}

export function VodPlayer({
    sourceKind,
    spiderUrl,
    siteName,
    siteKey,
    apiClass,
    ext,
    playUrl,
    click,
    playerType,
    detail,
    routes,
    initialRouteIdx,
    initialEpisodeIdx,
    initialKernelMode,
    parses,
    requestHeaders,
    playbackRules,
    proxyDomains,
    hostMappings,
    adHosts,
    onClose,
    onMpvActiveChange,
}: VodPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const flvRef = useRef<flvjs.Player | null>(null);
    const mpvUnlistenRef = useRef<(() => void) | null>(null);
    const attemptTokenRef = useRef(0);

    const normalizedInitialKernelMode = normalizeVodKernelMode(initialKernelMode as unknown);

    const [activeRouteIdx, setActiveRouteIdx] = useState(initialRouteIdx);
    const [activeEpisodeIdx, setActiveEpisodeIdx] = useState(initialEpisodeIdx);
    const [kernelMode, setKernelMode] = useState<VodKernelMode>(normalizedInitialKernelMode);
    const kernelModeRef = useRef<VodKernelMode>(normalizedInitialKernelMode);
    const [activeKernel, setActiveKernel] = useState<VodKernelDisplay>("mpv");

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
    const [isMpvActive, setIsMpvActive] = useState(false);
    const [playbackPosition, setPlaybackPosition] = useState(0);
    const [playbackDuration, setPlaybackDuration] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const noticeTimeoutRef = useRef<number | null>(null);
    const playRequestIdRef = useRef(0);
    const activeHeadersRef = useRef<Record<string, string> | null>(null);
    const lastMpvUiSyncAtRef = useRef(0);
    const mpvDestroyPromiseRef = useRef<Promise<void> | null>(null);
    const mpvRelaySessionIdRef = useRef<string | null>(null);
    const streamProbeCacheRef = useRef(new Map<string, Promise<VodStreamProbeResult>>());

    const dragRegionStyle = useMemo(() => ({ WebkitAppRegion: "drag" } as CSSProperties), []);
    const noDragRegionStyle = useMemo(() => ({ WebkitAppRegion: "no-drag" } as CSSProperties), []);

    const activeRoute = routes[activeRouteIdx] ?? null;
    const activeEpisode: VodEpisode | null = activeRoute?.episodes[activeEpisodeIdx] ?? null;

    const termLog = useCallback((msg: string, level: "info" | "warn" | "error" = "info") => {
        console[level](msg);
        invoke("rust_log", { message: msg, level }).catch(() => void 0);
    }, []);
    const appendMpvTestLog = useCallback((message: string) => {
        invoke("append_mpv_test_log", { message }).catch(() => void 0);
    }, []);

    const closeActiveRelaySession = useCallback((reason: string) => {
        const sessionId = mpvRelaySessionIdRef.current;
        if (!sessionId) return;
        mpvRelaySessionIdRef.current = null;
        termLog(`[VodPlayer] relay session close session_id=${sessionId} reason=${reason}`, "info");
        appendMpvTestLog(
            `[vod][mpv] relay session close session_id=${sessionId} reason=${reason} next_action=continue`,
        );
        void closeVodRelaySession(sessionId).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            termLog(`[VodPlayer] relay session close failed session_id=${sessionId} err=${msg}`, "warn");
        });
    }, [appendMpvTestLog, termLog]);

    const showPlaybackNotice = useCallback((text: string) => {
        setPlaybackNotice(text);
        if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = window.setTimeout(() => setPlaybackNotice(null), 3200);
    }, []);

    const TauriHlsLoader = useMemo(() => {
        return class extends (Hls.DefaultConfig.loader as unknown as new (c: unknown) => { load: (ctx: unknown, cfg: unknown, cbs: unknown) => void }) {
            constructor(config: unknown) {
                super(config);
                const originalLoad = this.load.bind(this);
                this.load = async (context: unknown, config: unknown, callbacks: unknown) => {
                    const ctx = context as { url: string; type?: string; responseType?: string; frag?: unknown; keyInfo?: unknown };
                    const cbs = callbacks as {
                        onSuccess: (r: { url: string; data: ArrayBuffer | string }, stats: unknown, ctx: unknown, nd?: unknown) => void;
                        onError: (err: { code: number; text: string }, ctx: unknown, nd?: unknown, stats?: unknown) => void;
                    };
                    const now = performance.now();
                    const makeStats = (loaded = 0) => ({ aborted: false, loaded, total: loaded, retry: 0, chunkCount: 0, bwEstimate: 0, loading: { start: now, first: now, end: now }, parsing: { start: now, end: now }, buffering: { start: now, first: now, end: now } });
                    const url = ctx.url;
                    const isManifest = ctx.type === "manifest" || ctx.type === "level" || ctx.type === "audioTrack" || ctx.type === "subtitleTrack";
                    const isBinary = ctx.responseType === "arraybuffer" || ctx.frag !== undefined || ctx.keyInfo !== undefined;
                    if (isManifest || isBinary) {
                        try {
                            if (isManifest) {
                                const text = await invoke<string>("proxy_hls_manifest", {
                                    url,
                                    headers: activeHeadersRef.current,
                                    playbackRules,
                                    blockedHosts: adHosts,
                                });
                                cbs.onSuccess({ url, data: text }, makeStats(text.length), context, null);
                                return;
                            }
                            if (isBinary) {
                                const headers = { ...(activeHeadersRef.current ?? {}) };
                                const b64 = await invoke<string>("proxy_hls_segment", {
                                    url,
                                    headers: Object.keys(headers).length > 0 ? headers : null,
                                    playbackRules,
                                    blockedHosts: adHosts,
                                });
                                const binary = atob(b64);
                                const bytes = new Uint8Array(binary.length);
                                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                                cbs.onSuccess({ url, data: bytes.buffer }, makeStats(bytes.length), context, null);
                                return;
                            }
                        } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            cbs.onError({ code: 0, text: msg }, context, null, makeStats(0));
                            return;
                        }
                    }
                    originalLoad(context, config, callbacks);
                };
            }
        };
    }, [adHosts, playbackRules]);

    const queueDestroyMpv = useCallback((): Promise<void> => {
        if (mpvDestroyPromiseRef.current) return mpvDestroyPromiseRef.current;
        const pending = destroyMpv(MPV_WINDOW_LABEL)
            .catch(() => void 0)
            .finally(() => {
                if (mpvDestroyPromiseRef.current === pending) {
                    mpvDestroyPromiseRef.current = null;
                }
            });
        mpvDestroyPromiseRef.current = pending;
        return pending;
    }, []);

    const destroyPlayer = useCallback(() => {
        attemptTokenRef.current += 1;
        closeActiveRelaySession("destroy-player");
        hlsRef.current?.destroy();
        hlsRef.current = null;
        flvRef.current?.destroy();
        flvRef.current = null;
        if (mpvUnlistenRef.current) {
            try { mpvUnlistenRef.current(); } catch { void 0; }
            mpvUnlistenRef.current = null;
        }
        void queueDestroyMpv();
        lastMpvUiSyncAtRef.current = 0;
        setIsMpvActive(false);
        setPlaybackPosition(0);
        setPlaybackDuration(0);
    }, [closeActiveRelaySession, queueDestroyMpv]);

    useEffect(() => {
        onMpvActiveChange?.(isMpvActive);
        return () => onMpvActiveChange?.(false);
    }, [isMpvActive, onMpvActiveChange]);

    useEffect(() => {
        return () => {
            if (noticeTimeoutRef.current) {
                window.clearTimeout(noticeTimeoutRef.current);
                noticeTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const syncPosition = () => {
            if (isMpvActive) return;
            setPlaybackPosition(Number.isFinite(video.currentTime) ? video.currentTime : 0);
        };
        const syncDuration = () => {
            if (isMpvActive) return;
            const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
            setPlaybackDuration(duration);
        };

        video.addEventListener("timeupdate", syncPosition);
        video.addEventListener("loadedmetadata", syncDuration);
        video.addEventListener("durationchange", syncDuration);
        return () => {
            video.removeEventListener("timeupdate", syncPosition);
            video.removeEventListener("loadedmetadata", syncDuration);
            video.removeEventListener("durationchange", syncDuration);
        };
    }, [isMpvActive]);


    const sleep = useCallback((ms: number) => new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    }), []);

    const waitForVideoStartup = useCallback((attemptId: number, timeoutMs: number): Promise<void> => {
        const video = videoRef.current;
        if (!video) {
            return Promise.reject(new Error("video element unavailable"));
        }

        return new Promise<void>((resolve, reject) => {
            let settled = false;
            let timer: number | null = null;

            const cleanup = () => {
                if (timer !== null) {
                    window.clearTimeout(timer);
                    timer = null;
                }
                video.removeEventListener("loadedmetadata", onReady);
                video.removeEventListener("canplay", onReady);
                video.removeEventListener("playing", onReady);
                video.removeEventListener("timeupdate", onReady);
                video.removeEventListener("error", onError);
            };

            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error);
                else resolve();
            };

            const onReady = () => {
                if (attemptId !== attemptTokenRef.current) {
                    finish(new Error("attempt superseded"));
                    return;
                }
                finish();
            };

            const onError = () => {
                finish(new Error("video element error"));
            };

            timer = window.setTimeout(() => {
                finish(new Error(`startup timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            video.addEventListener("loadedmetadata", onReady);
            video.addEventListener("canplay", onReady);
            video.addEventListener("playing", onReady);
            video.addEventListener("timeupdate", onReady);
            video.addEventListener("error", onError);
        });
    }, []);

    const fetchEpisodePlayback = useCallback(async (episode: VodEpisode, routeName: string) => {
        return resolveEpisodePlayback({
            sourceKind,
            spiderUrl,
            siteName,
            siteKey,
            apiClass,
            ext,
            playUrl,
            click,
            playerType,
            parses,
            playbackRules,
            requestHeaders,
            hostMappings,
        }, episode, routeName);
    }, [apiClass, click, ext, hostMappings, parses, playbackRules, playUrl, playerType, requestHeaders, siteKey, siteName, sourceKind, spiderUrl]);

    const probeResolvedStream = useCallback(async (
        url: string,
        headers: Record<string, string> | null,
    ): Promise<VodStreamProbeResult> => {
        const cacheKey = JSON.stringify([url, headers ?? {}]);
        const existing = streamProbeCacheRef.current.get(cacheKey);
        if (existing) {
            return existing;
        }

        const pending = probeVodStream(url, headers)
            .catch((error) => {
                streamProbeCacheRef.current.delete(cacheKey);
                throw error;
            });
        streamProbeCacheRef.current.set(cacheKey, pending);
        return pending;
    }, []);

    const attemptPlayUrl = useCallback(async (
        url: string,
        headers: Record<string, string> | null,
        forcedKernel: VodKernelDisplay,
        sourceHint: string,
        streamKindHint: VodStreamKind,
    ): Promise<KernelAttemptResult> => {
        closeActiveRelaySession("before-play-attempt");
        destroyPlayer();
        await queueDestroyMpv();

        const attemptId = attemptTokenRef.current;
        activeHeadersRef.current = headers;

        const video = videoRef.current;
        if (!video) {
            return { ok: false, retryable: false, reason: "视频组件未就绪" };
        }

        const lowerUrl = url.toLowerCase();
        const isM3u8 = streamKindHint === "hls" || lowerUrl.includes(".m3u8");
        const isFlv = streamKindHint === "flv" || lowerUrl.includes(".flv");

        if ((forcedKernel === "hls-proxy" || forcedKernel === "hls-native") && !isM3u8) {
            return { ok: false, retryable: false, reason: "当前链接不是 m3u8，跳过该内核" };
        }

        const targetKernel: VodKernelDisplay = forcedKernel === "hls-direct"
            ? (isFlv ? "flv" : isM3u8 ? "hls-direct" : "direct")
            : forcedKernel;

        if (targetKernel === "mpv") {
            termLog(`[VodPlayer] init start kernel=mpv url=${url}`, "info");
            if (isM3u8) {
                appendMpvTestLog(`[vod][m3u8][mpv] init start url=${url}`);
            }
            let mpvLoadUrl = url;
            try {
                if (isM3u8) {
                    const relay = await openVodRelaySession(url, headers, sourceHint);
                    mpvRelaySessionIdRef.current = relay.sessionId;
                    mpvLoadUrl = relay.localManifestUrl;
                    appendMpvTestLog(
                        `[vod][m3u8][mpv] relay open session_id=${relay.sessionId} local_manifest=${relay.localManifestUrl} upstream=${url}`,
                    );
                    termLog(
                        `[VodPlayer] relay session opened session_id=${relay.sessionId} local_manifest=${relay.localManifestUrl}`,
                        "info",
                    );
                }

                const builtinMpvPath = await invoke<string>("get_builtin_mpv_path");
                const mpvConfig: MpvConfig = {
                    path: builtinMpvPath,
                    ipcTimeoutMs: MPV_IPC_TIMEOUT_MS,
                    observedProperties: ["eof-reached", "time-pos", "pause", "duration"],
                    args: [
                        "--profile=low-latency",
                        "--cache=yes",
                        "--cache-secs=20",
                        "--demuxer-max-bytes=64MiB",
                        "--demuxer-max-back-bytes=32MiB",
                        "--hwdec=auto-safe",
                        "--ytdl=no",
                        "--hls-bitrate=max",
                        "--demuxer-lavf-o=allowed_extensions=ALL",
                        "--keep-open=yes",
                        "--force-window=yes",
                        "--background=color",
                        "--background-color=#00000000",
                    ],
                };

                let usedLabel: string;
                try {
                    usedLabel = await withTimeout(initMpv(mpvConfig, MPV_WINDOW_LABEL), MPV_STEP_TIMEOUT_MS, "mpv init");
                } catch (e) {
                    const firstMsg = e instanceof Error ? e.message : String(e);
                    termLog(`[VodPlayer] mpv init failed(attempt1): ${firstMsg}, retry once`, "warn");
                    if (isM3u8) {
                        appendMpvTestLog(`[vod][m3u8][mpv] init attempt1 failed: ${firstMsg}`);
                    }
                    await sleep(MPV_INIT_RETRY_DELAY_MS);
                    usedLabel = await withTimeout(initMpv(mpvConfig, MPV_WINDOW_LABEL), MPV_STEP_TIMEOUT_MS, "mpv init retry");
                }

                if (usedLabel !== MPV_WINDOW_LABEL) {
                    throw new Error(`mpv initialized on unexpected window label: ${usedLabel}`);
                }
                if (attemptId !== attemptTokenRef.current) {
                    return { ok: false, retryable: false, reason: "播放请求已更新" };
                }

                setIsMpvActive(true);
                setActiveKernel("mpv");
                setPlaybackPosition(0);
                setPlaybackDuration(0);
                lastMpvUiSyncAtRef.current = 0;

                let imageStreamDetected = false;
                let imageProbeHits = 0;
                let hasVideoProgress = false;
                let firstAudioOnlyAtMs = 0;
                let mpvEofReached = false;
                const probeStartedAtMs = Date.now();
                mpvUnlistenRef.current = await withTimeout(
                    observeMpvProperties(
                        ["eof-reached", "time-pos", "pause", "duration", "video-codec"],
                        (evt) => {
                            if (attemptId !== attemptTokenRef.current) return;
                            if (evt.name === "eof-reached" && evt.data === true) {
                                termLog("[VodPlayer] MPV reached EOF", "info");
                                mpvEofReached = true;
                                return;
                            }
                            if (evt.name === "time-pos" && typeof evt.data === "number" && evt.data >= 0) {
                                if (evt.data > 0.05) {
                                    hasVideoProgress = true;
                                }
                                const now = performance.now();
                                if (now - lastMpvUiSyncAtRef.current >= 220) {
                                    lastMpvUiSyncAtRef.current = now;
                                    setPlaybackPosition(evt.data);
                                }
                                return;
                            }
                            if (evt.name === "duration" && typeof evt.data === "number" && evt.data > 0) {
                                setPlaybackDuration(evt.data);
                                return;
                            }
                            if (
                                evt.name === "video-codec" &&
                                typeof evt.data === "string" &&
                                /png|mjpeg|jpeg|webp|bmp|gif|image/i.test(evt.data)
                            ) {
                                imageStreamDetected = true;
                            }
                        },
                        MPV_WINDOW_LABEL,
                    ),
                    MPV_STEP_TIMEOUT_MS,
                    "mpv observe",
                );

                const h = headers ?? {};
                const headerKeys = new Set(Object.keys(h).map((k) => k.toLowerCase()));
                const referer = h.Referer ?? h.Referrer ?? h.referer ?? h.referrer;
                const userAgent = h["User-Agent"] ?? h["user-agent"];
                const resolvedUserAgent = userAgent ?? MPV_DEFAULT_USER_AGENT;
                const headerPairs = Object.entries(h)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => `${k}: ${v}`);
                if (!headerKeys.has("accept")) {
                    headerPairs.push("Accept: */*");
                }
                if (!headerKeys.has("accept-language")) {
                    headerPairs.push("Accept-Language: zh-CN,zh;q=0.9,en;q=0.8");
                }
                if (!headerKeys.has("cache-control")) {
                    headerPairs.push("Cache-Control: no-cache");
                }
                if (!headerKeys.has("pragma")) {
                    headerPairs.push("Pragma: no-cache");
                }
                if (!headerKeys.has("user-agent")) {
                    headerPairs.push(`User-Agent: ${resolvedUserAgent}`);
                }

                try {
                    if (headerPairs.length > 0) {
                        await withTimeout(
                            setMpvProperty("http-header-fields", headerPairs, MPV_WINDOW_LABEL),
                            MPV_STEP_TIMEOUT_MS,
                            "mpv set headers",
                        );
                    }
                    if (referer) {
                        await withTimeout(setMpvProperty("referrer", referer, MPV_WINDOW_LABEL), MPV_STEP_TIMEOUT_MS, "mpv set referrer");
                    }
                    await withTimeout(setMpvProperty("user-agent", resolvedUserAgent, MPV_WINDOW_LABEL), MPV_STEP_TIMEOUT_MS, "mpv set user-agent");
                } catch (e) {
                    const headerMsg = e instanceof Error ? e.message : String(e);
                    termLog(`[VodPlayer] mpv header apply failed: ${headerMsg}`, "warn");
                    if (isM3u8) {
                        appendMpvTestLog(`[vod][m3u8][mpv] header apply failed: ${headerMsg}`);
                    }
                }

                // Listen for end-file error events to fail fast
                let mpvLoadError: string | null = null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const unlistenEndFile = await listenMpvEvents((evt: any) => {
                    if (evt.event === "end-file" && (evt.reason === "error" || evt.reason === "unknown")) {
                        mpvLoadError = `end-file: reason=${evt.reason} error=${evt.file_error ?? "unknown"}`;
                        termLog(`[VodPlayer] mpv load error event: ${mpvLoadError}`, "warn");
                        if (isM3u8) {
                            appendMpvTestLog(`[vod][m3u8][mpv] load error event: ${mpvLoadError}`);
                        }
                    }
                }, MPV_WINDOW_LABEL);

                await withTimeout(
                    mpvCommand("loadfile", [mpvLoadUrl, "replace"], MPV_WINDOW_LABEL),
                    MPV_STEP_TIMEOUT_MS,
                    "mpv loadfile",
                );
                termLog("[VodPlayer] loadfile dispatched kernel=mpv", "info");

                const probeDeadline = Date.now() + MPV_STARTUP_PROBE_WINDOW_MS;
                while (Date.now() < probeDeadline) {
                    if (attemptId !== attemptTokenRef.current) {
                        unlistenEndFile();
                        return { ok: false, retryable: false, reason: "播放请求已更新" };
                    }
                    // Check for MPV load error reported via end-file event
                    if (mpvLoadError) {
                        unlistenEndFile();
                        setIsMpvActive(false);
                        if (isM3u8) {
                            appendMpvTestLog(`[vod][m3u8][mpv] fail: ${mpvLoadError}`);
                        }
                        return { ok: false, retryable: true, reason: `MPV 加载失败: ${mpvLoadError}` };
                    }
                    if (mpvEofReached && !hasVideoProgress) {
                        unlistenEndFile();
                        setIsMpvActive(false);
                        if (isM3u8) {
                            appendMpvTestLog("[vod][m3u8][mpv] reason_code=end_file_before_video fail=eof reached before video output");
                        }
                        return { ok: false, retryable: true, reason: "MPV 提前到达 EOF，未建立视频输出" };
                    }
                    if (imageStreamDetected) {
                        imageStreamDetected = false;
                        imageProbeHits += 1;
                        const nowMs = Date.now();
                        const shouldFail = shouldFailForImageProbe(
                            imageProbeHits,
                            probeStartedAtMs,
                            nowMs,
                            hasVideoProgress,
                        );
                        termLog(
                            `[VodPlayer] startup probe image-hit kernel=mpv hits=${imageProbeHits}/${MPV_IMAGE_PROBE_FAIL_THRESHOLD} should_fail=${shouldFail}`,
                            shouldFail ? "warn" : "info",
                        );
                        if (isM3u8 && !shouldFail) {
                            appendMpvTestLog(
                                `[vod][m3u8][mpv] reason_code=probe_transient_image hits=${imageProbeHits}/${MPV_IMAGE_PROBE_FAIL_THRESHOLD} next_action=wait`,
                            );
                        }
                        if (shouldFail) {
                            unlistenEndFile();
                            setIsMpvActive(false);
                            if (isM3u8) {
                                appendMpvTestLog(
                                    "[vod][m3u8][mpv] reason_code=probe_timeout_no_progress fail=image stream persisted without progress",
                                );
                            }
                            return { ok: false, retryable: true, reason: "MPV 解码为图片流，未得到有效视频" };
                        }
                        await sleep(MPV_STARTUP_PROBE_INTERVAL_MS);
                        continue;
                    }

                    try {
                        const [timePosRaw, widthRaw, heightRaw, voConfiguredRaw, codecRaw, formatRaw, idleRaw, filenameRaw] = await Promise.all([
                            withTimeout(mpvCommand("get_property", ["time-pos"], MPV_WINDOW_LABEL), 2200, "mpv probe time-pos"),
                            withTimeout(mpvCommand("get_property", ["width"], MPV_WINDOW_LABEL), 2200, "mpv probe width"),
                            withTimeout(mpvCommand("get_property", ["height"], MPV_WINDOW_LABEL), 2200, "mpv probe height"),
                            withTimeout(mpvCommand("get_property", ["vo-configured"], MPV_WINDOW_LABEL), 2200, "mpv probe vo-configured"),
                            withTimeout(mpvCommand("get_property", ["video-codec"], MPV_WINDOW_LABEL), 2200, "mpv probe codec"),
                            withTimeout(mpvCommand("get_property", ["file-format"], MPV_WINDOW_LABEL), 2200, "mpv probe format"),
                            withTimeout(mpvCommand("get_property", ["idle-active"], MPV_WINDOW_LABEL), 2200, "mpv probe idle").catch(() => undefined),
                            withTimeout(mpvCommand("get_property", ["filename"], MPV_WINDOW_LABEL), 2200, "mpv probe filename").catch(() => undefined),
                        ]);

                        const timePos = Number(timePosRaw ?? 0);
                        const width = Number(widthRaw ?? 0);
                        const height = Number(heightRaw ?? 0);
                        if (Number.isFinite(timePos) && timePos > 0.05) {
                            hasVideoProgress = true;
                        }
                        const voConfigured = voConfiguredRaw === true || voConfiguredRaw === "yes" || voConfiguredRaw === "true" || voConfiguredRaw === 1;
                        const codec = String(codecRaw ?? "").toLowerCase();
                        const fileFormat = String(formatRaw ?? "").toLowerCase();

                        if (/png|mjpeg|jpeg|webp|bmp|gif|image/i.test(codec) || /png|image|jpeg|webp|bmp|gif/i.test(fileFormat)) {
                            imageProbeHits += 1;
                            const nowMs = Date.now();
                            const shouldFail = shouldFailForImageProbe(
                                imageProbeHits,
                                probeStartedAtMs,
                                nowMs,
                                hasVideoProgress,
                            );
                            termLog(
                                `[VodPlayer] startup probe image-codec kernel=mpv codec=${codec || "unknown"} format=${fileFormat || "unknown"} hits=${imageProbeHits}/${MPV_IMAGE_PROBE_FAIL_THRESHOLD} should_fail=${shouldFail}`,
                                shouldFail ? "warn" : "info",
                            );
                            if (isM3u8 && !shouldFail) {
                                appendMpvTestLog(
                                    `[vod][m3u8][mpv] reason_code=probe_transient_image codec=${codec || "unknown"} format=${fileFormat || "unknown"} next_action=wait`,
                                );
                            }
                            if (shouldFail) {
                                unlistenEndFile();
                                setIsMpvActive(false);
                                if (isM3u8) {
                                    appendMpvTestLog(
                                        `[vod][m3u8][mpv] reason_code=probe_timeout_no_progress fail=image codec codec=${codec || "unknown"} format=${fileFormat || "unknown"}`,
                                    );
                                }
                                return {
                                    ok: false,
                                    retryable: true,
                                    reason: `MPV 视频流异常: codec=${codec || "unknown"}, format=${fileFormat || "unknown"}`,
                                };
                            }
                            await sleep(MPV_STARTUP_PROBE_INTERVAL_MS);
                            continue;
                        }

                        const isIdle = idleRaw === true || idleRaw === "yes" || idleRaw === "true" || idleRaw === 1;
                        const loadedFilename = filenameRaw != null ? String(filenameRaw) : "";

                        // If MPV is idle after loadfile, the file was rejected/failed
                        if (isIdle && loadedFilename === "") {
                            termLog(`[VodPlayer] startup probe idle-detected kernel=mpv idle=${isIdle} filename=(empty)`, "warn");
                        }

                        const hasVideoOutput = voConfigured && width >= 16 && height >= 16;
                        const hasTimeProgress = Number.isFinite(timePos) && timePos > 0.12;

                        if (hasVideoOutput) {
                            unlistenEndFile();
                            termLog(
                                `[VodPlayer] startup probe pass kernel=mpv time=${Number.isFinite(timePos) ? timePos.toFixed(2) : "0.00"} size=${width}x${height} vo=${voConfigured}`,
                                "info",
                            );
                            if (isM3u8) {
                                appendMpvTestLog(
                                    `[vod][m3u8][mpv] startup pass time=${Number.isFinite(timePos) ? timePos.toFixed(2) : "0.00"} size=${width}x${height} vo=${voConfigured}`,
                                );
                            }
                            setError(null);
                            return { ok: true, retryable: true };
                        }

                        if (hasTimeProgress && !hasVideoOutput) {
                            const nowMs = Date.now();
                            if (firstAudioOnlyAtMs === 0) {
                                firstAudioOnlyAtMs = nowMs;
                            }
                            const audioOnlyForMs = nowMs - firstAudioOnlyAtMs;
                            termLog(
                                `[VodPlayer] startup probe audio-only transient kernel=mpv time=${timePos.toFixed(2)} size=${width}x${height} vo=${voConfigured} kept_ms=${audioOnlyForMs}`,
                                "info",
                            );
                            if (audioOnlyForMs >= 6000) {
                                unlistenEndFile();
                                setIsMpvActive(false);
                                if (isM3u8) {
                                    appendMpvTestLog(
                                        `[vod][m3u8][mpv] reason_code=no_video_output fail=time advanced but no video output kept_ms=${audioOnlyForMs}`,
                                    );
                                }
                                return { ok: false, retryable: true, reason: "MPV 时间已推进但未建立视频画面输出" };
                            }
                        } else {
                            firstAudioOnlyAtMs = 0;
                        }
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        if (shouldIgnoreMpvProbeError(msg)) {
                            termLog(`[VodPlayer] startup probe transient kernel=mpv reason=${msg}`, "info");
                        } else if (isMpvIpcHardError(msg)) {
                            unlistenEndFile();
                            setIsMpvActive(false);
                            if (isM3u8) {
                                appendMpvTestLog(`[vod][m3u8][mpv] fail: ipc hard error ${msg}`);
                            }
                            return { ok: false, retryable: true, reason: `MPV IPC 通信异常: ${msg}` };
                        } else {
                            termLog(`[VodPlayer] startup probe warn kernel=mpv reason=${msg}`, "warn");
                        }
                    }

                    await sleep(MPV_STARTUP_PROBE_INTERVAL_MS);
                }

                unlistenEndFile();
                setIsMpvActive(false);
                if (isM3u8) {
                    appendMpvTestLog("[vod][m3u8][mpv] reason_code=probe_timeout_no_progress fail=startup probe timeout");
                }
                return { ok: false, retryable: true, reason: "MPV 启动探测超时，未检测到有效画面" };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setIsMpvActive(false);
                if (isM3u8) {
                    appendMpvTestLog(`[vod][m3u8][mpv] fail: startup exception ${msg}`);
                }
                return {
                    ok: false,
                    retryable: true,
                    reason: isMpvIpcHardError(msg) ? `MPV IPC 通信异常: ${msg}` : `MPV 启动失败: ${msg}`,
                };
            }
        }

        if (targetKernel === "flv") {
            if (!flvjs.isSupported()) {
                return { ok: false, retryable: false, reason: "当前环境不支持 FLV 播放" };
            }
            setIsMpvActive(false);
            setActiveKernel("flv");
            termLog(`[VodPlayer] init start kernel=flv url=${url}`, "info");
            const player = flvjs.createPlayer({ type: "flv", url, isLive: false, cors: true });
            player.attachMediaElement(video);
            player.load();
            player.play()?.catch((e) => termLog(`[VodPlayer] FLV play warning: ${String(e)}`, "warn"));
            flvRef.current = player;
            try {
                await waitForVideoStartup(attemptId, DIRECT_STARTUP_TIMEOUT_MS);
                setError(null);
                return { ok: true, retryable: true };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { ok: false, retryable: true, reason: `FLV 启动失败: ${msg}` };
            }
        }

        if (isM3u8 && targetKernel !== "hls-native" && Hls.isSupported()) {
            const wantsProxy = targetKernel === "hls-proxy";
            const customFragmentLoader = TauriHlsLoader as unknown as NonNullable<HlsConfig["fLoader"]>;
            const customPlaylistLoader = TauriHlsLoader as unknown as NonNullable<HlsConfig["pLoader"]>;
            setIsMpvActive(false);
            setActiveKernel(wantsProxy ? "hls-proxy" : "hls-direct");
            termLog(`[VodPlayer] init start kernel=${wantsProxy ? "hls-proxy" : "hls-direct"} url=${url}`, "info");

            const hls = new Hls({
                maxBufferLength: 120,
                maxMaxBufferLength: 1800,
                backBufferLength: 60,
                maxBufferSize: 300 * 1024 * 1024,
                startLevel: -1,
                fLoader: wantsProxy ? customFragmentLoader : undefined,
                pLoader: wantsProxy ? customPlaylistLoader : undefined,
                xhrSetup: (xhr: XMLHttpRequest) => {
                    xhr.withCredentials = false;
                    if (!wantsProxy && headers) {
                        Object.entries(headers).forEach(([k, v]) => {
                            if (v) xhr.setRequestHeader(k, v);
                        });
                    }
                },
            });

            let manifestBlobUrl: string | null = null;
            try {
                if (wantsProxy) {
                    const manifest = await invoke<string>("proxy_hls_manifest", {
                        url,
                        headers,
                        playbackRules,
                        blockedHosts: adHosts,
                    });
                    const baseDir = url.replace(/\/[^/]*$/, "/");
                    const rewritten = manifest
                        .split("\n")
                        .map((line) => {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith("#") || /^https?:\/\//i.test(trimmed)) return line;
                            try {
                                return new URL(trimmed, baseDir).href;
                            } catch {
                                return line;
                            }
                        })
                        .join("\n");
                    manifestBlobUrl = URL.createObjectURL(new Blob([rewritten], { type: "application/vnd.apple.mpegurl" }));
                    hls.loadSource(manifestBlobUrl);
                } else {
                    hls.loadSource(url);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                hls.destroy();
                if (manifestBlobUrl) {
                    URL.revokeObjectURL(manifestBlobUrl);
                }
                return { ok: false, retryable: true, reason: `HLS 预处理失败: ${msg}` };
            }

            const startupResult = await new Promise<KernelAttemptResult>((resolve) => {
                let settled = false;
                let timer: number | null = null;

                const cleanup = () => {
                    if (timer !== null) {
                        window.clearTimeout(timer);
                        timer = null;
                    }
                    hls.off(Hls.Events.MANIFEST_PARSED, onManifest);
                    hls.off(Hls.Events.ERROR, onHlsError);
                    video.removeEventListener("playing", onPlayable);
                    video.removeEventListener("timeupdate", onPlayable);
                    video.removeEventListener("canplay", onPlayable);
                    video.removeEventListener("loadedmetadata", onPlayable);
                };

                const finish = (result: KernelAttemptResult) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve(result);
                };

                const onPlayable = () => {
                    if (attemptId !== attemptTokenRef.current) {
                        finish({ ok: false, retryable: false, reason: "播放请求已更新" });
                        return;
                    }
                    finish({ ok: true, retryable: true });
                };

                const onManifest = () => {
                    if (attemptId !== attemptTokenRef.current) return;
                    video.play().catch((e) => {
                        termLog(`[VodPlayer] HLS play blocked: ${String(e)}`, "warn");
                    });
                };

                const onHlsError = (_event: unknown, data: { fatal?: boolean; type?: string; details?: string }) => {
                    if (attemptId !== attemptTokenRef.current) {
                        finish({ ok: false, retryable: false, reason: "播放请求已更新" });
                        return;
                    }
                    if (!data.fatal) return;
                    const detail = `${data.type ?? "unknown"}/${data.details ?? "unknown"}`;
                    finish({ ok: false, retryable: true, reason: `HLS 致命错误: ${detail}` });
                };

                timer = window.setTimeout(() => {
                    finish({ ok: false, retryable: true, reason: "HLS 启动超时" });
                }, HLS_STARTUP_TIMEOUT_MS);

                hls.on(Hls.Events.MANIFEST_PARSED, onManifest);
                hls.on(Hls.Events.ERROR, onHlsError);
                video.addEventListener("playing", onPlayable);
                video.addEventListener("timeupdate", onPlayable);
                video.addEventListener("canplay", onPlayable);
                video.addEventListener("loadedmetadata", onPlayable);
                hls.attachMedia(video);
            });

            if (manifestBlobUrl) {
                URL.revokeObjectURL(manifestBlobUrl);
            }

            if (startupResult.ok) {
                hlsRef.current = hls;
                setError(null);
                return startupResult;
            }

            hls.destroy();
            hlsRef.current = null;
            return startupResult;
        }

        if (isM3u8) {
            if (!video.canPlayType("application/vnd.apple.mpegurl")) {
                return { ok: false, retryable: false, reason: "当前系统不支持原生 HLS" };
            }
            setIsMpvActive(false);
            setActiveKernel("hls-native");
            termLog(`[VodPlayer] init start kernel=hls-native url=${url}`, "info");
            video.src = url;
            try {
                await video.play();
                await waitForVideoStartup(attemptId, DIRECT_STARTUP_TIMEOUT_MS);
                setError(null);
                return { ok: true, retryable: true };
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return { ok: false, retryable: true, reason: `原生 HLS 启动失败: ${msg}` };
            }
        }

        setIsMpvActive(false);
        setActiveKernel("direct");
        termLog(`[VodPlayer] init start kernel=direct url=${url}`, "info");
        video.src = url;
        try {
            await video.play();
            await waitForVideoStartup(attemptId, DIRECT_STARTUP_TIMEOUT_MS);
            setError(null);
            return { ok: true, retryable: true };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, retryable: true, reason: `直连播放失败: ${msg}` };
        }
    }, [
        adHosts,
        appendMpvTestLog,
        closeActiveRelaySession,
        destroyPlayer,
        playbackRules,
        queueDestroyMpv,
        sleep,
        termLog,
        TauriHlsLoader,
        waitForVideoStartup,
    ]);

    const playEpisode = useCallback(async (episode: VodEpisode, routeName: string) => {
        const requestId = ++playRequestIdRef.current;
        setLoading(true);
        setError(null);
        setPlaybackNotice(null);
        setPlaybackPosition(0);
        setPlaybackDuration(0);

        await invoke("clear_mpv_test_log").catch(() => void 0);
        const mpvLogPath = await invoke<string>("get_mpv_test_log_path").catch(() => "mpv_log.txt");
        appendMpvTestLog(`[vod] playback session start route=${routeName} episode=${episode.name} log_path=${mpvLogPath}`);

        showPlaybackNotice("正在解析播放地址...");
        const stream = await fetchEpisodePlayback(episode, routeName);
        if (requestId !== playRequestIdRef.current) {
            return;
        }

        let streamKind: VodStreamKind = "unknown";
        try {
            const probe = await probeResolvedStream(stream.url, stream.headers);
            if (requestId !== playRequestIdRef.current) {
                return;
            }
            streamKind = probe.kind;
            if (probe.finalUrl && probe.finalUrl !== stream.url) {
                stream.url = probe.finalUrl;
            }
            termLog(
                `[VodPlayer] stream_probe kind=${probe.kind} probed=${probe.probed} final_url=${probe.finalUrl ?? stream.url} content_type=${probe.contentType ?? "unknown"} reason=${probe.reason ?? "none"}`,
                "info",
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            termLog(`[VodPlayer] stream_probe skipped reason=${message}`, "warn");
        }

        const preferProxyPlan = shouldUseProxyForUrl(proxyDomains, stream.url);
        const kernelPlan = preferProxyPlan && kernelModeRef.current === "mpv"
            ? buildVodKernelPlan("proxy")
            : buildVodKernelPlan(kernelModeRef.current);
        termLog(`[VodPlayer] kernel_plan=[${kernelPlan.join(",")}]`, "info");
        const summary: string[] = [];

        try {
            for (let kernelIdx = 0; kernelIdx < kernelPlan.length; kernelIdx += 1) {
                const kernel = kernelPlan[kernelIdx];
                let lastReason = "未知错误";

                for (let attempt = 1; attempt <= VOD_KERNEL_MAX_ATTEMPTS; attempt += 1) {
                    if (requestId !== playRequestIdRef.current) {
                        return;
                    }

                    termLog(
                        `[VodPlayer] kernel_attempt start kernel=${kernel} attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} next_action=fetch_url`,
                        "info",
                    );
                    if (kernel === "mpv") {
                        appendMpvTestLog(
                            `[vod][mpv] kernel=mpv attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} next_action=fetch_url`,
                        );
                    }
                    showPlaybackNotice(`正在尝试 ${VOD_KERNEL_LABELS[kernel]}（第 ${attempt} 次）`);

                    try {
                        const streamLowerUrl = stream.url.toLowerCase();
                        const isM3u8Stream = streamKind === "hls" || streamLowerUrl.includes(".m3u8");
                        if (kernel === "mpv" && attempt === 1 && isM3u8Stream) {
                            lastReason = "检测到 m3u8，按策略首轮跳过 MPV，直接切换下一个内核";
                            termLog(
                                `[VodPlayer] kernel_attempt skip kernel=mpv attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=mpv_skip_m3u8_initial reason=${lastReason} next_action=switch_kernel`,
                                "warn",
                            );
                            appendMpvTestLog(
                                `[vod][mpv] kernel=mpv attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=mpv_skip_m3u8_initial reason=${lastReason} next_action=switch_kernel`,
                            );
                            showPlaybackNotice("检测到 m3u8，已跳过 MPV，切换下一内核...");
                            break;
                        }

                        const result = await attemptPlayUrl(stream.url, stream.headers, kernel, routeName, streamKind);
                        if (requestId !== playRequestIdRef.current) {
                            return;
                        }

                        if (result.ok) {
                            termLog(
                                `[VodPlayer] kernel_attempt success kernel=${kernel} attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} next_action=playing`,
                                "info",
                            );
                            setError(null);
                            setPlaybackNotice(null);
                            return;
                        }

                        lastReason = result.reason ?? "未知错误";
                        const reasonCode = inferReasonCode(lastReason);
                        const nextAction = result.retryable && attempt < VOD_KERNEL_MAX_ATTEMPTS
                            ? `retry-${attempt + 1}`
                            : "switch_kernel";
                        termLog(
                            `[VodPlayer] kernel_attempt fail kernel=${kernel} attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=${reasonCode} reason=${lastReason} next_action=${nextAction}`,
                            "warn",
                        );
                        if (kernel === "mpv") {
                            appendMpvTestLog(
                                `[vod][mpv] kernel=mpv attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=${reasonCode} reason=${lastReason} next_action=${nextAction}`,
                            );
                        }

                        if (!result.retryable) {
                            break;
                        }

                        if (attempt < VOD_KERNEL_MAX_ATTEMPTS) {
                            showPlaybackNotice(`${VOD_KERNEL_LABELS[kernel]} 第 ${attempt} 次失败，准备重试...`);
                        }
                    } catch (e) {
                        if (requestId !== playRequestIdRef.current) {
                            return;
                        }
                        lastReason = e instanceof Error ? e.message : String(e);
                        const reasonCode = inferReasonCode(lastReason);
                        const nextAction = attempt < VOD_KERNEL_MAX_ATTEMPTS
                            ? `retry-${attempt + 1}`
                            : "switch_kernel";
                        termLog(
                            `[VodPlayer] kernel_attempt fail kernel=${kernel} attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=${reasonCode} reason=${lastReason} next_action=${nextAction}`,
                            "warn",
                        );
                        if (kernel === "mpv") {
                            appendMpvTestLog(
                                `[vod][mpv] kernel=mpv attempt=${attempt}/${VOD_KERNEL_MAX_ATTEMPTS} reason_code=${reasonCode} reason=${lastReason} next_action=${nextAction}`,
                            );
                        }
                        if (attempt < VOD_KERNEL_MAX_ATTEMPTS) {
                            showPlaybackNotice(`${VOD_KERNEL_LABELS[kernel]} 第 ${attempt} 次失败，准备重试...`);
                        }
                    }
                }

                summary.push(`${VOD_KERNEL_LABELS[kernel]}: ${lastReason}`);
                if (requestId !== playRequestIdRef.current) {
                    return;
                }

                if (kernelIdx < kernelPlan.length - 1) {
                    const nextKernel = kernelPlan[kernelIdx + 1];
                    termLog(`[VodPlayer] switch kernel to ${nextKernel}`, "warn");
                    showPlaybackNotice(
                        `${VOD_KERNEL_LABELS[kernel]} 已重试 ${VOD_KERNEL_MAX_ATTEMPTS} 次，切换到 ${VOD_KERNEL_LABELS[nextKernel]}`,
                    );
                }
            }

            closeActiveRelaySession("all-kernels-failed");
            setError(`播放失败：${summary.join(" | ")}`);
            termLog(`[VodPlayer] all kernel attempts failed summary=${summary.join(" || ")}`, "error");
        } finally {
            if (requestId === playRequestIdRef.current) {
                setLoading(false);
            }
        }
    }, [
        appendMpvTestLog,
        attemptPlayUrl,
        closeActiveRelaySession,
        fetchEpisodePlayback,
        probeResolvedStream,
        proxyDomains,
        showPlaybackNotice,
        termLog,
    ]);


    useEffect(() => {
        if (!activeEpisode || !activeRoute) return;
        void playEpisode(activeEpisode, activeRoute.sourceName);
        return () => { destroyPlayer(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => () => { destroyPlayer(); }, [destroyPlayer]);
    useEffect(() => {
        if (!onClose) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const seekTo = useCallback(async (targetSeconds: number) => {
        const max = playbackDuration > 0 ? playbackDuration : targetSeconds;
        const clamped = Math.max(0, Math.min(targetSeconds, max));

        if (isMpvActive) {
            try {
                await setMpvProperty("time-pos", clamped, MPV_WINDOW_LABEL);
            } catch {
                await mpvCommand("seek", [String(clamped), "absolute", "exact"], MPV_WINDOW_LABEL).catch(() => void 0);
            }
            setPlaybackPosition(clamped);
            return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.currentTime = clamped;
        setPlaybackPosition(clamped);
    }, [isMpvActive, playbackDuration]);

    const handleSeek = useCallback((rawValue: string) => {
        const next = Number(rawValue);
        if (!Number.isFinite(next)) return;
        void seekTo(next);
    }, [seekTo]);

    const handleEpisodeClick = useCallback(async (routeIdx: number, epIdx: number) => {
        const route = routes[routeIdx];
        const ep = route?.episodes[epIdx];
        if (!route || !ep) return;
        setActiveRouteIdx(routeIdx);
        setActiveEpisodeIdx(epIdx);
        await playEpisode(ep, route.sourceName);
    }, [routes, playEpisode]);

    const handleKernelChange = useCallback((nextMode: VodKernelMode) => {
        setKernelMode(nextMode);
        kernelModeRef.current = nextMode;
        if (activeEpisode && activeRoute) {
            void playEpisode(activeEpisode, activeRoute.sourceName);
        }
    }, [activeEpisode, activeRoute, playEpisode]);

    const canSeek = playbackDuration > 0.1;
    const sliderMax = canSeek ? playbackDuration : 1;
    const sliderValue = canSeek ? Math.min(playbackPosition, playbackDuration) : 0;

    return (
        <div
            className={cn(
                "relative flex w-full h-full overflow-hidden",
                isMpvActive ? "bg-transparent" : "bg-black"
            )}
            data-component="vod-player"
        >
            <div
                className={cn(
                    "h-full flex flex-col border-r border-white/5 shrink-0 z-40",
                    isMpvActive ? "bg-black/60 backdrop-blur-md transition-none" : "bg-zinc-950 transition-all duration-300",
                    isSidebarOpen ? "w-64" : "w-0 opacity-0 overflow-hidden border-transparent"
                )}
            >
                <div
                    className={cn("p-3 border-b border-white/5 shrink-0", isMpvActive ? "bg-black/20" : "bg-zinc-900")}
                    style={dragRegionStyle}
                >
                    {detail ? (
                        <div className="flex gap-3 items-start" style={noDragRegionStyle}>
                            <div className="w-12 h-16 rounded overflow-hidden shrink-0 bg-zinc-800">
                                <VodProxyImage src={detail.vod_pic} alt={detail.vod_name} className="w-full h-full" />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                                <p className="text-xs font-bold leading-snug text-white truncate">{detail.vod_name}</p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {detail.vod_year && <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">{detail.vod_year}</span>}
                                    {detail.vod_area && <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded text-white/60">{detail.vod_area}</span>}
                                </div>
                                {detail.vod_director && <p className="text-[10px] text-white/40 mt-1 truncate">导演: {detail.vod_director}</p>}
                            </div>
                        </div>
                    ) : (
                        <div style={noDragRegionStyle} className="h-16 flex items-center justify-center text-white/30 text-xs">Halo VOD Player</div>
                    )}
                </div>

                {routes.length > 1 && (
                    <div className="shrink-0 px-2 pt-2 pb-1.5 border-b border-white/5">
                        <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5 px-1">播放线路</p>
                        <div className="flex flex-wrap gap-1">
                            {routes.map((route, idx) => (
                                <button
                                    key={`${route.sourceName}-${idx}`}
                                    onClick={() => { setActiveRouteIdx(idx); setActiveEpisodeIdx(0); }}
                                    className={cn(
                                        "text-xs px-2 py-0.5 rounded border transition-all",
                                        activeRouteIdx === idx
                                            ? "bg-primary text-primary-foreground border-primary/60 font-semibold"
                                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                                    )}
                                >
                                    {route.sourceName}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
                    <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1.5 px-1">选集</p>
                    {activeRoute && activeRoute.episodes.length > 0 ? (
                        <div className="grid grid-cols-3 gap-1">
                            {activeRoute.episodes.map((ep, idx) => (
                                <button
                                    key={`${ep.name}-${idx}`}
                                    onClick={() => void handleEpisodeClick(activeRouteIdx, idx)}
                                    className={cn(
                                        "text-xs py-1.5 px-1 rounded border transition-all truncate text-center",
                                        activeEpisodeIdx === idx
                                            ? "bg-primary text-primary-foreground border-primary/60 font-semibold shadow-sm shadow-primary/20"
                                            : ep.searchOnly
                                                ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                                                : "bg-transparent text-zinc-400 border-white/5 hover:bg-white/5 hover:text-white"
                                    )}
                                    title={ep.name}
                                >
                                    {ep.name}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="py-8 text-center text-white/30 text-xs">暂无集数信息</div>
                    )}
                </div>
            </div>

            <div
                className={cn(
                    "flex-1 flex flex-col relative h-full overflow-hidden",
                    isMpvActive ? "bg-transparent transition-none" : "bg-black transition-all duration-300"
                )}
            >
                <div className="absolute top-0 left-0 right-0 z-[70]">
                    <div
                        data-tauri-drag-region
                        className="h-11 flex items-center justify-between gap-3 px-3 bg-black/80 backdrop-blur border-b border-white/10"
                    >
                        <div className="flex items-center gap-2 min-w-0" style={noDragRegionStyle}>
                            <button
                                onClick={() => setIsSidebarOpen(v => !v)}
                                className={cn("p-1.5 rounded-md hover:bg-white/20 text-white transition-colors", isSidebarOpen ? "bg-white/10" : "")}
                                title="侧边栏"
                            >
                                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                            </button>
                            <span className="text-xs text-white/90 truncate max-w-[280px]">
                                {activeRoute?.sourceName ?? "未选择线路"} 路 {activeEpisode?.name ?? "未选择剧集"}
                            </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0" style={noDragRegionStyle}>
                            <span className={cn(
                                "px-2 py-0.5 rounded text-white font-mono text-xs flex items-center gap-1",
                                activeKernel === "mpv" ? "bg-violet-500/80" :
                                    activeKernel.startsWith("hls") ? "bg-emerald-500/80" :
                                        activeKernel === "flv" ? "bg-sky-500/80" : "bg-zinc-500/80"
                            )}>
                                <span className="size-1.5 rounded-full bg-white animate-pulse" />
                                {VOD_KERNEL_LABELS[activeKernel]}
                            </span>

                            <select
                                value={kernelMode}
                                onChange={(e) => handleKernelChange(e.target.value as VodKernelMode)}
                                className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 text-xs outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
                                title="播放内核"
                            >
                                {KERNEL_MODE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>

                            {onClose && (
                                <button
                                    onClick={onClose}
                                    className="p-1.5 rounded-md hover:bg-red-500/80 text-white transition-colors border border-white/5 bg-black/20 backdrop-blur-md"
                                    title="关闭"
                                >
                                    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="px-3 py-1.5 bg-black/70 backdrop-blur border-b border-white/10" style={noDragRegionStyle}>
                        <div className="flex items-center gap-2 text-[11px] text-white/85">
                            <span className="w-12 text-right tabular-nums">{formatPlaybackTime(sliderValue)}</span>
                            <input
                                type="range"
                                min={0}
                                max={sliderMax}
                                step={0.1}
                                value={sliderValue}
                                disabled={!canSeek}
                                onChange={(e) => handleSeek(e.currentTarget.value)}
                                className="flex-1 accent-primary disabled:opacity-50"
                                title="播放进度"
                            />
                            <span className="w-12 tabular-nums">{formatPlaybackTime(playbackDuration)}</span>
                        </div>
                    </div>
                </div>

                <div className={cn("flex-1 relative overflow-hidden", isMpvActive ? "bg-transparent" : "bg-black")}>
                    <video
                        ref={videoRef}
                        className={cn(
                            "absolute inset-0 w-full h-full outline-none object-contain",
                            isMpvActive ? "opacity-0 pointer-events-none" : ""
                        )}
                        autoPlay
                        playsInline
                        controls={false}
                    />

                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20 pointer-events-none">
                            <div className="size-10 rounded-full border-2 border-white/10 border-t-primary animate-spin mb-3" />
                            <span className="text-xs text-white/60">正在解析播放地址...</span>
                        </div>
                    )}

                    {playbackNotice && !loading && (
                        <div className="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-500/20 px-3 py-1 text-[11px] text-amber-100 shadow-lg backdrop-blur pointer-events-none">
                            {playbackNotice}
                        </div>
                    )}

                    {error && !loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
                            <svg className="size-12 text-red-500 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <p className="text-sm text-red-50 font-bold mb-1">播放失败</p>
                            <p className="text-zinc-400 text-xs mb-4 max-w-xs text-center">{error}</p>
                            <button
                                onClick={() => { if (activeEpisode && activeRoute) void playEpisode(activeEpisode, activeRoute.sourceName); }}
                                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-md text-xs font-medium"
                            >
                                重试
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

