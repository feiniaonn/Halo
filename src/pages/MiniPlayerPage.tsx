import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { clampPercent } from "@/lib/formatters";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { CoverImage } from "@/modules/music/components/CoverImage";
import { OptionalCoverImage } from "@/modules/music/components/OptionalCoverImage";
import { useCurrentPlaying } from "@/modules/music/hooks/useCurrentPlaying";
import { useMusicControl } from "@/modules/music/hooks/useMusicControl";
import { useMusicDailySummary } from "@/modules/music/hooks/useMusicDailySummary";
import { useMusicLyrics } from "@/modules/music/hooks/useMusicLyrics";
import { usePlaybackClock } from "@/modules/music/hooks/usePlaybackClock";
import { getMusicSettings } from "@/modules/music/services/musicService";
import { resolveCurrentLyricText, resolvePlaybackMs } from "@/modules/music/utils/lyrics";
import { useSystemOverview } from "@/modules/dashboard";
import type {
  MusicMiniVisibleKey,
  MusicSettings,
} from "@/modules/music/types/music.types";
import type { MiniRestoreMode } from "@/modules/settings/types/settings.types";

function SystemMetric({
  label,
  value,
  barClassName,
}: {
  label: string;
  value: number | null;
  barClassName: string;
}) {
  const pct = value === null ? null : clampPercent(value);
  return (
    <div className="min-w-[48px]">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[9px] font-medium text-foreground/72 dark:text-foreground/78">
          {label}
        </span>
        <span className="text-[10px] font-semibold tabular-nums">
          {pct === null ? "--" : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-black/15 dark:bg-white/20">
        <div
          className={cn("h-full transition-all duration-300", barClassName)}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}

const DEFAULT_MINI_SETTINGS = {
  controlsEnabled: false,
  visibleKeys: ["play_pause", "next"] as MusicMiniVisibleKey[],
  showStatsWithoutSession: false,
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
    showStatsWithoutSession: settings.music_mini_show_stats_without_session,
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

export function MiniPlayerPage({
  className,
  onToggleMini,
  isTransitioning = false,
  miniRestoreMode = "both",
}: {
  className?: string;
  onToggleMini?: (anchorRect?: { left: number; top: number; width: number; height: number }) => void;
  isTransitioning?: boolean;
  miniRestoreMode?: MiniRestoreMode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [miniSettings, setMiniSettings] = useState(DEFAULT_MINI_SETTINGS);
  const [compact, setCompact] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const { data: current } = useCurrentPlaying();
  const { state: controlState, runCommand, runningCommand } = useMusicControl();
  const { data: dailySummary } = useMusicDailySummary();
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

  const isMusicVisible = useMemo(() => {
    return Boolean(current?.title && current.playback_status === "Playing");
  }, [current?.title, current?.playback_status]);

  const showStats = useMemo(() => {
    if (!dailySummary) return false;
    return isMusicVisible || miniSettings.showStatsWithoutSession;
  }, [dailySummary, isMusicVisible, miniSettings.showStatsWithoutSession]);

  const miniLyricText = useMemo(() => {
    if (!miniSettings.lyricsEnabled || !current || !lyrics.response?.ok) {
      return null;
    }
    const playbackMs = resolvePlaybackMs(livePlaybackPositionSecs, miniSettings.lyricsOffsetMs);
    return resolveCurrentLyricText(lyrics.response.lines, playbackMs);
  }, [
    current,
    lyrics.response,
    miniSettings.lyricsEnabled,
    miniSettings.lyricsOffsetMs,
    livePlaybackPositionSecs,
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

    let timer: number | null = null;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        setCompact(width < 600);
        setLayoutWidth(width);
      }, 80);
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const cpuUsage = systemOverview ? clampPercent(systemOverview.cpuUsage) : null;
  const memoryUsage =
    systemOverview && systemOverview.memoryTotalBytes > 0
      ? clampPercent((systemOverview.memoryUsedBytes / systemOverview.memoryTotalBytes) * 100)
      : null;
  const gpuUsage = systemOverview?.gpuUsage == null ? null : clampPercent(systemOverview.gpuUsage);
  const titleTextClass = layoutWidth > 0 && layoutWidth < 560 ? "text-[11px]" : "text-xs";
  const sublineTextClass = layoutWidth > 0 && layoutWidth < 560 ? "text-[10px]" : "text-[11px]";
  const titleWidthClass = layoutWidth > 0 && layoutWidth < 560 ? "w-[180px]" : layoutWidth < 640 ? "w-[220px]" : "w-[260px]";

  return (
    <div className={cn("h-full w-full transition-all duration-200 ease-out", className)}>
      <div
        ref={containerRef}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (!isTransitioning && allowDoubleClickRestore) {
            onToggleMini?.(e.currentTarget.getBoundingClientRect());
          }
        }}
        className="relative flex h-full w-full select-none items-center px-3 py-1.5 transition-all duration-200 ease-out"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <div
            className={cn(
              "flex min-w-0 items-center gap-2.5 overflow-hidden transition-all duration-300 ease-out",
              isMusicVisible
                ? "max-w-[400px] translate-x-0 opacity-100"
                : "max-w-0 -translate-x-2 opacity-0",
            )}
            aria-hidden={!isMusicVisible}
          >
            <CoverImage
              coverPath={current?.cover_path ?? null}
              dataUrl={current?.cover_data_url ?? null}
              size="md"
              className="h-8 w-8 rounded-md bg-white/15 shadow-sm flex-shrink-0"
            />
            <div className="min-w-0 flex flex-col justify-center flex-1">
              <div className={cn(titleWidthClass, "overflow-hidden")}>
                <MarqueeText className="inline-flex items-center gap-1.5">
                  <span className={cn("font-semibold leading-tight whitespace-nowrap", titleTextClass)}>
                    {current?.title ?? ""}
                  </span>
                </MarqueeText>
              </div>
              {miniLyricText && (
                <div className={cn(titleWidthClass, "overflow-hidden")}>
                  <MarqueeText
                    className={cn("leading-tight text-foreground/68 dark:text-foreground/74", sublineTextClass)}
                  >
                    {miniLyricText}
                  </MarqueeText>
                </div>
              )}
            </div>
          </div>

          {isMusicVisible && <div className="h-5 w-px bg-border/75 flex-shrink-0" aria-hidden />}

          <div className={cn("flex items-center gap-2 flex-shrink-0", compact && "hidden")}>
            <SystemMetric label="CPU" value={cpuUsage} barClassName="bg-sky-500" />
            <SystemMetric label="内存" value={memoryUsage} barClassName="bg-violet-500" />
            <SystemMetric label="GPU" value={gpuUsage} barClassName="bg-amber-500" />
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1.5">
          {miniSettings.controlsEnabled && (
            <div className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/8 px-1.5 py-1 backdrop-blur-md">
              {miniSettings.visibleKeys.includes("previous") && (
                <button
                  type="button"
                  disabled={!controlState?.target?.supports_previous || runningCommand !== null}
                  onClick={() => void runCommand("previous")}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/20 bg-white/8 transition-colors hover:bg-white/12 disabled:opacity-40"
                  aria-label="上一首"
                  title="上一首"
                >
                  <MiniPreviousIcon className="h-3.5 w-3.5" />
                </button>
              )}
              {miniSettings.visibleKeys.includes("play_pause") && (
                <button
                  type="button"
                  disabled={!controlState?.target?.supports_play_pause || runningCommand !== null}
                  onClick={() => void runCommand("play_pause")}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/20 bg-white/8 transition-colors hover:bg-white/12 disabled:opacity-40"
                  aria-label={controlState?.target?.playback_status === "Playing" ? "暂停" : "播放"}
                  title={controlState?.target?.playback_status === "Playing" ? "暂停" : "播放"}
                >
                  {controlState?.target?.playback_status === "Playing" ? (
                    <MiniPauseIcon className="h-3.5 w-3.5" />
                  ) : (
                    <MiniPlayIcon className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              {miniSettings.visibleKeys.includes("next") && (
                <button
                  type="button"
                  disabled={!controlState?.target?.supports_next || runningCommand !== null}
                  onClick={() => void runCommand("next")}
                  className="inline-flex h-6 w-6 items-center justify-center rounded border border-white/20 bg-white/8 transition-colors hover:bg-white/12 disabled:opacity-40"
                  aria-label="下一首"
                  title="下一首"
                >
                  <MiniNextIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {showStats && (
            <div className="flex min-w-[84px] max-w-[240px] items-center gap-1.5 rounded-md border border-white/12 bg-white/6 px-2 py-1 text-[10px] text-foreground/72">
              <span className="shrink-0">今日 {dailySummary?.total_play_events ?? 0}</span>
              {dailySummary?.top_song && (
                <>
                  <span className="opacity-60">|</span>
                  {!compact && (
                    <OptionalCoverImage
                      coverPath={dailySummary.top_song.cover_path}
                      className="h-5 w-5 rounded flex-shrink-0"
                    />
                  )}
                  <span className="truncate">
                    {compact ? dailySummary.top_song.title.slice(0, 4) : dailySummary.top_song.title}
                  </span>
                </>
              )}
            </div>
          )}

          {allowButtonRestore && (
            <button
              type="button"
              onClick={(e) => {
                if (!isTransitioning) onToggleMini?.(e.currentTarget.getBoundingClientRect());
              }}
              disabled={isTransitioning}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/25 bg-white/20 text-foreground/72 backdrop-blur-md transition-colors hover:bg-white/30 hover:text-foreground disabled:opacity-45 dark:border-white/12 dark:bg-white/6 dark:text-foreground/78 dark:hover:bg-white/14"
              title="恢复正常窗口"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 8V4h4" />
                <path d="M20 16v4h-4" />
                <path d="M8 4L4 8" />
                <path d="M16 20l4-4" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
