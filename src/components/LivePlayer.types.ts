import type { LineHealthRecord, PlaybackState, SwitchRateLimiterState } from "@/modules/live/services/livePlaybackPolicy";
import type { LiveGroup, LiveChannel } from "@/modules/live/types/live.types";

export type HlsKernel = "proxy" | "direct" | "native" | "mpv";
export type HlsKernelMode = "auto" | HlsKernel;
export type PlayTrigger = "initial" | "manual" | "auto" | "kernel" | "recover";
export type KernelFailureReason =
    | "manifest"
    | "transport"
    | "startup_timeout"
    | "stall"
    | "fatal"
    | "frag";

export type KernelHealthCell = {
    failures: number;
    blockedUntil: number;
    lastFailureAt: number;
};

export type PendingPlayRequest = {
    index: number;
    hlsKernelAttempt: number;
    recoverAttempt: number;
    trigger: PlayTrigger;
    kernelPlanOverride: HlsKernel[] | null;
};

export type LineKernelHealthRecord = Record<HlsKernel, KernelHealthCell>;

export type LiveProxyMetrics = {
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

export const HLS_AUTO_PLAN: HlsKernel[] = ["proxy", "native", "direct", "mpv"];
export const MPV_OBSERVED_PROPERTIES = [
    "time-pos",
    "pause",
    "eof-reached",
    "demuxer-cache-duration",
    "video-bitrate",
    "audio-bitrate"
] as const;

export const REALTIME_MODE = true;
export const ENABLE_LINE_CIRCUIT_BREAKER = true;
export const ENABLE_SWITCH_RATE_LIMIT = true;
export const MANUAL_LINE_LOCK_MS = 120_000;
export const HARD_GUARD_BUFFER_SECONDS = 3;
export const STEADY_TOPUP_TARGET_SECONDS = 24;
export const SOFT_HOLD_BUFFER_SECONDS = 10;
export const SOFT_HOLD_RESUME_SECONDS = 16;
export const EARLY_REBUFFER_GRACE_MS = 25_000;
export const EARLY_EMERGENCY_RESUME_SECONDS = 8;
export const STARTUP_TIMEOUT_SECONDS = 60;
export const STARTUP_TARGET_MIN_SECONDS = 8;
export const STARTUP_TARGET_MAX_SECONDS = 12;
export const STARTUP_TARGET_STEP_SECONDS = 2;
export const MANIFEST_WATCHDOG_MS = 10_000;
export const STARTUP_IDLE_RECOVER_MS = 9_000;
export const STARTUP_IDLE_RECOVER_COOLDOWN_MS = 12_000;
export const BUFFER_GAP_TOLERANCE_SECONDS = 1.2;
export const MAX_LIVE_BUFFER_AHEAD_SECONDS = 120;
export const BUFFER_ANOMALY_AHEAD_SECONDS = 600;
export const BUFFER_ANOMALY_DEBOUNCE_MS = 12_000;
export const AUTO_SWITCH_WINDOW_MS = 90_000;
export const AUTO_SWITCH_LIMIT = 2;
export const AUTO_SWITCH_COOLDOWN_MS = 30_000;

export const KERNEL_MODE_OPTIONS: Array<{ value: HlsKernelMode; label: string }> = [
    { value: "auto", label: "内核自动" },
    { value: "proxy", label: "代理内核" },
    { value: "direct", label: "直连内核" },
    { value: "native", label: "原生内核" },
    { value: "mpv", label: "MPV 内核" },
];

export const HLS_LIVE_SYNC_SECONDS = 3;
export const HLS_LIVE_MAX_LATENCY_SECONDS = 8;
export const HLS_MAX_BUFFER_SECONDS = 12;
export const HLS_MAX_BUFFER_CEILING_SECONDS = 18;
export const HLS_BACK_BUFFER_SECONDS = 8;
export const MPV_WINDOW_LABEL = "live_player";

export const LINE_HEALTH_REGISTRY = new Map<string, LineHealthRecord>();
export const LINE_KERNEL_HEALTH_REGISTRY = new Map<string, LineKernelHealthRecord>();

export function clamp(min: number, max: number, value: number): number {
    return Math.max(min, Math.min(max, value));
}

export function createLineKernelHealthRecord(): LineKernelHealthRecord {
    return {
        proxy: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        direct: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        native: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
        mpv: { failures: 0, blockedUntil: 0, lastFailureAt: 0 },
    };
}

export type { LineHealthRecord, PlaybackState, SwitchRateLimiterState, LiveGroup, LiveChannel };
