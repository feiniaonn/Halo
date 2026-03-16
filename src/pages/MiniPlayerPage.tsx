import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { cn } from "@/lib/utils";
import { clampPercent } from "@/lib/formatters";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { CoverImage } from "@/modules/music/components/CoverImage";
import { MiniMetricsCanvas, getMiniMetricsCanvasWidth } from "@/modules/music/components/MiniMetricsCanvas";
import { useCurrentPlaying } from "@/modules/music/hooks/useCurrentPlaying";
import { useMusicControl } from "@/modules/music/hooks/useMusicControl";
import { useMusicLyrics } from "@/modules/music/hooks/useMusicLyrics";
import { usePlaybackClock } from "@/modules/music/hooks/usePlaybackClock";
import { getMusicSettings } from "@/modules/music/services/musicService";
import { resolveCurrentLyricText, resolvePlaybackMs } from "@/modules/music/utils/lyrics";
import { useSystemOverview } from "@/modules/dashboard";
import type { MusicMiniVisibleKey, MusicSettings } from "@/modules/music/types/music.types";
import type { MiniRestoreMode } from "@/modules/settings/types/settings.types";

type MiniDensity = "tight" | "compact" | "comfortable";
type MiniMetricSnapshot = {
  cpu: number | null;
  memory: number | null;
  gpu: number | null;
};

function clampValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function SeparatorLine({ className }: { className?: string }) {
  return (
    <div 
      className={cn(
        "h-[58%] w-px shrink-0 bg-linear-to-b from-transparent via-black/10 to-transparent dark:via-white/12", 
        className
      )} 
      aria-hidden 
    />
  );
}

const DEFAULT_MINI_SETTINGS = {
  controlsEnabled: false,
  visibleKeys: ["play_pause", "next"] as MusicMiniVisibleKey[],
  lyricsEnabled: true,
  lyricsOffsetMs: 0,
};

function mapMiniSettings(settings: MusicSettings | null) {
  if (!settings) return DEFAULT_MINI_SETTINGS;
  return {
    controlsEnabled: settings.music_mini_controls_enabled,
    visibleKeys:
      settings.music_mini_visible_keys.length > 0
        ? settings.music_mini_visible_keys
        : DEFAULT_MINI_SETTINGS.visibleKeys,
    lyricsEnabled: settings.music_lyrics_enabled,
    lyricsOffsetMs: settings.music_lyrics_offset_ms,
  };
}

function MiniPreviousIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M19 6 9 12l10 6V6Z" />
      <path d="M5 6v12" />
    </svg>
  );
}

function MiniNextIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m5 6 10 6-10 6V6Z" />
      <path d="M19 6v12" />
    </svg>
  );
}

function MiniPlayIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5v14l11-7L8 5Z" />
    </svg>
  );
}

function MiniPauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}

function pickDensity(width: number, height: number): MiniDensity {
  if (width < 560 || height <= 30) return "tight";
  if (width < 820 || height <= 42) return "compact";
  return "comfortable";
}

