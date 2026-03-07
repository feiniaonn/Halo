export const MPV_IMAGE_PROBE_FAIL_THRESHOLD = 3;
export const MPV_IMAGE_MIN_OBSERVE_MS = 8_000;

export function shouldIgnoreMpvProbeError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes("property unavailable") ||
        lower.includes("property not found") ||
        lower.includes("property not available")
    );
}

export function isMpvIpcHardError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
        lower.includes("named pipe") ||
        lower.includes("ipc communication error") ||
        lower.includes("os error 2") ||
        lower.includes("connection refused")
    );
}

export function shouldFailForImageProbe(
    imageProbeHits: number,
    probeStartedAtMs: number,
    nowMs: number,
    hasVideoProgress: boolean,
): boolean {
    if (hasVideoProgress) return false;
    if (imageProbeHits < MPV_IMAGE_PROBE_FAIL_THRESHOLD) return false;
    return nowMs - probeStartedAtMs >= MPV_IMAGE_MIN_OBSERVE_MS;
}
