import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import { LivePlayer } from "@/components/LivePlayer";
import {
  clearBootstrappedLiveLaunchPayload,
  LIVE_PLAYER_WINDOW_LABEL,
  readBootstrappedLiveLaunchPayload,
} from "@/modules/live/services/livePlayerWindow";
import { EVENT_LIVE_PLAYER_LAUNCH, EVENT_LIVE_PLAYER_READY } from "@/modules/shared/services/events";
import { emitWindowReady } from "@/modules/shared/services/windowLaunchHandshake";
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
    return createLaunchState(payload);
  });
  const [isMpvActive, setIsMpvActive] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("halo-live-player-window");
    return () => {
      document.documentElement.classList.remove("halo-live-player-window");
    };
  }, []);

  // Clear bootstrap payload after a successful load to prevent re-consumption
  useEffect(() => {
    if (launch) {
      const t = setTimeout(() => {
        clearBootstrappedLiveLaunchPayload();
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [!!launch]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<LivePlayerLaunchPayload>(EVENT_LIVE_PLAYER_LAUNCH, ({ payload }) => {
      if (!payload) return;
      console.log("[Live Page] Received push launch payload:", payload);
      setLaunch(createLaunchState(payload));
      void getCurrentWindow().setFocus().catch(() => void 0);
    })
      .then((off) => {
        unlisten = off;
      })
      .catch((err) => {
        console.error("[Live Page] Failed to listen for launch event:", err);
      });

    console.log(`[Live Page] Emitting window ready signal for ${LIVE_PLAYER_WINDOW_LABEL}`);
    void emitWindowReady(EVENT_LIVE_PLAYER_READY, LIVE_PLAYER_WINDOW_LABEL).catch((err) => {
      console.error("[Live Page] Failed to emit ready signal:", err);
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
        <div className="rounded-xl border border-white/10 bg-black/50 px-5 py-4 text-sm">
          <div>在主窗口中选择直播频道即可开始播放。</div>
          <button
            className="mt-3 rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10"
            onClick={() => {
              const win = getCurrentWindow();
              void win.close().catch(async () => {
                await win.hide().catch(() => void 0);
                await win.destroy().catch(() => void 0);
              });
            }}
          >
            关闭窗口
          </button>
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
