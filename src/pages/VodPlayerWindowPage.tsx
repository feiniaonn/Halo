import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { VodPlayer } from "@/components/VodPlayer";
import {
    clearBootstrappedVodLaunchPayload,
    readBootstrappedVodLaunchPayload,
} from "@/modules/media/services/vodPlayerWindow";
import { EVENT_VOD_PLAYER_LAUNCH } from "@/modules/shared/services/events";
import type { VodKernelMode, VodPlayerLaunchPayload } from "@/modules/media/types/vodWindow.types";

type VodLaunchState = {
    payload: VodPlayerLaunchPayload;
    nonce: number;
};

function normalizeKernelMode(mode: unknown): VodKernelMode {
    if (mode === "mpv" || mode === "direct" || mode === "proxy" || mode === "native") {
        return mode;
    }
    return "mpv";
}

function createLaunchState(payload: VodPlayerLaunchPayload): VodLaunchState {
    const normalizedPayload: VodPlayerLaunchPayload = {
        ...payload,
        initialKernelMode: normalizeKernelMode((payload as { initialKernelMode?: unknown }).initialKernelMode),
        sourceKind: payload.sourceKind === "cms" ? "cms" : "spider",
    };
    return { payload: normalizedPayload, nonce: Date.now() + Math.random() };
}

export function VodPlayerWindowPage() {
    const [launch, setLaunch] = useState<VodLaunchState | null>(() => {
        const payload = readBootstrappedVodLaunchPayload();
        if (!payload) return null;
        clearBootstrappedVodLaunchPayload();
        return createLaunchState(payload);
    });

    const [isMpvActive, setIsMpvActive] = useState(false);

    useEffect(() => {
        document.documentElement.classList.add("halo-vod-player-window");
        return () => {
            document.documentElement.classList.remove("halo-vod-player-window");
        };
    }, []);

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        void listen<VodPlayerLaunchPayload>(EVENT_VOD_PLAYER_LAUNCH, ({ payload }) => {
            if (!payload) return;
            setLaunch(createLaunchState(payload));
            clearBootstrappedVodLaunchPayload();
            void getCurrentWindow().setFocus().catch(() => void 0);
        })
            .then((off) => { unlisten = off; })
            .catch(() => void 0);
        return () => { unlisten?.(); };
    }, []);

    const playerKey = useMemo(() => {
        if (!launch) return "vod-player-empty";
        return `vod-player-${launch.nonce}`;
    }, [launch]);

    if (!launch) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-black text-zinc-300">
                <div className="rounded-xl border border-white/10 bg-black/50 px-5 py-3 text-sm">
                    在主窗口中选择影视内容即可开始播放。
                </div>
            </div>
        );
    }

    const { payload } = launch;

    return (
        <div className={`h-full w-full overflow-hidden ${isMpvActive ? "bg-transparent" : "bg-black"}`}>
            <VodPlayer
                key={playerKey}
                sourceKind={payload.sourceKind}
                spiderUrl={payload.spiderUrl}
                siteName={payload.siteName}
                siteKey={payload.siteKey}
                apiClass={payload.apiClass}
                ext={payload.ext}
                playUrl={payload.playUrl}
                click={payload.click}
                playerType={payload.playerType}
                detail={payload.detail}
                routes={payload.routes}
                initialRouteIdx={payload.initialRouteIdx}
                initialEpisodeIdx={payload.initialEpisodeIdx}
                initialKernelMode={payload.initialKernelMode}
                parses={payload.parses}
                requestHeaders={payload.requestHeaders}
                playbackRules={payload.playbackRules}
                proxyDomains={payload.proxyDomains}
                hostMappings={payload.hostMappings}
                adHosts={payload.adHosts}
                onMpvActiveChange={setIsMpvActive}
                onClose={() => {
                    const win = getCurrentWindow();
                    void win.close().catch(async () => {
                        await win.hide().catch(() => void 0);
                        await win.destroy().catch(() => void 0);
                    });
                }}
            />
        </div>
    );
}
