import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { TvIcon, PlayIcon, AlertCircleIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Hls, { type HlsConfig } from "hls.js";
import mpegts from "mpegts.js";
import * as dashjs from "dashjs";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    command as mpvCommand,
    destroy as destroyMpv,
    init as initMpv,
    observeProperties as observeMpvProperties,
    setProperty as setMpvProperty,
    type MpvConfig,
} from "tauri-plugin-mpv-api";
import {
    canHalfOpenProbe,
    computeRuntimeBufferTargetSec,
    computeStartupTargetSec,
    createLineHealthRecord,
    createSwitchRateLimiterState,
    getLineHealthScore,
    isLineQuarantined,
    lineIdentity,
    markHalfOpenProbe,
    noteLineAutoSwitchFailure,
    noteLineHardFailure,
    noteLineRecoveryFailure,
    noteLineStall,
    noteLineStartupSuccess,
    registerAutoSwitch,
    type LineHealthRecord,
    type PlaybackState,
    type SwitchRateLimiterState,
} from "@/modules/live/services/livePlaybackPolicy";

import type { LiveGroup, LiveChannel } from "@/modules/live/types/live.types";

type HlsKernel = "proxy" | "direct" | "native" | "mpv";
type HlsKernelMode = "auto" | HlsKernel;
type PlayTrigger = "initial" | "manual" | "auto" | "kernel" | "recover";
type KernelFailureReason =
    | "manifest"
    | "transport"
    | "startup_timeout"
    | "stall"
    | "fatal"
    | "frag";
type KernelHealthCell = {
    failures: number;
    blockedUntil: number;
    lastFailureAt: number;
};
type PendingPlayRequest = {
    index: number;
    hlsKernelAttempt: number;
    recoverAttempt: number;
    trigger: PlayTrigger;
    kernelPlanOverride: HlsKernel[] | null;
};
type LineKernelHealthRecord = Record<HlsKernel, KernelHealthCell>;
type LiveProxyMetrics = {
    segment_count: number;
    bytes_total: number;
    last_segment_bytes: number;
    last_segment_ms: number;
    avg_segment_ms: number;
    bytes_per_second: number;
    updated_at_ms: number;
    cache_hits?: number;
    cache_misses?: number;
    cache_hit_ratio?: number;
    prefetch_warmed?: number;
    segment_error_count?: number;
    segment_retry_count?: number;
    transport_decode_error_count?: number;
    transient_error_count?: number;
    manifest_refresh_ms?: number;
    prefetch_active_workers?: number;
    prefetch_backoff_count?: number;
    relay_seq_cache_hits?: number;
    relay_source_fallback_hits?: number;
    buffer_anomaly_count?: number;
    build_profile_tag?: string;
    last_error?: string | null;
};

const HLS_AUTO_PLAN: HlsKernel[] = ["proxy", "native", "direct", "mpv"];
const MPV_OBSERVED_PROPERTIES = [
    "time-pos",
    "pause",
    "eof-reached",
    "demuxer-cache-duration",
    "video-bitrate",
    "audio-bitrate"
] as const;
const REALTIME_MODE = true;
const ENABLE_LINE_CIRCUIT_BREAKER = true;
const ENABLE_SWITCH_RATE_LIMIT = true;
const MANUAL_LINE_LOCK_MS = 120_000;
const HARD_GUARD_BUFFER_SECONDS = 3;
const STEADY_TOPUP_TARGET_SECONDS = 24;
const SOFT_HOLD_BUFFER_SECONDS = 10;
const SOFT_HOLD_RESUME_SECONDS = 16;
const EARLY_REBUFFER_GRACE_MS = 25_000;
const EARLY_EMERGENCY_RESUME_SECONDS = 8;
const STARTUP_TIMEOUT_SECONDS = 60;
const STARTUP_TARGET_MIN_SECONDS = 8;
const STARTUP_TARGET_MAX_SECONDS = 12;
const STARTUP_TARGET_STEP_SECONDS = 2;
const MANIFEST_WATCHDOG_MS = 10_000;
const STARTUP_IDLE_RECOVER_MS = 9_000;
const STARTUP_IDLE_RECOVER_COOLDOWN_MS = 12_000;
const BUFFER_GAP_TOLERANCE_SECONDS = 1.2;
const MAX_LIVE_BUFFER_AHEAD_SECONDS = 120;
const BUFFER_ANOMALY_AHEAD_SECONDS = 600;
const BUFFER_ANOMALY_DEBOUNCE_MS = 12_000;
const AUTO_SWITCH_WINDOW_MS = 90_000;
const AUTO_SWITCH_LIMIT = 2;
const AUTO_SWITCH_COOLDOWN_MS = 30_000;
const KERNEL_MODE_OPTIONS: Array<{ value: HlsKernelMode; label: string }> = [
    { value: "auto", label: "内核自动" },
    { value: "proxy", label: "代理内核" },
    { value: "direct", label: "直连内核" },
    { value: "native", label: "原生内核" },
    { value: "mpv", label: "MPV 内核" },
];
const HLS_LIVE_SYNC_SECONDS = 3;
const HLS_LIVE_MAX_LATENCY_SECONDS = 8;
const HLS_MAX_BUFFER_SECONDS = 12;
const HLS_MAX_BUFFER_CEILING_SECONDS = 18;
const HLS_BACK_BUFFER_SECONDS = 8;
const MPV_WINDOW_LABEL = "live_player";

