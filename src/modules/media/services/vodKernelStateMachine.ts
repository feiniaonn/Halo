import type { VodKernelMode } from "../types/vodWindow.types";

export type VodKernelDisplay =
    | "mpv"
    | "hls-proxy"
    | "hls-direct"
    | "hls-native"
    | "flv"
    | "direct";

export const VOD_KERNEL_MAX_ATTEMPTS = 2;

export const VOD_KERNEL_FAILOVER_ORDER: VodKernelDisplay[] = [
    "mpv",
    "hls-direct",
    "hls-proxy",
    "hls-native",
];

export const VOD_KERNEL_LABELS: Record<VodKernelDisplay, string> = {
    mpv: "MPV",
    "hls-direct": "HLS直连",
    "hls-proxy": "HLS代理",
    "hls-native": "原生HLS",
    flv: "FLV直连",
    direct: "直连视频",
};

export function toVodKernelDisplay(mode: VodKernelMode): VodKernelDisplay {
    if (mode === "proxy") return "hls-proxy";
    if (mode === "direct") return "hls-direct";
    if (mode === "native") return "hls-native";
    return "mpv";
}

export function fromVodKernelDisplay(display: VodKernelDisplay): VodKernelMode {
    if (display === "hls-proxy") return "proxy";
    if (display === "hls-direct") return "direct";
    if (display === "hls-native") return "native";
    if (display === "mpv") return "mpv";
    // Default cases for other kernels like flv or direct video
    return "direct";
}

export function buildVodKernelPlan(startMode: VodKernelMode): VodKernelDisplay[] {
    const startKernel = toVodKernelDisplay(startMode);
    const startIdx = VOD_KERNEL_FAILOVER_ORDER.indexOf(startKernel);
    if (startIdx <= 0) {
        return [...VOD_KERNEL_FAILOVER_ORDER];
    }
    return [
        ...VOD_KERNEL_FAILOVER_ORDER.slice(startIdx),
        ...VOD_KERNEL_FAILOVER_ORDER.slice(0, startIdx),
    ];
}
