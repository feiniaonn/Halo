import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Hls, { type HlsConfig } from 'hls.js';
import { cn } from '@/lib/utils';
import { VodProxyImage } from '@/components/VodProxyImage';
import { VodPlaybackDiagnosticsPanel } from '@/modules/media/components/VodPlaybackDiagnosticsPanel';
import {
  buildVodKernelPlan,
  type VodKernelDisplay,
  VOD_KERNEL_LABELS,
} from '@/modules/media/services/vodKernelStateMachine';
import {
  clearSpiderPlayerPayloadCache,
  formatPlaybackTime,
  getVodPlaybackDiagnostics,
  resolveEpisodePlayback,
  withTimeout,
} from '@/modules/media/services/vodPlayback';
import { waitForBrowserVideoStartup } from '@/modules/media/services/vodBrowserVideoStartup';
import {
  buildPlaybackResolutionFailureLog,
  buildPlaybackResolutionLog,
} from '@/modules/media/services/vodPlaybackLogging';
import type { VodPlaybackDiagnosticsReport } from '@/modules/media/services/vodPlaybackDiagnosticsView';
import {
  acquireVodPlaybackLock,
  buildVodPlaybackLockKey,
  releaseVodPlaybackLock,
} from '@/modules/media/services/vodPlaybackSingleflight';
import {
  commandNativePlayer,
  destroyNativePlayer,
  getNativePlayerStatus,
  initOrAttachNativePlayer,
  loadNativePlayer,
  resizeNativePlayer,
  type NativeHostBounds,
  type NativePlayerEngine,
  type NativePlayerLoadResult,
} from '@/modules/media/services/vodNativePlayer';
import {
  readVodRelayStatsSummary,
  waitForNativePlayerReady,
} from '@/modules/media/services/vodNativeKernelHealth';
import {
  closeVodRelaySession,
  getVodRelayStats,
  openVodRelaySession,
} from '@/modules/media/services/vodMpvRelayClient';
import {
  inferVodStreamKind,
  probeVodStream,
  type VodStreamKind,
  type VodStreamProbeResult,
} from '@/modules/media/services/vodStreamProbe';

import type {
  TvBoxHostMapping,
  TvBoxParse,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
  VodKernelMode,
  VodRoute,
  VodEpisode,
  VodDetail,
  VodSourceKind,
} from '@/modules/media/types/vodWindow.types';

const VOD_WINDOW_LABEL = 'vod_player';
const NATIVE_PLAYER_STATUS_POLL_MS = 300;
const NATIVE_PLAYER_STARTUP_TIMEOUT_MS = 20_000;
const HLS_STARTUP_TIMEOUT_MS = 15_000;
const DIRECT_STARTUP_TIMEOUT_MS = 12_000;
const VIDEO_ELEMENT_WAIT_TIMEOUT_MS = 1_500;

interface KernelAttemptResult {
  ok: boolean;
  reason?: string;
  retryable: boolean;
}

function inferReasonCode(reason: string): string {
  const lower = reason.toLowerCase();
  if (lower.includes('403')) return 'upstream_403';
  if (lower.includes('404')) return 'upstream_404';
  if (lower.includes('not m3u8')) return 'invalid_hls_manifest';
  if (lower.includes('timed out')) return 'startup_timeout';
  if (lower.includes('hls')) return 'hls_error';
  if (lower.includes('mpv')) return 'mpv_error';
  if (lower.includes('direct')) return 'direct_error';
  return 'unknown';
}

const KERNEL_MODE_OPTIONS: Array<{ value: VodKernelMode; label: string }> = [
  { value: 'direct', label: 'HLS 直连' },
  { value: 'proxy', label: 'HLS 代理' },
  { value: 'mpv', label: 'MPV 内核' },
  { value: 'potplayer', label: 'PotPlayer' },
];

export interface VodPlayerProps {
  sourceKey?: string;
  repoUrl?: string;
  sourceKind: VodSourceKind;
  spiderUrl: string;
  siteName?: string;
  siteKey: string;
  apiClass: string;
  ext: string;
  playUrl?: string;
  click?: string;
  playerType?: string;
  detail: VodDetail | null;
  routes: VodRoute[];
  initialRouteIdx: number;
  initialEpisodeIdx: number;
  initialKernelMode: VodKernelMode;
  parses?: TvBoxParse[];
  requestHeaders?: TvBoxRequestHeaderRule[];
  playbackRules?: TvBoxPlaybackRule[];
  proxyDomains?: string[];
  hostMappings?: TvBoxHostMapping[];
  adHosts?: string[];
  onClose?: () => void;
  onMpvActiveChange?: (active: boolean) => void;
}

