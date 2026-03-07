import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { LivePlayer } from "@/components/LivePlayer";
import {
  clearBootstrappedLiveLaunchPayload,
  readBootstrappedLiveLaunchPayload,
} from "@/modules/live/services/livePlayerWindow";
import { EVENT_LIVE_PLAYER_LAUNCH } from "@/modules/shared/services/events";
import type { LivePlayerLaunchPayload } from "@/modules/live/types/liveWindow.types";

type LiveLaunchState = {
  payload: LivePlayerLaunchPayload;
  nonce: number;
};

function createLaunchState(payload: LivePlayerLaunchPayload): LiveLaunchState {
  return {
    payload,
    nonce: Date.now() + Math.random(),
  };
}

export function LivePlayerWindowPage() {
  const [launch, setLaunch] = useState<LiveLaunchState | null>(() => {
    const payload = readBootstrappedLiveLaunchPayload();
    if (!payload) return null;
    clearBootstrappedLiveLaunchPayload();
    return createLaunchState(payload);
  });
  const [isMpvActive, setIsMpvActive] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("halo-live-player-window");
    return () => {
      document.documentElement.classList.remove("halo-live-player-window");
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<LivePlayerLaunchPayload>(EVENT_LIVE_PLAYER_LAUNCH, ({ payload }) => {
      if (!payload) return;
      setLaunch(createLaunchState(payload));
      clearBootstrappedLiveLaunchPayload();
      void getCurrentWindow().setFocus().catch(() => void 0);
    }).then((off) => {
      unlisten = off;
    }).catch(() => {
      void 0;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const playerKey = useMemo(() => {
    if (!launch) return "live-player-empty";
    return `live-player-${launch.nonce}`;
  }, [launch]);

  if (!launch) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-zinc-300">
        <div className="rounded-xl border border-white/10 bg-black/50 px-5 py-3 text-sm">
          在主窗口中选择直播频道即可开始播放。
        </div>
      </div>
    );
  }

  const { payload } = launch;

  return (
    <div className={`h-full w-full overflow-hidden ${isMpvActive ? "bg-transparent" : "bg-black"}`}>
      <LivePlayer
        key={playerKey}
        groups={payload.groups}
        initialGroup={payload.initialGroup}
        initialChannel={payload.initialChannel}
        initialLineIndex={payload.initialLineIndex}
        initialKernelMode={payload.initialKernelMode}
        onMpvActiveChange={setIsMpvActive}
        onClose={() => {
          void getCurrentWindow().close().catch(() => void 0);
        }}
      />
    </div>
  );
}