export function MiniPlayerPage({
  className,
  onToggleMini,
  isTransitioning = false,
  miniRestoreMode = "both",
  bgType = "none",
  bgPath = null,
  bgBlur = 12,
}: {
  className?: string;
  onToggleMini?: (anchorRect?: { left: number; top: number; width: number; height: number }) => void;
  isTransitioning?: boolean;
  miniRestoreMode?: MiniRestoreMode;
  bgType?: "none" | "image" | "video";
  bgPath?: string | null;
  bgBlur?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [miniSettings, setMiniSettings] = useState(DEFAULT_MINI_SETTINGS);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [metricSnapshot, setMetricSnapshot] = useState<MiniMetricSnapshot>({
    cpu: null,
    memory: null,
    gpu: null,
  });
  const latestMetricSnapshotRef = useRef<MiniMetricSnapshot>({
    cpu: null,
    memory: null,
    gpu: null,
  });

  const { data: current } = useCurrentPlaying();
  const { state: controlState, runCommand, runningCommand } = useMusicControl();
  const playbackTrackKey = `${current?.source_app_id ?? ""}::${current?.artist ?? ""}::${current?.title ?? ""}`;
  const livePlaybackPositionSecs = usePlaybackClock(
    current?.position_secs,
    current?.playback_status,
    current?.duration_secs,
    playbackTrackKey,
  );
  const lyrics = useMusicLyrics({
    current,
    enabled: miniSettings.lyricsEnabled,
    playbackPositionSecs: livePlaybackPositionSecs,
    offsetMs: miniSettings.lyricsOffsetMs,
    autoReview: false,
  });
  const { systemOverview } = useSystemOverview();

  const allowButtonRestore = miniRestoreMode === "button" || miniRestoreMode === "both";
  const allowDoubleClickRestore = miniRestoreMode === "double_click" || miniRestoreMode === "both";

  const effectiveLayoutWidth = layoutWidth > 0 ? layoutWidth : 700;
  const effectiveLayoutHeight = layoutHeight > 0 ? layoutHeight : 50;
  const density = useMemo(
    () => pickDensity(effectiveLayoutWidth, effectiveLayoutHeight),
    [effectiveLayoutHeight, effectiveLayoutWidth],
  );

  const isMusicVisible = useMemo(
    () => Boolean(current?.title && current.playback_status !== "Stopped" && current.playback_status !== "Closed"),
    [current?.title, current?.playback_status],
  );

  const miniLyricText = useMemo(() => {
    if (!miniSettings.lyricsEnabled || !current || !lyrics.response?.ok) {
      return null;
    }
    const playbackMs = resolvePlaybackMs(livePlaybackPositionSecs, miniSettings.lyricsOffsetMs);
    return resolveCurrentLyricText(lyrics.response.lines, playbackMs);
  }, [
    current,
    lyrics.response,
    livePlaybackPositionSecs,
    miniSettings.lyricsEnabled,
    miniSettings.lyricsOffsetMs,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setMiniSettings(DEFAULT_MINI_SETTINGS);
      return;
    }

    const loadMiniSettings = async () => {
      try {
        const settings = await getMusicSettings();
        setMiniSettings(mapMiniSettings(settings));
      } catch {
        setMiniSettings(DEFAULT_MINI_SETTINGS);
      }
    };

    void loadMiniSettings();

    const unlistenPromise = listen<MusicSettings>("music:settings-changed", (event) => {
      setMiniSettings(mapMiniSettings(event.payload ?? null));
    });

    return () => {
      void unlistenPromise.then((fn) => fn()).catch(() => void 0);
    };
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setLayoutWidth(rect.width);
      setLayoutHeight(rect.height);
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const cpuUsageRaw = systemOverview ? clampPercent(systemOverview.cpuUsage) : null;
  const memoryUsageRaw =
    systemOverview && systemOverview.memoryTotalBytes > 0
      ? clampPercent((systemOverview.memoryUsedBytes / systemOverview.memoryTotalBytes) * 100)
      : null;
  const gpuUsageRaw = systemOverview?.gpuUsage == null ? null : clampPercent(systemOverview.gpuUsage);
  const cpuUsage = cpuUsageRaw == null ? null : Math.round(cpuUsageRaw);
  const memoryUsage = memoryUsageRaw == null ? null : Math.round(memoryUsageRaw);
  const gpuUsage = gpuUsageRaw == null ? null : Math.round(gpuUsageRaw);

  useEffect(() => {
    latestMetricSnapshotRef.current = {
      cpu: cpuUsage,
      memory: memoryUsage,
      gpu: gpuUsage,
    };
  }, [cpuUsage, gpuUsage, memoryUsage]);

  useEffect(() => {
    setMetricSnapshot(latestMetricSnapshotRef.current);

    const timer = window.setInterval(() => {
      setMetricSnapshot((prev) => {
        const next = latestMetricSnapshotRef.current;
        if (
          prev.cpu === next.cpu
          && prev.memory === next.memory
          && prev.gpu === next.gpu
        ) {
          return prev;
        }
        return next;
      });
    }, 420);

    return () => window.clearInterval(timer);
  }, []);

  const hasMetricsBlock = Boolean(systemOverview) && effectiveLayoutWidth >= 220 && effectiveLayoutHeight >= 20;
  const showRestoreButton = allowButtonRestore && effectiveLayoutWidth >= 360;
  const hasControlsBlock = miniSettings.controlsEnabled && miniSettings.visibleKeys.length > 0;
  const visibleMetricCount = effectiveLayoutWidth < 520 ? 2 : 3;
  const visibleMetricItems = [
    { label: "CPU", value: metricSnapshot.cpu },
    { label: "MEM", value: metricSnapshot.memory },
    { label: "GPU", value: metricSnapshot.gpu },
  ].slice(0, visibleMetricCount);
  const metricBlockWidth = getMiniMetricsCanvasWidth(effectiveLayoutHeight, visibleMetricItems.length);

  const titleMaxWidth = useMemo(() => {
    let base = effectiveLayoutWidth;
    if (hasMetricsBlock) base -= metricBlockWidth + 40;
    if (hasControlsBlock) base -= 100;
    if (showRestoreButton) base -= 40;
    return Math.max(120, Math.min(base * 0.5, 360));
  }, [effectiveLayoutWidth, hasMetricsBlock, metricBlockWidth, hasControlsBlock, showRestoreButton]);

  const lyricLine = useMemo(() => {
    if (!miniSettings.lyricsEnabled || !lyrics.response?.ok) return null;

    const activeLine = miniLyricText?.trim();
    if (activeLine) return activeLine;

    const firstTimedLine = lyrics.response.lines.find((line) => line.text.trim().length > 0)?.text.trim();
    if (firstTimedLine) return firstTimedLine;

    const firstPlainLine = lyrics.response.plain_text
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return firstPlainLine ?? null;
  }, [lyrics.response, miniLyricText, miniSettings.lyricsEnabled]);

  const playbackProgress = useMemo(() => {
    const duration = current?.duration_secs ?? 0;
    const pos = livePlaybackPositionSecs ?? current?.position_secs ?? 0;
    if (duration <= 0) return 0;
    return Math.min(1, Math.max(0, pos / duration));
  }, [current, livePlaybackPositionSecs]);

  // --- Standalone Background Logic ---
  const hasCustomBg = bgType !== "none" && !!bgPath;
  const backgroundScale = 1.05;
  const normalizedBgBlur = (bgBlur / 100) * 32;

  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (bgType !== "video" || !bgPath) return;
    const el = bgVideoRef.current;
    if (!el) return;
    try {
      el.load();
      void el.play().catch(() => {});
    } catch {}
  }, [bgType, bgPath]);

  const isPlaying = current?.playback_status === "Playing";

  const coverSize = clampValue(
    effectiveLayoutHeight - (density === "tight" ? 8 : density === "compact" ? 12 : 14),
    18,
    42,
  );
  const controlSize = clampValue(
    effectiveLayoutHeight - (density === "tight" ? 10 : 14),
    18,
    32,
  );
  const titleTextClass =
    density === "tight"
      ? "text-[11px]"
      : density === "compact"
        ? "text-[12.5px]"
        : "text-[13.5px]";
  const sublineTextClass =
    density === "tight"
      ? "text-[9px]"
      : density === "compact"
        ? "text-[10.5px]"
        : "text-[11.5px]";

  return (
    <div 
      className={cn(
        "halo-mini-standalone relative flex h-full w-full items-stretch overflow-hidden",
        "bg-white/10 text-foreground backdrop-blur-[24px] dark:bg-black/22",
        className
      )}
    >
      {/* Self-Encapsulated Background */}
      {hasCustomBg && (
        <div className="absolute inset-0 z-[-2] overflow-hidden pointer-events-none">
          {bgType === "image" ? (
            <img
              key={bgPath ?? "none"}
              src={bgPath ?? ""}
              alt="Background"
              className="absolute inset-0 h-full w-full object-cover opacity-72"
              style={{
                filter: `blur(${Math.max(0, normalizedBgBlur * 0.45)}px)`,
                transform: `scale(${Math.max(1.02, backgroundScale - 0.03)})`,
              }}
            />
          ) : (
            <video
              key={bgPath ?? "none"}
              ref={bgVideoRef}
              src={bgPath ?? ""}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover opacity-68"
              style={{
                filter: `blur(${Math.max(0, normalizedBgBlur * 0.35)}px)`,
                transform: `scale(${Math.max(1.02, backgroundScale - 0.02)})`,
              }}
            />
          )}
          <div className="absolute inset-0 bg-black/10 dark:bg-black/25" />
        </div>
      )}

      <div
        ref={containerRef}
        onContextMenu={(event) => event.preventDefault()}
        onDoubleClick={(event) => {
          if (!isTransitioning && allowDoubleClickRestore) {
            onToggleMini?.(event.currentTarget.getBoundingClientRect());
          }
        }}
        className={cn(
          "relative flex h-full w-full select-none items-center justify-center gap-6 px-6",
          className
        )}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_42%,rgba(255,255,255,0.03))] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_42%,rgba(255,255,255,0.01))]" />

        {isMusicVisible && (
          <div className="flex shrink-0 items-center gap-3 overflow-hidden">
            <div className="relative flex shrink-0 items-center justify-center rounded-full overflow-hidden" style={{ width: coverSize + 8, height: coverSize + 8 }}>
              <div 
                className={cn(
                  "overflow-hidden rounded-full border border-white/10 transition-transform duration-700 ease-in-out shadow-lg z-1",
                  isPlaying ? "animate-[spin_8s_linear_infinite] scale-100" : "scale-95"
                )}
                style={{ willChange: "transform", width: coverSize, height: coverSize }}
              >
                <CoverImage
                  coverPath={current?.cover_path ?? null}
                  dataUrl={current?.cover_data_url ?? null}
                  size="md"
                  className="h-full w-full rounded-full object-cover"
                />
              </div>
              
              <svg 
                className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none z-0"
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  className="text-white/5 dark:text-white/10"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeDasharray="263.89"
                  strokeDashoffset={263.89 * (1 - playbackProgress)}
                  className="text-primary/60 dark:text-primary/70 transition-[stroke-dashoffset] duration-300"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className="flex min-w-0 flex-col justify-center gap-0.5">
              <div className="overflow-hidden" style={{ maxWidth: `${titleMaxWidth}px` }}>
                <MarqueeText containerClassName="leading-none">
                  <span className={cn("font-bold leading-[1.05] whitespace-nowrap text-foreground tracking-tight drop-shadow-sm", titleTextClass)}>
                    {current?.title ?? ""}
                  </span>
                </MarqueeText>
              </div>

              {lyricLine && (
                <div className="overflow-hidden" style={{ maxWidth: `${Math.max(120, titleMaxWidth + 40)}px` }}>
                  <MarqueeText containerClassName="leading-none">
                    <span className={cn(
                      "font-semibold tracking-wide whitespace-nowrap",
                      isPlaying ? "text-primary/90 dark:text-primary/90" : "text-foreground/60 dark:text-foreground/70",
                      sublineTextClass
                    )}>
                      {lyricLine}
                    </span>
                  </MarqueeText>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-3 h-full">
          {hasMetricsBlock && (
            <div className="flex items-center gap-2">
              <SeparatorLine className="h-6" />
              <div style={{ width: `${metricBlockWidth}px` }} className="flex justify-end">
                <MiniMetricsCanvas items={visibleMetricItems} height={effectiveLayoutHeight} />
              </div>
            </div>
          )}

          {(hasControlsBlock || showRestoreButton) && (
            <div className="flex items-center gap-2 mr-2">
              {(isMusicVisible || hasMetricsBlock) && <SeparatorLine className="h-6" />}
              
              {hasControlsBlock && (
                <div className="flex items-center gap-1.5">
                  {miniSettings.visibleKeys.includes("previous") && (
                    <button
                      type="button"
                      disabled={!controlState?.target?.supports_previous || runningCommand !== null}
                      onClick={(e) => { e.stopPropagation(); void runCommand("previous"); }}
                      className="inline-flex items-center justify-center rounded-full bg-white/8 text-foreground/82 transition-all hover:bg-white/16 hover:text-foreground disabled:opacity-30 dark:bg-white/6"
                      style={{ width: controlSize, height: controlSize }}
                    >
                      <MiniPreviousIcon className="h-4 w-4" />
                    </button>
                  )}

                  {miniSettings.visibleKeys.includes("play_pause") && (
                    <button
                      type="button"
                      disabled={!controlState?.target?.supports_play_pause || runningCommand !== null}
                      onClick={(e) => { e.stopPropagation(); void runCommand("play_pause"); }}
                      className="inline-flex items-center justify-center rounded-full bg-white/12 text-foreground/92 transition-all hover:bg-white/20 hover:text-foreground hover:scale-105 active:scale-95 disabled:opacity-30 dark:bg-white/10"
                      style={{ width: controlSize + 2, height: controlSize + 2 }}
                    >
                      {isPlaying ? <MiniPauseIcon className="h-5 w-5" /> : <MiniPlayIcon className="h-5 w-5 ml-0.5" />}
                    </button>
                  )}

                  {miniSettings.visibleKeys.includes("next") && (
                    <button
                      type="button"
                      disabled={!controlState?.target?.supports_next || runningCommand !== null}
                      onClick={(e) => { e.stopPropagation(); void runCommand("next"); }}
                      className="inline-flex items-center justify-center rounded-full bg-white/8 text-foreground/82 transition-all hover:bg-white/16 hover:text-foreground disabled:opacity-30 dark:bg-white/6"
                      style={{ width: controlSize, height: controlSize }}
                    >
                      <MiniNextIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {showRestoreButton && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isTransitioning) {
                      onToggleMini?.(event.currentTarget.getBoundingClientRect());
                    }
                  }}
                  disabled={isTransitioning}
                  className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary transition-all hover:bg-primary/20 disabled:opacity-30"
                  style={{ width: controlSize - 2, height: controlSize - 2 }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6" />
                    <path d="M9 21H3v-6" />
                    <path d="M21 3l-7 7" />
                    <path d="M3 21l7-7" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