export function VodPlayer({
  sourceKey,
  repoUrl,
  sourceKind,
  spiderUrl,
  siteName,
  siteKey,
  apiClass,
  ext,
  playUrl,
  click,
  playerType,
  detail,
  routes,
  initialRouteIdx,
  initialEpisodeIdx,
  initialKernelMode: _initialKernelMode,
  parses,
  requestHeaders,
  playbackRules,
  proxyDomains: _proxyDomains,
  hostMappings,
  adHosts,
  onClose,
  onMpvActiveChange,
}: VodPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const attemptTokenRef = useRef(0);
  const playbackInstanceIdRef = useRef(
    `vod-player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const activePlaybackLockRef = useRef<{ key: string; token: string } | null>(null);
  const destroyPlayerPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const noticeTimeoutRef = useRef<number | null>(null);
  const playRequestIdRef = useRef(0);
  const activeHeadersRef = useRef<Record<string, string> | null>(null);
  const streamProbeCacheRef = useRef(new Map<string, Promise<VodStreamProbeResult>>());
  const nativeEngineRef = useRef<NativePlayerEngine | null>(null);
  const mpvRelaySessionIdRef = useRef<string | null>(null);

  const dragRegionStyle = useMemo(() => ({ WebkitAppRegion: 'drag' }) as CSSProperties, []);
  const noDragRegionStyle = useMemo(() => ({ WebkitAppRegion: 'no-drag' }) as CSSProperties, []);

  const [activeRouteIdx, setActiveRouteIdx] = useState(initialRouteIdx);
  const [activeEpisodeIdx, setActiveEpisodeIdx] = useState(initialEpisodeIdx);
  const [kernelMode, setKernelMode] = useState<VodKernelMode>('direct');
  const kernelModeRef = useRef<VodKernelMode>('direct');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const [isNativePlayerActive, setIsNativePlayerActive] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [aspectRatioIdx, setAspectRatioIdx] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [playbackDiagnosticsReport, setPlaybackDiagnosticsReport] =
    useState<VodPlaybackDiagnosticsReport | null>(null);

  const ASPECT_RATIOS = useMemo(
    () => [
      { label: '原始比例', value: -1 },
      { label: '4:3', value: 4 / 3 },
      { label: '16:9', value: 16 / 9 },
      { label: '21:9', value: 21 / 9 },
    ],
    [],
  );

  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      }),
    [],
  );

  const waitForVideoElement = useCallback(async (): Promise<HTMLVideoElement | null> => {
    const deadline = performance.now() + VIDEO_ELEMENT_WAIT_TIMEOUT_MS;
    while (performance.now() < deadline) {
      const video = videoRef.current;
      if (video) {
        return video;
      }
      await sleep(16);
    }
    return videoRef.current;
  }, [sleep]);

  const activeRoute = routes[activeRouteIdx] ?? null;
  const activeEpisode: VodEpisode | null = activeRoute?.episodes[activeEpisodeIdx] ?? null;

  const termLog = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    console[level](message);
    invoke('rust_log', { message, level }).catch(() => void 0);
  }, []);

  const appendMpvTestLog = useCallback((message: string) => {
    invoke('append_mpv_test_log', { message }).catch(() => void 0);
  }, []);

  const showPlaybackNotice = useCallback((text: string | null) => {
    setPlaybackNotice(text);
    if (noticeTimeoutRef.current) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
    if (text) {
      noticeTimeoutRef.current = window.setTimeout(() => {
        setPlaybackNotice(null);
        noticeTimeoutRef.current = null;
      }, 3200);
    }
  }, []);

  const updatePlaybackDiagnosticsReport = useCallback((
    report: Omit<VodPlaybackDiagnosticsReport, 'updatedAt'>,
  ) => {
    setPlaybackDiagnosticsReport({
      ...report,
      updatedAt: Date.now(),
    });
  }, []);

  const TauriHlsLoader = useMemo(() => {
    return class extends (Hls.DefaultConfig.loader as unknown as new (c: unknown) => {
      load: (ctx: unknown, cfg: unknown, cbs: unknown) => void;
    }) {
      constructor(config: unknown) {
        super(config);
        const originalLoad = this.load.bind(this);
        this.load = async (context: unknown, config: unknown, callbacks: unknown) => {
          const ctx = context as {
            url: string;
            type?: string;
            responseType?: string;
            frag?: unknown;
            keyInfo?: unknown;
          };
          const cbs = callbacks as {
            onSuccess: (
              response: { url: string; data: ArrayBuffer | string },
              stats: unknown,
              ctx: unknown,
              networkDetails?: unknown,
            ) => void;
            onError: (
              error: { code: number; text: string },
              ctx: unknown,
              networkDetails?: unknown,
              stats?: unknown,
            ) => void;
          };
          const now = performance.now();
          const makeStats = (loaded = 0) => ({
            aborted: false,
            loaded,
            total: loaded,
            retry: 0,
            chunkCount: 0,
            bwEstimate: 0,
            loading: { start: now, first: now, end: now },
            parsing: { start: now, end: now },
            buffering: { start: now, first: now, end: now },
          });
          const url = ctx.url;
          const isManifest =
            ctx.type === 'manifest' ||
            ctx.type === 'level' ||
            ctx.type === 'audioTrack' ||
            ctx.type === 'subtitleTrack';
          const isBinary =
            ctx.responseType === 'arraybuffer' ||
            ctx.frag !== undefined ||
            ctx.keyInfo !== undefined;

          if (isManifest || isBinary) {
            try {
              if (isManifest) {
                const text = await invoke<string>('proxy_hls_manifest', {
                  url,
                  headers: activeHeadersRef.current,
                  playbackRules,
                  blockedHosts: adHosts,
                });
                cbs.onSuccess({ url, data: text }, makeStats(text.length), context, null);
                return;
              }
              if (isBinary) {
                const headers = { ...(activeHeadersRef.current ?? {}) };
                const b64 = await invoke<string>('proxy_hls_segment', {
                  url,
                  headers: Object.keys(headers).length > 0 ? headers : null,
                  playbackRules,
                  blockedHosts: adHosts,
                });
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1) {
                  bytes[i] = binary.charCodeAt(i);
                }
                cbs.onSuccess({ url, data: bytes.buffer }, makeStats(bytes.length), context, null);
                return;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              cbs.onError({ code: 0, text: message }, context, null, makeStats(0));
              return;
            }
          }

          originalLoad(context, config, callbacks);
        };
      }
    };
  }, [adHosts, playbackRules]);

  const measureNativeHostBounds = useCallback(async (): Promise<NativeHostBounds> => {
    if (!viewportRef.current) {
      throw new Error('native host viewport unavailable');
    }
    const rect = viewportRef.current.getBoundingClientRect();
    const factor = window.devicePixelRatio || 1;
    const win = getCurrentWindow();
    const innerPos = await withTimeout(win.innerPosition(), 800, 'inner position').catch(() => ({
      x: 0,
      y: 0,
    }));
    return {
      x: Math.round(innerPos.x + rect.left * factor),
      y: Math.round(innerPos.y + rect.top * factor),
      width: Math.max(1, Math.round(rect.width * factor)),
      height: Math.max(1, Math.round(rect.height * factor)),
      dpiScale: factor,
    };
  }, []);

  const releaseActivePlaybackLock = useCallback(() => {
    if (!activePlaybackLockRef.current) {
      return;
    }
    releaseVodPlaybackLock(
      activePlaybackLockRef.current.key,
      activePlaybackLockRef.current.token,
    );
    activePlaybackLockRef.current = null;
  }, []);

  const destroyPlayer = useCallback(
    async (options?: { preservePlaybackLock?: boolean }) => {
      const preservePlaybackLock = options?.preservePlaybackLock ?? false;
      const pendingDestroy = destroyPlayerPromiseRef.current
        .catch(() => undefined)
        .then(async () => {
          attemptTokenRef.current += 1;
          if (!preservePlaybackLock) {
            releaseActivePlaybackLock();
          }
          hlsRef.current?.destroy();
          hlsRef.current = null;
          activeHeadersRef.current = null;
          nativeEngineRef.current = null;
          const relaySessionId = mpvRelaySessionIdRef.current;
          mpvRelaySessionIdRef.current = null;
          if (relaySessionId) {
            await closeVodRelaySession(relaySessionId).catch(() => void 0);
          }
          await destroyNativePlayer(VOD_WINDOW_LABEL).catch(() => void 0);
          const video = videoRef.current;
          if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
          }
          setIsNativePlayerActive(false);
          setPlaybackPosition(0);
          setPlaybackDuration(0);
        });

      destroyPlayerPromiseRef.current = pendingDestroy;
      await pendingDestroy;
    },
    [releaseActivePlaybackLock],
  );

  useEffect(() => {
    onMpvActiveChange?.(isNativePlayerActive);
    return () => onMpvActiveChange?.(false);
  }, [isNativePlayerActive, onMpvActiveChange]);

  useEffect(() => {
    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const syncPosition = () => {
      if (isNativePlayerActive) return;
      setPlaybackPosition(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    };
    const syncDuration = () => {
      if (isNativePlayerActive) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      setPlaybackDuration(duration);
    };
    const syncPaused = () => {
      if (isNativePlayerActive) return;
      setIsPaused(video.paused);
    };

    const syncFullscreenState = async () => {
      const win = getCurrentWindow();
      const fs = await win.isFullscreen();
      setIsFullscreen(fs);
    };

    video.addEventListener('timeupdate', syncPosition);
    video.addEventListener('loadedmetadata', syncDuration);
    video.addEventListener('durationchange', syncDuration);
    video.addEventListener('play', syncPaused);
    video.addEventListener('pause', syncPaused);
    video.addEventListener('playing', syncPaused);

    const unlistenFs = getCurrentWindow().onResized(() => {
      void syncFullscreenState();
    });

    return () => {
      video.removeEventListener('timeupdate', syncPosition);
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('durationchange', syncDuration);
      video.removeEventListener('play', syncPaused);
      video.removeEventListener('pause', syncPaused);
      video.removeEventListener('playing', syncPaused);
      void unlistenFs.then((u) => u());
    };
  }, [isNativePlayerActive]);

  useEffect(() => {
    if (!isNativePlayerActive) {
      return undefined;
    }

    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const status = await getNativePlayerStatus(VOD_WINDOW_LABEL);
          if (cancelled) {
            return;
          }
          setPlaybackPosition((status.positionMs ?? 0) / 1000);
          setPlaybackDuration((status.durationMs ?? 0) / 1000);
          setIsPaused(status.state === 'paused');
          setIsFullscreen(status.fullscreen ?? false);
          if (status.state === 'error' && status.errorMessage) {
            setError(status.errorMessage);
            showPlaybackNotice(null);
            setLoading(false);
            setIsNativePlayerActive(false);
            nativeEngineRef.current = null;
            return;
          }
          if (status.state === 'ended' && !status.firstFrameRendered) {
            setIsNativePlayerActive(false);
            nativeEngineRef.current = null;
            return;
          }
        } catch {
          // Best-effort status polling only.
        }
        await sleep(NATIVE_PLAYER_STATUS_POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [isNativePlayerActive, showPlaybackNotice, sleep]);

  useEffect(() => {
    if (!isNativePlayerActive || !nativeEngineRef.current) {
      return undefined;
    }
    const target = viewportRef.current;
    if (!target || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    let cancelled = false;
    const syncBounds = async () => {
      if (cancelled || !nativeEngineRef.current) {
        return;
      }
      try {
        const bounds = await measureNativeHostBounds();
        await resizeNativePlayer(VOD_WINDOW_LABEL, bounds);
      } catch {
        // Ignore transient resize failures.
      }
    };

    void syncBounds();
    const observer = new ResizeObserver(() => {
      void syncBounds();
    });
    observer.observe(target);
    window.addEventListener('resize', syncBounds);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  }, [isNativePlayerActive, measureNativeHostBounds]);

  const fetchEpisodePlayback = useCallback(
    async (episode: VodEpisode, routeName: string) => {
      return resolveEpisodePlayback(
        {
          sourceKey,
          repoUrl,
          sourceKind,
          spiderUrl,
          siteName,
          siteKey,
          apiClass,
          ext,
          playUrl,
          click,
          playerType,
          parses,
          playbackRules,
          requestHeaders,
          hostMappings,
        },
        episode,
        routeName,
      );
    },
    [
      apiClass,
      click,
      ext,
      hostMappings,
      parses,
      playbackRules,
      playUrl,
      playerType,
      requestHeaders,
      repoUrl,
      siteKey,
      siteName,
      sourceKey,
      sourceKind,
      spiderUrl,
    ],
  );

  const probeResolvedStream = useCallback(
    async (url: string, headers: Record<string, string> | null): Promise<VodStreamProbeResult> => {
      const cacheKey = JSON.stringify([url, headers ?? {}]);
      const existing = streamProbeCacheRef.current.get(cacheKey);
      if (existing) {
        return existing;
      }

      const pending = probeVodStream(url, headers).catch((error) => {
        streamProbeCacheRef.current.delete(cacheKey);
        throw error;
      });
      streamProbeCacheRef.current.set(cacheKey, pending);
      return pending;
    },
    [],
  );

  const attemptPlayUrl = useCallback(
    async (
      url: string,
      headers: Record<string, string> | null,
      forcedKernel: VodKernelDisplay,
      sourceHint: string,
      streamKindHint: VodStreamKind,
    ): Promise<KernelAttemptResult> => {
      await destroyPlayer({ preservePlaybackLock: true });

      const attemptId = attemptTokenRef.current;
      activeHeadersRef.current = headers;

      const lowerUrl = url.toLowerCase();
      const isM3u8 = streamKindHint === 'hls' || lowerUrl.includes('.m3u8');

      if (forcedKernel === 'potplayer') {
        try {
          let launchUrl = url;
          let launchHeaders = headers;

          if (isM3u8) {
            const relaySession = await openVodRelaySession(url, headers, sourceHint);
            launchUrl = relaySession.localManifestUrl;
            launchHeaders = null;
            termLog(
              `[VodPlayer] potplayer relay open session=${relaySession.sessionId} local_manifest=${relaySession.localManifestUrl}`,
              'info',
            );
          }

          await invoke('launch_potplayer', { url: launchUrl, headers: launchHeaders });
          return { ok: true, retryable: false };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { ok: false, retryable: false, reason: message };
        }
      }

      if (forcedKernel === 'mpv') {
        let relaySessionId: string | null = null;
        try {
          const engine: NativePlayerEngine = 'mpv';
          let nativeUrl = url;
          let transportMode: 'direct' | 'proxy' = 'direct';
          if (isM3u8) {
            const relaySession = await openVodRelaySession(url, headers, sourceHint);
            relaySessionId = relaySession.sessionId;
            mpvRelaySessionIdRef.current = relaySession.sessionId;
            nativeUrl = relaySession.localManifestUrl;
            transportMode = 'proxy';
            termLog(
              `[VodPlayer] mpv relay open session=${relaySession.sessionId} local_manifest=${relaySession.localManifestUrl}`,
              'info',
            );
          }
          const startMpvLoad = async (
            requestUrl: string,
            requestTransportMode: 'direct' | 'proxy',
            activeRelaySessionId: string | null,
          ) => {
            const bounds = await measureNativeHostBounds();
            await initOrAttachNativePlayer(VOD_WINDOW_LABEL, engine, bounds);
            const loadedResult: NativePlayerLoadResult = await loadNativePlayer(VOD_WINDOW_LABEL, {
              url: requestUrl,
              headers,
              title: sourceHint,
              transportMode: requestTransportMode,
            });
            const warmupSummary = await waitForNativePlayerReady(
              engine,
              activeRelaySessionId,
              NATIVE_PLAYER_STARTUP_TIMEOUT_MS,
            );
            return {
              warmupSummary,
              ignoredHeaders: loadedResult.ignoredHeaders,
            };
          };

          termLog(`[VodPlayer] init start kernel=${engine} url=${url}`, 'info');
          appendMpvTestLog(`[vod][native] init start kernel=${engine} url=${url}`);
          let warmupSummary: string;
          let ignoredHeaders = 'none';
          try {
            const loadResult = await startMpvLoad(nativeUrl, transportMode, relaySessionId);
            warmupSummary = loadResult.warmupSummary;
            ignoredHeaders = loadResult.ignoredHeaders.join(',') || 'none';
          } catch (error) {
            const relayStats = relaySessionId
              ? await getVodRelayStats(relaySessionId).catch(() => null)
              : null;
            const relayNeverStarted = relayStats
              && relayStats.manifestHits === 0
              && relayStats.segmentHits === 0
              && relayStats.resourceHits === 0;
            if (relaySessionId && relayNeverStarted) {
              termLog(
                `[VodPlayer] mpv relay was never consumed, retrying direct upstream url=${url}`,
                'warn',
              );
              await closeVodRelaySession(relaySessionId).catch(() => void 0);
              if (mpvRelaySessionIdRef.current === relaySessionId) {
                mpvRelaySessionIdRef.current = null;
              }
              relaySessionId = null;
              await destroyNativePlayer(VOD_WINDOW_LABEL).catch(() => void 0);
              nativeEngineRef.current = null;
              setIsNativePlayerActive(false);
              setPlaybackPosition(0);
              setPlaybackDuration(0);
              const loadResult = await startMpvLoad(url, 'direct', null);
              warmupSummary = loadResult.warmupSummary;
              ignoredHeaders = loadResult.ignoredHeaders.join(',') || 'none';
            } else {
              throw error;
            }
          }
          if (attemptId !== attemptTokenRef.current) {
            if (relaySessionId && mpvRelaySessionIdRef.current === relaySessionId) {
              mpvRelaySessionIdRef.current = null;
            }
            if (relaySessionId) {
              await closeVodRelaySession(relaySessionId).catch(() => void 0);
            }
            return {
              ok: false,
              retryable: false,
              reason: 'playback request superseded',
            };
          }

          nativeEngineRef.current = engine;
          setIsNativePlayerActive(true);
          setPlaybackPosition(0);
          setPlaybackDuration(0);
          setError(null);
          termLog(
            `[VodPlayer] native_player loaded kernel=${engine} ignored_headers=${ignoredHeaders} ${warmupSummary}`,
            'info',
          );
          showPlaybackNotice(`${VOD_KERNEL_LABELS[forcedKernel]} 已启动`);
          return { ok: true, retryable: false };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const relaySummary = await readVodRelayStatsSummary(relaySessionId);
          if (attemptId !== attemptTokenRef.current) {
            if (relaySessionId && mpvRelaySessionIdRef.current === relaySessionId) {
              mpvRelaySessionIdRef.current = null;
            }
            if (relaySessionId) {
              await closeVodRelaySession(relaySessionId).catch(() => void 0);
            }
            return {
              ok: false,
              retryable: false,
              reason: 'playback request superseded',
            };
          }
          if (relaySessionId) {
            await closeVodRelaySession(relaySessionId).catch(() => void 0);
            if (mpvRelaySessionIdRef.current === relaySessionId) {
              mpvRelaySessionIdRef.current = null;
            }
          }
          nativeEngineRef.current = null;
          setIsNativePlayerActive(false);
          return {
            ok: false,
            retryable: false,
            reason: `MPV startup failed: ${message} (${relaySummary})`,
          };
        }
      }

      const video = await waitForVideoElement();
      if (!video) {
        return { ok: false, retryable: false, reason: 'video element unavailable' };
      }

      if (forcedKernel === 'hls-proxy' && !isM3u8) {
        return {
          ok: false,
          retryable: false,
          reason: 'Current stream is not HLS, cannot use HLS proxy',
        };
      }

      if (isM3u8 && Hls.isSupported()) {
        const wantsProxy = forcedKernel === 'hls-proxy';
        const customFragmentLoader = TauriHlsLoader as unknown as NonNullable<HlsConfig['fLoader']>;
        const customPlaylistLoader = TauriHlsLoader as unknown as NonNullable<HlsConfig['pLoader']>;

        setIsNativePlayerActive(false);
        nativeEngineRef.current = null;
        termLog(
          `[VodPlayer] init start kernel=${wantsProxy ? 'hls-proxy' : 'hls-direct'} url=${url}`,
          'info',
        );

        const hls = new Hls({
          maxBufferLength: 120,
          maxMaxBufferLength: 1800,
          backBufferLength: 60,
          maxBufferSize: 300 * 1024 * 1024,
          startLevel: -1,
          fLoader: wantsProxy ? customFragmentLoader : undefined,
          pLoader: wantsProxy ? customPlaylistLoader : undefined,
        });

        let manifestBlobUrl: string | null = null;
        let manifestSourceUrl = url;
        try {
          if (wantsProxy) {
            const manifest = await invoke<string>('proxy_hls_manifest', {
              url,
              headers,
              playbackRules,
              blockedHosts: adHosts,
            });
            const baseDir = url.replace(/\/[^/]*$/, '/');
            const rewritten = manifest
              .split('\n')
              .map((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#') || /^https?:\/\//i.test(trimmed)) {
                  return line;
                }
                try {
                  return new URL(trimmed, baseDir).href;
                } catch {
                  return line;
                }
              })
              .join('\n');
            manifestBlobUrl = URL.createObjectURL(
              new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' }),
            );
            manifestSourceUrl = manifestBlobUrl;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          hls.destroy();
          if (manifestBlobUrl) {
            URL.revokeObjectURL(manifestBlobUrl);
          }
          return { ok: false, retryable: false, reason: `HLS preprocess failed: ${message}` };
        }

        const startupResult = await new Promise<KernelAttemptResult>((resolve) => {
          let settled = false;
          let bootstrapTimer: number | null = null;
          let startupPromise: Promise<void> | null = null;

          const cleanup = () => {
            if (bootstrapTimer !== null) {
              window.clearTimeout(bootstrapTimer);
              bootstrapTimer = null;
            }
            hls.off(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
            hls.off(Hls.Events.MANIFEST_PARSED, onManifest);
            hls.off(Hls.Events.ERROR, onHlsError);
          };

          const finish = (result: KernelAttemptResult) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            resolve(result);
          };

          const beginStartupProbe = () => {
            if (startupPromise) {
              return;
            }
            startupPromise = waitForBrowserVideoStartup(video, {
              label: wantsProxy ? 'HLS proxy playback' : 'HLS direct playback',
              timeoutMs: HLS_STARTUP_TIMEOUT_MS,
              isAttemptCurrent: () => attemptId === attemptTokenRef.current,
            })
              .then(() => {
                finish({ ok: true, retryable: false });
              })
              .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                finish({ ok: false, retryable: false, reason: message });
              });
          };

          const onManifest = () => {
            if (attemptId !== attemptTokenRef.current) {
              return;
            }
            if (bootstrapTimer !== null) {
              window.clearTimeout(bootstrapTimer);
              bootstrapTimer = null;
            }
            beginStartupProbe();
            video.play().catch((error) => {
              termLog(`[VodPlayer] HLS play blocked: ${String(error)}`, 'warn');
            });
          };

          const onMediaAttached = () => {
            if (attemptId !== attemptTokenRef.current) {
              finish({ ok: false, retryable: false, reason: 'playback request superseded' });
              return;
            }
            try {
              hls.loadSource(manifestSourceUrl);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              finish({ ok: false, retryable: false, reason: `HLS loadSource failed: ${message}` });
            }
          };

          const onHlsError = (
            _event: unknown,
            data: { fatal?: boolean; type?: string; details?: string },
          ) => {
            if (attemptId !== attemptTokenRef.current) {
              finish({ ok: false, retryable: false, reason: 'playback request superseded' });
              return;
            }
            if (!data.fatal) {
              return;
            }
            const detail = `${data.type ?? 'unknown'}/${data.details ?? 'unknown'}`;
            finish({ ok: false, retryable: false, reason: `HLS fatal error: ${detail}` });
          };

          hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
          hls.on(Hls.Events.MANIFEST_PARSED, onManifest);
          hls.on(Hls.Events.ERROR, onHlsError);
          bootstrapTimer = window.setTimeout(() => {
            finish({
              ok: false,
              retryable: false,
              reason: wantsProxy
                ? 'HLS proxy manifest startup timeout'
                : 'HLS direct manifest startup timeout',
            });
          }, HLS_STARTUP_TIMEOUT_MS);
          hls.attachMedia(video);
        });

        if (manifestBlobUrl) {
          URL.revokeObjectURL(manifestBlobUrl);
        }

        if (startupResult.ok) {
          hlsRef.current = hls;
          setError(null);
          return startupResult;
        }

        hls.destroy();
        hlsRef.current = null;
        return startupResult;
      }

      if (isM3u8) {
        return {
          ok: false,
          retryable: false,
          reason: 'Current runtime does not support direct HLS playback here',
        };
      }

      setIsNativePlayerActive(false);
      nativeEngineRef.current = null;
      termLog(`[VodPlayer] init start kernel=direct url=${url}`, 'info');
      video.src = url;
      try {
        await video.play();
        await waitForBrowserVideoStartup(video, {
          label: 'Direct playback',
          timeoutMs: DIRECT_STARTUP_TIMEOUT_MS,
          isAttemptCurrent: () => attemptId === attemptTokenRef.current,
        });
        setError(null);
        return { ok: true, retryable: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, retryable: false, reason: `Direct playback failed: ${message}` };
      }
    },
    [
      adHosts,
      appendMpvTestLog,
      destroyPlayer,
      measureNativeHostBounds,
      playbackRules,
      showPlaybackNotice,
      termLog,
      TauriHlsLoader,
      waitForVideoElement,
    ],
  );

  const playEpisode = useCallback(
    async (episode: VodEpisode, routeName: string) => {
      const playbackLockKey = `${playbackInstanceIdRef.current}:${buildVodPlaybackLockKey(routeName, episode, kernelModeRef.current)}`;
      if (activePlaybackLockRef.current) {
        releaseVodPlaybackLock(
          activePlaybackLockRef.current.key,
          activePlaybackLockRef.current.token,
        );
        activePlaybackLockRef.current = null;
      }
      const playbackLock = acquireVodPlaybackLock(playbackLockKey);
      if (!playbackLock.acquired) {
      termLog(
        `[VodPlayer] duplicate playback start ignored route=${routeName} episode=${episode.name} kernel=${kernelModeRef.current} age_ms=${playbackLock.ageMs}`,
        'warn',
      );
        appendMpvTestLog(
          `[vod] duplicate playback start ignored route=${routeName} episode=${episode.name} kernel=${kernelModeRef.current} age_ms=${playbackLock.ageMs}`,
        );
        return;
      }
      activePlaybackLockRef.current = { key: playbackLockKey, token: playbackLock.token };

      const requestId = ++playRequestIdRef.current;
      setLoading(true);
      setError(null);
      showPlaybackNotice('正在解析播放地址...');
      setPlaybackPosition(0);
      setPlaybackDuration(0);

      await invoke('clear_mpv_test_log').catch(() => void 0);
      const mpvLogPath = await invoke<string>('get_mpv_test_log_path').catch(() => 'mpv_log.txt');
      appendMpvTestLog(
        `[vod] playback session start route=${routeName} episode=${episode.name} log_path=${mpvLogPath}`,
      );

      let stream;
      try {
        stream = await fetchEpisodePlayback(episode, routeName);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const diagnostics = getVodPlaybackDiagnostics(error);
        if (requestId !== playRequestIdRef.current) {
          termLog(
            `[VodPlayer] stale playback_resolve_failed ignored route=${routeName} episode=${episode.name} reason=${reason}`,
            'warn',
          );
          releaseVodPlaybackLock(playbackLockKey, playbackLock.token);
          if (
            activePlaybackLockRef.current?.key === playbackLockKey &&
            activePlaybackLockRef.current.token === playbackLock.token
          ) {
            activePlaybackLockRef.current = null;
          }
          return;
        }
        const resolveFailLog = buildPlaybackResolutionFailureLog({
          routeName,
          episodeName: episode.name,
          reason,
          diagnostics,
        });
        termLog(resolveFailLog, 'error');
        appendMpvTestLog(resolveFailLog.replace('[VodPlayer]', '[vod]'));
        updatePlaybackDiagnosticsReport({
          routeName,
          episodeName: episode.name,
          status: 'error',
          reason,
          diagnostics,
        });
        setError(`解析播放地址失败：${reason}`);
        showPlaybackNotice(null);
        setLoading(false);
        releaseVodPlaybackLock(playbackLockKey, playbackLock.token);
        if (
          activePlaybackLockRef.current?.key === playbackLockKey &&
          activePlaybackLockRef.current.token === playbackLock.token
        ) {
          activePlaybackLockRef.current = null;
        }
        return;
      }

      if (requestId !== playRequestIdRef.current) {
        releaseVodPlaybackLock(playbackLockKey, playbackLock.token);
        if (
          activePlaybackLockRef.current?.key === playbackLockKey &&
          activePlaybackLockRef.current.token === playbackLock.token
        ) {
          activePlaybackLockRef.current = null;
        }
        return;
      }

      let streamKind: VodStreamKind = 'unknown';
      if (stream.skipProbe) {
        streamKind = inferVodStreamKind(stream.url);
        termLog(
          `[VodPlayer] stream_probe skipped reason=stream_marked_skip_probe infer_kind=${streamKind} final_url=${stream.url}`,
          'info',
        );
      } else {
        try {
          const probe = await probeResolvedStream(stream.url, stream.headers);
          if (requestId !== playRequestIdRef.current) {
            releaseVodPlaybackLock(playbackLockKey, playbackLock.token);
            if (
              activePlaybackLockRef.current?.key === playbackLockKey &&
              activePlaybackLockRef.current.token === playbackLock.token
            ) {
              activePlaybackLockRef.current = null;
            }
            return;
          }
          streamKind = probe.kind;
          if (probe.finalUrl && probe.finalUrl !== stream.url) {
            stream.url = probe.finalUrl;
          }
          termLog(
            `[VodPlayer] stream_probe kind=${probe.kind} probed=${probe.probed} final_url=${probe.finalUrl ?? stream.url} content_type=${probe.contentType ?? 'unknown'} reason=${probe.reason ?? 'none'}`,
            'info',
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          termLog(`[VodPlayer] stream_probe skipped reason=${message}`, 'warn');
        }
      }

      const plannedStreamKind =
        streamKind !== 'unknown' ? streamKind : inferVodStreamKind(stream.url);
      const kernelPlan = buildVodKernelPlan(kernelModeRef.current, {
        streamKind: plannedStreamKind,
      });
      const resolveLog = buildPlaybackResolutionLog({
        routeName,
        episodeName: episode.name,
        stream,
        finalUrl: stream.url,
        streamKind,
        kernelPlan,
      });
      termLog(resolveLog, 'info');
      appendMpvTestLog(resolveLog.replace('[VodPlayer]', '[vod]'));
      termLog(`[VodPlayer] kernel_plan=[${kernelPlan.join(',')}]`, 'info');
      updatePlaybackDiagnosticsReport({
        routeName,
        episodeName: episode.name,
        status: 'success',
        resolvedBy: stream.resolvedBy,
        finalUrl: stream.url,
        diagnostics: getVodPlaybackDiagnostics(stream),
      });

      let lastFailReason = '未知错误';
      try {
        for (let ki = 0; ki < kernelPlan.length; ki++) {
          const selectedKernel = kernelPlan[ki];
          const isLast = ki === kernelPlan.length - 1;
          termLog(
            `[VodPlayer] kernel_attempt start kernel=${selectedKernel} attempt=${ki + 1}/${kernelPlan.length} next_action=fetch_url`,
            'info',
          );
          if (selectedKernel === 'mpv') {
            appendMpvTestLog(`[vod][mpv] kernel=mpv attempt=${ki + 1}/${kernelPlan.length} next_action=fetch_url`);
          }
          showPlaybackNotice(`正在启动 ${VOD_KERNEL_LABELS[selectedKernel]}...`);

          let result: KernelAttemptResult;
          try {
            result = await attemptPlayUrl(stream.url, stream.headers, selectedKernel, routeName, streamKind);
          } catch (err) {
            result = { ok: false, retryable: true, reason: err instanceof Error ? err.message : String(err) };
          }

          if (requestId !== playRequestIdRef.current) return;

          if (result.ok) {
            termLog(`[VodPlayer] kernel_attempt success kernel=${selectedKernel} attempt=${ki + 1}/${kernelPlan.length} next_action=playing`, 'info');
            setError(null);
            showPlaybackNotice(null);
            return;
          }

          lastFailReason = result.reason ?? '未知错误';
          const reasonCode = inferReasonCode(lastFailReason);
          termLog(
            `[VodPlayer] kernel_attempt fail kernel=${selectedKernel} attempt=${ki + 1}/${kernelPlan.length} reason_code=${reasonCode} reason=${lastFailReason} next_action=${isLast ? 'manual_switch' : 'try_next_kernel'}`,
            'warn',
          );
          if (selectedKernel === 'mpv') {
            appendMpvTestLog(`[vod][mpv] kernel=mpv attempt=${ki + 1}/${kernelPlan.length} reason_code=${reasonCode} reason=${lastFailReason} next_action=${isLast ? 'manual_switch' : 'try_next_kernel'}`);
          }
          if (!isLast) {
            showPlaybackNotice(`${VOD_KERNEL_LABELS[selectedKernel]} 失败，尝试 ${VOD_KERNEL_LABELS[kernelPlan[ki + 1]]}...`);
          }
        }

        setError(`所有内核播放失败：${lastFailReason}`);
        showPlaybackNotice('所有内核均失败，请手动切换内核重试');
        termLog(`[VodPlayer] all kernel attempts failed reason=${lastFailReason}`, 'error');
      } finally {
        releaseVodPlaybackLock(playbackLockKey, playbackLock.token);
        if (
          activePlaybackLockRef.current?.key === playbackLockKey &&
          activePlaybackLockRef.current.token === playbackLock.token
        ) {
          activePlaybackLockRef.current = null;
        }
        if (requestId === playRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [
      appendMpvTestLog,
      attemptPlayUrl,
      fetchEpisodePlayback,
      probeResolvedStream,
      showPlaybackNotice,
      termLog,
      updatePlaybackDiagnosticsReport,
    ],
  );

  useEffect(() => {
    if (!activeEpisode || !activeRoute) {
      return undefined;
    }
      const timer = window.setTimeout(() => {
        void playEpisode(activeEpisode, activeRoute.sourceName);
      }, 0);
      return () => {
        playRequestIdRef.current += 1;
        window.clearTimeout(timer);
        void destroyPlayer();
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      playRequestIdRef.current += 1;
      void destroyPlayer();
    },
    [destroyPlayer],
  );

  useEffect(() => {
    if (!onClose) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const seekTo = useCallback(
    async (targetSeconds: number) => {
      const max = playbackDuration > 0 ? playbackDuration : targetSeconds;
      const clamped = Math.max(0, Math.min(targetSeconds, max));

      if (isNativePlayerActive) {
        await commandNativePlayer(VOD_WINDOW_LABEL, 'seek', {
          positionMs: Math.round(clamped * 1000),
        }).catch(() => void 0);
        setPlaybackPosition(clamped);
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.currentTime = clamped;
      setPlaybackPosition(clamped);
    },
    [isNativePlayerActive, playbackDuration],
  );

  const handleSeek = useCallback(
    (rawValue: string) => {
      const next = Number(rawValue);
      if (!Number.isFinite(next)) return;
      void seekTo(next);
    },
    [seekTo],
  );
  
  const togglePlay = useCallback(async () => {
    if (isNativePlayerActive) {
      const nextPaused = !isPaused;
      await commandNativePlayer(VOD_WINDOW_LABEL, nextPaused ? 'pause' : 'play').catch(() => void 0);
      setIsPaused(nextPaused);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, [isNativePlayerActive, isPaused]);

  const cycleAspectRatio = useCallback(async () => {
    const nextIdx = (aspectRatioIdx + 1) % ASPECT_RATIOS.length;
    setAspectRatioIdx(nextIdx);
    const ratio = ASPECT_RATIOS[nextIdx].value;
    if (isNativePlayerActive) {
      await commandNativePlayer(VOD_WINDOW_LABEL, 'set_aspect_ratio', { ratio }).catch(() => void 0);
    }
  }, [aspectRatioIdx, ASPECT_RATIOS, isNativePlayerActive]);

  const toggleFullscreen = useCallback(async () => {
    const window = getCurrentWindow();
    if (isNativePlayerActive) {
      await commandNativePlayer(window.label, 'toggle_fullscreen').catch((err) => {
        console.error('Failed to toggle native fullscreen:', err);
      });
      return;
    }
    const current = await window.isFullscreen();
    await window.setFullscreen(!current).catch((err) => {
      console.error('Failed to toggle webview fullscreen:', err);
    });
    setIsFullscreen(!current);
  }, [isNativePlayerActive]);

  const handleEpisodeClick = useCallback(
    async (routeIdx: number, episodeIdx: number) => {
      const route = routes[routeIdx];
      const episode = route?.episodes[episodeIdx];
      if (!route || !episode) return;
      setActiveRouteIdx(routeIdx);
      setActiveEpisodeIdx(episodeIdx);
      await playEpisode(episode, route.sourceName);
    },
    [playEpisode, routes],
  );

  const handleKernelChange = useCallback(
    (nextMode: VodKernelMode) => {
      setKernelMode(nextMode);
      kernelModeRef.current = nextMode;
      clearSpiderPlayerPayloadCache();
      if (activeEpisode && activeRoute) {
        void playEpisode(activeEpisode, activeRoute.sourceName);
      }
    },
    [activeEpisode, activeRoute, playEpisode],
  );

  const canSeek = playbackDuration > 0.1;
  const sliderMax = canSeek ? playbackDuration : 1;
  const sliderValue = canSeek ? Math.min(playbackPosition, playbackDuration) : 0;

  return (
    <div
      className={cn(
        'relative flex h-full w-full overflow-hidden',
        isNativePlayerActive ? 'bg-transparent' : 'bg-black',
      )}
      data-component="vod-player"
    >
      <div
        className={cn(
          'z-40 flex h-full shrink-0 flex-col border-r border-white/5 bg-zinc-950',
          isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden border-transparent opacity-0',
        )}
      >
        <div
          className={cn(
            'shrink-0 border-b border-white/5 p-3',
            isNativePlayerActive ? 'bg-black/20' : 'bg-zinc-900',
          )}
          style={dragRegionStyle}
        >
          {detail ? (
            <div className="flex items-start gap-3" style={noDragRegionStyle}>
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded bg-zinc-800">
                <VodProxyImage
                  src={detail.vod_pic}
                  alt={detail.vod_name}
                  className="h-full w-full"
                />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-xs font-bold leading-snug text-white">
                  {detail.vod_name}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detail.vod_year && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                      {detail.vod_year}
                    </span>
                  )}
                  {detail.vod_area && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                      {detail.vod_area}
                    </span>
                  )}
                </div>
                {detail.vod_director && (
                  <p className="mt-1 truncate text-[10px] text-white/40">
                    导演：{detail.vod_director}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div
              style={noDragRegionStyle}
              className="flex h-16 items-center justify-center text-xs text-white/30"
            >
              Halo VOD Player
            </div>
          )}
        </div>

        {routes.length > 1 && (
          <div className="shrink-0 border-b border-white/5 px-2 pb-1.5 pt-2">
            <p className="mb-1.5 px-1 text-[10px] uppercase tracking-wider text-white/40">线路</p>
            <div className="flex flex-wrap gap-1">
              {routes.map((route, idx) => (
                <button
                  key={`${route.sourceName}-${idx}`}
                  onClick={() => {
                    setActiveRouteIdx(idx);
                    setActiveEpisodeIdx(0);
                  }}
                  className={cn(
                    'rounded border px-2 py-0.5 text-xs transition-all',
                    activeRouteIdx === idx
                      ? 'border-primary/60 bg-primary font-semibold text-primary-foreground'
                      : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {route.sourceName}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-x-hidden overflow-y-auto p-2">
          <p className="mb-1.5 px-1 text-[10px] uppercase tracking-wider text-white/40">选集</p>
          {activeRoute && activeRoute.episodes.length > 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {activeRoute.episodes.map((episode, idx) => (
                <button
                  key={`${episode.name}-${idx}`}
                  onClick={() => void handleEpisodeClick(activeRouteIdx, idx)}
                  className={cn(
                    'truncate rounded border px-1 py-1.5 text-center text-xs transition-all',
                    activeEpisodeIdx === idx
                      ? 'border-primary/60 bg-primary font-semibold text-primary-foreground shadow-sm shadow-primary/20'
                      : episode.searchOnly
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                        : 'border-white/5 bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white',
                  )}
                  title={episode.name}
                >
                  {episode.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-white/30">当前线路暂无可播放剧集</div>
          )}
        </div>
      </div>

      <div
        className={cn(
          'relative flex h-full flex-1 flex-col overflow-hidden',
          isNativePlayerActive ? 'bg-transparent' : 'bg-black',
        )}
      >
        <div className="shrink-0">
          <div
            data-tauri-drag-region
            className="flex h-11 items-center justify-between gap-3 border-b border-white/10 bg-black px-3"
          >
            <div className="min-w-0 flex items-center gap-2" style={noDragRegionStyle}>
              <button
                onClick={() => setIsSidebarOpen((value) => !value)}
                className={cn(
                  'rounded-md p-1.5 text-white transition-colors hover:bg-white/20',
                  isSidebarOpen ? 'bg-white/10' : '',
                )}
                title="切换侧边栏"
              >
                <svg
                  className="size-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <span className="max-w-[280px] truncate text-xs text-white/90">
                {activeRoute?.sourceName ?? '未命名线路'} · {activeEpisode?.name ?? '未命名剧集'}
              </span>
            </div>

            <div className="shrink-0 flex items-center gap-2" style={noDragRegionStyle}>
              <span className="cursor-default select-none rounded border border-white/5 bg-white/5 px-2 py-0.5 text-xs text-white/80">
                {activeRoute?.sourceName ?? ''}
              </span>

              <select
                value={kernelMode}
                onChange={(event) => handleKernelChange(event.target.value as VodKernelMode)}
                className="cursor-pointer rounded border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-white outline-none transition-colors hover:bg-zinc-800"
                title="切换播放内核"
              >
                {KERNEL_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {onClose && (
                <button
                  onClick={onClose}
                  className="rounded-md border border-white/5 bg-black/20 p-1.5 text-white transition-colors hover:bg-red-500/80"
                  title="关闭播放器"
                >
                  <svg
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="border-b border-white/10 bg-black px-3 py-1.5" style={noDragRegionStyle}>
            <div className="flex items-center gap-3">
              <button
                onClick={() => void togglePlay()}
                className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
                title={isPaused ? '播放' : '暂停'}
              >
                {isPaused ? (
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                ) : (
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                )}
              </button>

              <div className="flex flex-1 items-center gap-2 text-[11px] text-white/85">
                <span className="w-12 text-right tabular-nums">
                  {formatPlaybackTime(sliderValue)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={0.1}
                  value={sliderValue}
                  disabled={!canSeek}
                  onChange={(event) => handleSeek(event.currentTarget.value)}
                  className="flex-1 accent-primary disabled:opacity-50"
                  title="拖动进度"
                />
                <span className="w-12 tabular-nums">{formatPlaybackTime(playbackDuration)}</span>
              </div>

              <button
                onClick={() => void cycleAspectRatio()}
                className="flex h-6 shrink-0 items-center justify-center rounded-md bg-white/10 px-2 text-[10px] font-medium text-white transition-colors hover:bg-white/20"
                title="切换纵横比"
              >
                {ASPECT_RATIOS[aspectRatioIdx].label}
              </button>

              <button
                onClick={() => void toggleFullscreen()}
                className="flex h-6 shrink-0 items-center justify-center rounded-md bg-white/10 px-2 text-[10px] font-medium text-white transition-colors hover:bg-white/20"
                title={isFullscreen ? '退出全屏' : '全屏播放'}
              >
                {isFullscreen ? (
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                  </svg>
                ) : (
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <div
          ref={viewportRef}
          className={cn(
            'relative flex-1 overflow-hidden',
            isNativePlayerActive ? 'bg-transparent' : 'bg-black',
          )}
        >
          <video
            ref={videoRef}
            className={cn(
              'absolute inset-0 h-full w-full object-contain outline-none',
              isNativePlayerActive ? 'pointer-events-none opacity-0' : '',
            )}
            autoPlay
            playsInline
            controls={false}
          />

          {loading && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90">
              <div className="mb-3 size-10 animate-spin rounded-full border-2 border-white/10 border-t-primary" />
              <span className="text-xs text-white/60">播放器正在加载...</span>
            </div>
          )}

          {playbackNotice && !loading && (
            <div className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full border border-amber-300/30 bg-amber-500/20 px-3 py-1 text-[11px] text-amber-100 shadow-lg backdrop-blur">
              {playbackNotice}
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90">
              <svg
                className="mb-3 size-12 text-red-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <p className="mb-1 text-sm font-bold text-red-50">播放失败</p>
              <p className="mb-4 max-w-xs text-center text-xs text-zinc-400">{error}</p>
              <button
                onClick={() => {
                  if (activeEpisode && activeRoute) {
                    void playEpisode(activeEpisode, activeRoute.sourceName);
                  }
                }}
                className="rounded-md bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/20"
              >
                重试
              </button>
            </div>
          )}

          <VodPlaybackDiagnosticsPanel
            report={playbackDiagnosticsReport}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}