const LINE_HEALTH_REGISTRY = new Map<string, LineHealthRecord>();
const LINE_KERNEL_HEALTH_REGISTRY = new Map<string, LineKernelHealthRecord>();

function clamp(min: number, max: number, value: number): number {
    return Math.max(min, Math.min(max, value));
}

function createLineKernelHealthRecord(): LineKernelHealthRecord {
    return {
        proxy: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        direct: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        native: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        mpv: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
    };
}

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

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative flex w-full h-full overflow-hidden",
                isMpvActive ? "bg-transparent" : "bg-black",
                !showControls && isFullscreen ? "cursor-none" : ""
            )}
            data-component="live-player"
        >
            {/* 1. Left Sidebar (Fixed) */}
            <div
                className={cn(
                    "h-full flex flex-col border-r border-white/5 shrink-0 z-40",
                    isMpvActive ? "bg-black/60 backdrop-blur-md transition-none" : "bg-zinc-950 transition-all duration-300",
                    isSidebarOpen ? "w-64" : "w-0 opacity-0 overflow-hidden border-transparent"
                )}
            >
                {/* Search / Group */}
                <div className={cn("p-3 border-b border-white/5 shrink-0", isMpvActive ? "bg-black/20" : "bg-zinc-900")} style={dragRegionStyle}>
                    <select
                        style={noDragRegionStyle}
                        className="w-full bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-foreground outline-none transition-colors"
                        value={activeGroup}
                        onChange={(e) => setActiveGroup(e.target.value)}
                    >
                        {groups.map((g) => (
                            <option key={g.groupName} value={g.groupName}>{g.groupName}</option>
                        ))}
                    </select>
                </div>

                {/* Channel List */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 custom-scrollbar">
                    {currentGroupChannels.map((channel, idx) => {
                        const isActive = activeChannel.name === channel.name;
                        return (
                            <button
                                key={`${channel.name}-${idx}`}
                                onClick={() => {
                                    setActiveChannel(channel);
                                    if (isFullscreen) setIsSidebarOpen(false);
                                }}
                                className={cn(
                                    "w-full flex justify-between items-center text-left px-3 py-2.5 rounded-lg transition-all",
                                    isActive
                                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                                        : "bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white"
                                )}
                            >
                                <div className="flex items-center gap-2 truncate">
                                    {channel.logo ? (
                                        <img
                                            src={channel.logo}
                                            alt=""
                                            className="size-4 shrink-0 rounded object-contain"
                                            onError={(e) => (e.currentTarget.style.display = 'none')}
                                        />
                                    ) : (
                                        <TvIcon className={cn("size-4 shrink-0", isActive ? "text-primary-foreground/80" : "text-zinc-600")} />
                                    )}
                                    <span className="text-xs font-medium truncate">{channel.name}</span>
                                </div>
                                {isActive && <PlayIcon className="size-3 shrink-0 text-primary-foreground drop-shadow" />}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* 2. Main Content Area */}
            <div
                className={cn(
                    "flex-1 flex flex-col relative h-full overflow-hidden",
                    isMpvActive ? "bg-transparent transition-none" : "bg-black transition-all duration-300"
                )}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setShowControls(false)}
            >
                {/* Top drag bar */}
                <div
                    data-tauri-drag-region
                    className="absolute top-0 left-0 right-0 h-10 z-[60] flex items-center justify-between px-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none transition-opacity duration-300"
                    style={{ opacity: showControls ? 1 : 0, ...dragRegionStyle }}
                >
                    <div className="flex items-center gap-2 pointer-events-auto" style={noDragRegionStyle}>
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className={cn("p-1.5 rounded-md hover:bg-white/20 text-white transition-colors", isSidebarOpen ? "bg-white/10" : "")}
                        >
                            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                        </button>
                        <span className="text-sm font-medium text-white/90 truncate max-w-[200px] drop-shadow-md">{activeChannel.name}</span>
                        {latency !== null && (
                            <span className="px-1.5 py-0.5 ml-2 rounded bg-green-500/80 text-white text-[10px] font-mono shadow-sm">
                                延迟: {(latency < 0.5 ? 0 : latency).toFixed(1)}s
                            </span>
                        )}
                    </div>

                    <div className="pointer-events-auto" style={noDragRegionStyle}>
                        {onClose && (
                            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-red-500/80 text-white transition-colors border border-white/5 bg-black/20 backdrop-blur-md">
                                <XIcon className="size-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Video Container (Strictly bound to exactly where video should be) */}
                <div
                    ref={videoAreaRef}
                    className={cn(
                        "flex-1 relative overflow-hidden",
                        isMpvActive ? "bg-transparent" : "bg-black"
                    )}
                >
                    <video
                        ref={videoRef}
                        className={cn(
                            "absolute inset-0 w-full h-full outline-none object-contain",
                            isMpvActive ? "opacity-0 pointer-events-none" : ""
                        )}
                        onPlay={handleVideoPlay}
                        onPause={handleVideoPause}
                        onError={handleNativeError}
                        onWaiting={handleVideoWaiting}
                        preload="auto"
                        playsInline
                    />

                    {errorInfo && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-20">
                            <AlertCircleIcon className="size-12 text-red-500 mb-3" />
                            <p className="text-lg text-red-50 font-bold mb-1">播放失败</p>
                            <p className="text-zinc-400 text-xs mb-4">{errorInfo}</p>
                            <button onClick={() => {
                                manualLineLockUntilRef.current = Date.now() + MANUAL_LINE_LOCK_MS;
                                void playLine(0, 0, 0, "manual");
                            }} className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-md text-xs font-medium">
                                重试
                            </button>
                        </div>
                    )}

                    {!isPlaying && !errorInfo && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="size-10 rounded-full border-2 border-white/10 border-t-primary animate-spin" />
                        </div>
                    )}
                </div>

                {/* Bottom Control Bar */}
                <div
                    className={cn(
                        "absolute bottom-0 inset-x-0 flex flex-col border-t border-white/5 shrink-0 z-50 transition-all duration-300",
                        isMpvActive ? "bg-black/60 backdrop-blur-md" : "bg-zinc-950/90 backdrop-blur-md",
                        !showControls ? "translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
                    )}
                >
                    {/* Progress / Buffer Bar */}
                    <div className="w-full h-1 bg-zinc-900 overflow-hidden group cursor-pointer relative">
                        {/* Buffer Fill */}
                        <div
                            className="absolute top-0 left-0 h-full bg-white/20 transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, bufferFillPercent))}%` }}
                        />
                        {/* Fake Live Position Indicator */}
                        <div
                            className="absolute top-0 right-0 h-full w-4 bg-gradient-to-r from-primary/0 to-primary"
                        />
                    </div>

                    {/* Controls Row */}
                    <div className="flex items-center justify-between px-4 py-2 text-white">

                        {/* Left Controls */}
                        <div className="flex items-center gap-4">
                            {/* Volume Slider */}
                            <div className="flex items-center gap-2 group flex-1 max-w-24">
                                <svg className="size-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                                <input
                                    type="range"
                                    min="0" max="1" step="0.05"
                                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-primary"
                                    onChange={(e) => {
                                        if (videoRef.current) videoRef.current.volume = Number(e.target.value);
                                        if (isMpvActive) {
                                            void setMpvProperty("volume", Number(e.target.value) * 100, MPV_WINDOW_LABEL).catch(() => void 0);
                                        }
                                    }}
                                    defaultValue="1"
                                    title="音量"
                                />
                            </div>
                        </div>

                        {/* Middle Info */}
                        <div className="flex-1 flex justify-center items-center gap-4 text-xs hidden md:flex opacity-70 hover:opacity-100 transition-opacity">
                            <span className={cn("px-2 py-0.5 rounded text-white font-mono flex items-center gap-1", kernelBadgeClass)}>
                                <span className="size-1.5 rounded-full bg-white animate-pulse" />
                                {kernelDisplayName}
                            </span>
                            <span className="text-zinc-400 font-mono flex gap-3">
                                <span>{playbackStateName}</span>
                                <span>缓冲:{bufferAheadSeconds.toFixed(1)}s</span>
                                <span>速率:{isMpvActive ? (mpvBitrate / 8 / 1024).toFixed(0) : backendRateKbps.toFixed(0)}KB/s</span>
                            </span>
                        </div>

                        {/* Right Controls */}
                        <div className="flex items-center gap-2">
                            <select
                                className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 text-xs outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
                                value={lineIndex}
                                onChange={(e) => {
                                    manualLineLockUntilRef.current = Date.now() + MANUAL_LINE_LOCK_MS;
                                    void playLine(Number(e.target.value), 0, 0, "manual");
                                }}
                                title="切换线路"
                            >
                                {activeChannel.urls.map((_, i) => (
                                    <option key={i} value={i}>线路 {i + 1}</option>
                                ))}
                            </select>

                            <select
                                className="bg-zinc-900 border border-white/10 text-white rounded px-2 py-1 text-xs outline-none cursor-pointer hover:bg-zinc-800 transition-colors"
                                value={hlsKernelMode}
                                onChange={(e) => handleKernelModeChange(e.target.value as HlsKernelMode)}
                                title="播放内核"
                            >
                                {KERNEL_MODE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>

                            <button onClick={handleFullscreen} className="p-1.5 ml-1 rounded hover:bg-white/10 text-zinc-300 transition-colors" title="全屏">
                                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {isFullscreen ? (
                                        <><polyline points="8 3 8 8 3 8" /><polyline points="16 3 16 8 21 8" /><polyline points="8 21 8 16 3 16" /><polyline points="16 21 16 16 21 16" /></>
                                    ) : (
                                        <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>
                                    )}
                                </svg>
                            </button>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
