export type PlaybackState =
    | "startup_buffering"
    | "playing"
    | "emergency_hold"
    | "recovering_same_line"
    | "switching_line"
    | "failed";

export type ProxyMetricsLike = {
    avg_segment_ms?: number;
    bytes_per_second?: number;
    cache_hits?: number;
    cache_misses?: number;
};

export type LineHealthRecord = {
    successStarts: number;
    consecutiveFailures: number;
    avgTtffMs: number;
    stallsPerMin: number;
    lastFailureAt: number;
    quarantineUntil: number;
    lastProbeAt: number;
    stallEvents: number[];
    recoveryFailures: number;
    autoSwitchFailures: number;
};

export type SwitchRateLimiterState = {
    timestamps: number[];
    cooldownUntil: number;
};

function clamp(min: number, max: number, value: number): number {
    return Math.max(min, Math.min(max, value));
}

export function createLineHealthRecord(): LineHealthRecord {
    return {
        successStarts: 0,
        consecutiveFailures: 0,
        avgTtffMs: 0,
        stallsPerMin: 0,
        lastFailureAt: 0,
        quarantineUntil: 0,
        lastProbeAt: 0,
        stallEvents: [],
        recoveryFailures: 0,
        autoSwitchFailures: 0,
    };
}

export function createSwitchRateLimiterState(): SwitchRateLimiterState {
    return {
        timestamps: [],
        cooldownUntil: 0,
    };
}

export function lineIdentity(url: string, headers: Record<string, string> | null | undefined): string {
    const entries = Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return `${url}::${JSON.stringify(entries)}`;
}

export function getLineHealthScore(record: LineHealthRecord): number {
    const stallPenalty = Math.floor(record.stallsPerMin) * 5;
    const score =
        70 +
        record.successStarts * 8 -
        record.recoveryFailures * 12 -
        record.autoSwitchFailures * 18 -
        stallPenalty;
    return clamp(0, 100, score);
}

function quarantineSecondsByFailures(consecutiveFailures: number): number {
    if (consecutiveFailures >= 4) return 300;
    if (consecutiveFailures === 3) return 120;
    if (consecutiveFailures === 2) return 30;
    return 0;
}

function refreshStallsPerMin(record: LineHealthRecord, nowMs: number): void {
    const oneMinuteAgo = nowMs - 60_000;
    record.stallEvents = record.stallEvents.filter((ts) => ts >= oneMinuteAgo);
    record.stallsPerMin = record.stallEvents.length;
}

export function noteLineStartupSuccess(record: LineHealthRecord, ttffMs: number, nowMs: number): void {
    record.successStarts += 1;
    record.consecutiveFailures = 0;
    record.quarantineUntil = 0;
    if (ttffMs > 0) {
        if (record.avgTtffMs <= 0) {
            record.avgTtffMs = ttffMs;
        } else {
            record.avgTtffMs = record.avgTtffMs * 0.8 + ttffMs * 0.2;
        }
    }
    refreshStallsPerMin(record, nowMs);
}

export function noteLineStall(record: LineHealthRecord, nowMs: number): void {
    record.stallEvents.push(nowMs);
    refreshStallsPerMin(record, nowMs);
}

export function noteLineRecoveryFailure(record: LineHealthRecord, nowMs: number): void {
    record.recoveryFailures += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = nowMs;
    const waitSecs = quarantineSecondsByFailures(record.consecutiveFailures);
    if (waitSecs > 0) {
        record.quarantineUntil = nowMs + waitSecs * 1000;
        record.lastProbeAt = nowMs;
    }
}

export function noteLineAutoSwitchFailure(record: LineHealthRecord, nowMs: number): void {
    record.autoSwitchFailures += 1;
    record.consecutiveFailures += 1;
    record.lastFailureAt = nowMs;
    const waitSecs = quarantineSecondsByFailures(record.consecutiveFailures);
    if (waitSecs > 0) {
        record.quarantineUntil = nowMs + waitSecs * 1000;
        record.lastProbeAt = nowMs;
    }
}

export function noteLineHardFailure(record: LineHealthRecord, nowMs: number): void {
    record.autoSwitchFailures += 3;
    record.consecutiveFailures = Math.max(record.consecutiveFailures, 4);
    record.lastFailureAt = nowMs;
    record.quarantineUntil = nowMs + 300_000;
    record.lastProbeAt = nowMs;
}

export function isLineQuarantined(record: LineHealthRecord, nowMs: number): boolean {
    return record.quarantineUntil > nowMs;
}

export function canHalfOpenProbe(record: LineHealthRecord, nowMs: number): boolean {
    if (record.quarantineUntil <= nowMs) return true;
    if (record.lastProbeAt <= 0) return false;
    return nowMs - record.lastProbeAt >= 90_000;
}

export function markHalfOpenProbe(record: LineHealthRecord, nowMs: number): void {
    record.lastProbeAt = nowMs;
}

export function computeStartupTargetSec(
    metrics: ProxyMetricsLike | null | undefined,
    lineHealthScore: number
): number {
    const avgSegmentMs = metrics?.avg_segment_ms ?? 0;
    const bytesPerSecond = metrics?.bytes_per_second ?? 0;
    const cacheHits = metrics?.cache_hits ?? 0;
    const cacheMisses = metrics?.cache_misses ?? 0;
    const total = cacheHits + cacheMisses;
    const cacheMissRatio = total > 0 ? cacheMisses / total : 0;

    let target = 10;
    if (avgSegmentMs > 2500) target += 1;
    if (avgSegmentMs > 4500) target += 1;
    if (cacheMissRatio > 0.2) target += 1;
    if (cacheMissRatio > 0.35) target += 1;
    if (bytesPerSecond > 0 && bytesPerSecond < 700 * 1024) target += 1;
    if (bytesPerSecond > 0 && bytesPerSecond < 450 * 1024) target += 1;
    if (lineHealthScore > 80) target -= 1;

    return clamp(8, 12, Math.round(target));
}

export function computeStartupTimeoutSec(startupTargetSec: number): number {
    return clamp(22, 34, Math.round(startupTargetSec + 12));
}

export function computeRuntimeBufferTargetSec(startupTargetSec: number): number {
    return clamp(28, 40, Math.round(Math.max(startupTargetSec + 8, 28)));
}

export function isSwitchRateLimited(state: SwitchRateLimiterState, nowMs: number): boolean {
    return state.cooldownUntil > nowMs;
}

export function registerAutoSwitch(
    state: SwitchRateLimiterState,
    nowMs: number,
    windowMs = 90_000,
    limit = 2,
    cooldownMs = 30_000
): boolean {
    state.timestamps = state.timestamps.filter((ts) => nowMs - ts <= windowMs);
    if (state.cooldownUntil > nowMs) {
        return false;
    }
    if (state.timestamps.length >= limit) {
        state.cooldownUntil = nowMs + cooldownMs;
        state.timestamps = [];
        return false;
    }
    state.timestamps.push(nowMs);
    return true;
}
