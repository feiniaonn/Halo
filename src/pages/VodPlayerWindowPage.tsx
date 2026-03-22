import { useEffect, useMemo, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';

import { VodPlayer } from '@/components/VodPlayer';
import {
  clearBootstrappedVodLaunchPayload,
  readBootstrappedVodLaunchPayload,
  VOD_PLAYER_WINDOW_LABEL,
} from '@/modules/media/services/vodPlayerWindow';
import { EVENT_VOD_PLAYER_LAUNCH, EVENT_VOD_PLAYER_READY } from '@/modules/shared/services/events';
import { emitWindowReady } from '@/modules/shared/services/windowLaunchHandshake';
import type { VodKernelMode, VodPlayerLaunchPayload } from '@/modules/media/types/vodWindow.types';

type VodLaunchState = {
  payload: VodPlayerLaunchPayload;
  nonce: number;
};

function normalizeKernelMode(mode: unknown): VodKernelMode {
  if (mode === 'mpv' || mode === 'direct' || mode === 'proxy') {
    return mode;
  }
  return 'direct';
}

function createLaunchState(payload: VodPlayerLaunchPayload): VodLaunchState {
  const normalizedPayload: VodPlayerLaunchPayload = {
    ...payload,
    initialKernelMode: normalizeKernelMode(
      (payload as { initialKernelMode?: unknown }).initialKernelMode,
    ),
    sourceKind: payload.sourceKind === 'cms' ? 'cms' : 'spider',
  };
  return { payload: normalizedPayload, nonce: Date.now() + Math.random() };
}

export function VodPlayerWindowPage() {
  const [launch, setLaunch] = useState<VodLaunchState | null>(() => {
    const payload = readBootstrappedVodLaunchPayload();
    if (!payload) return null;
    return createLaunchState(payload);
  });

  useEffect(() => {
    document.documentElement.classList.add('halo-vod-player-window');
    return () => {
      document.documentElement.classList.remove('halo-vod-player-window');
    };
  }, []);

  useEffect(() => {
    if (!launch) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      clearBootstrappedVodLaunchPayload();
    }, 2000);
    return () => clearTimeout(timer);
  }, [launch]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<VodPlayerLaunchPayload>(EVENT_VOD_PLAYER_LAUNCH, ({ payload }) => {
      if (!payload) return;
      console.log('[VOD Page] Received push launch payload:', payload);
      setLaunch(createLaunchState(payload));
      void getCurrentWindow()
        .setFocus()
        .catch(() => void 0);
    })
      .then((off) => {
        unlisten = off;
      })
      .catch((err) => {
        console.error('[VOD Page] Failed to listen for launch event:', err);
      });

    console.log(`[VOD Page] Emitting window ready signal for ${VOD_PLAYER_WINDOW_LABEL}`);
    void emitWindowReady(EVENT_VOD_PLAYER_READY, VOD_PLAYER_WINDOW_LABEL).catch((err) => {
      console.error('[VOD Page] Failed to emit ready signal:', err);
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const playerKey = useMemo(() => {
    if (!launch) return 'vod-player-empty';
    return `vod-player-${launch.nonce}`;
  }, [launch]);

  if (!launch) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black text-zinc-300">
        <div className="rounded-xl border border-white/10 bg-black/50 px-5 py-4 text-sm">
          <div>����������ѡ��Ӱ�����ݼ��ɿ�ʼ���š�</div>
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
            �رմ���
          </button>
        </div>
      </div>
    );
  }

  const { payload } = launch;

  return (
    <div className="h-full w-full overflow-hidden bg-transparent">
      <VodPlayer
        key={playerKey}
        sourceKey={payload.sourceKey}
        repoUrl={payload.repoUrl}
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
        onMpvActiveChange={() => {}}
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
