import { invoke } from "@tauri-apps/api/core";

export interface VodRelaySession {
    sessionId: string;
    localManifestUrl: string;
    expiresAtMs: number;
}

export interface VodRelayStats {
    sessionId: string;
    exists: boolean;
    createdAtMs?: number;
    lastAccessMs?: number;
    idleMs?: number;
    upstreamHost?: string;
}

export async function openVodRelaySession(
    url: string,
    headers: Record<string, string> | null,
    sourceHint?: string,
): Promise<VodRelaySession> {
    return invoke<VodRelaySession>("vod_open_hls_relay_session", {
        url,
        headers,
        sourceHint,
        source_hint: sourceHint,
    });
}

export async function closeVodRelaySession(sessionId: string): Promise<void> {
    await invoke("vod_close_hls_relay_session", { sessionId, session_id: sessionId });
}

export async function getVodRelayStats(sessionId: string): Promise<VodRelayStats> {
    return invoke<VodRelayStats>("vod_get_hls_relay_stats", { sessionId, session_id: sessionId });
}
