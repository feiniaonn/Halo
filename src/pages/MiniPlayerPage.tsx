import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion } from "framer-motion";
import { useIslandSizes } from "@/hooks/useIslandSizes";
import { clearCurrentWindowRegion, setCurrentWindowRoundedRegion } from "@/lib/windowGeometry";
import { cn } from "@/lib/utils";
import { MINI_ISLAND_TOP_OFFSET, resolveMiniIslandLayout } from "@/modules/island/layout";
import { resolveIslandModule } from "@/modules/island/registry";
import type { IslandDensity, IslandFrameState, IslandModuleRenderContext } from "@/modules/island/types";
import { useCurrentPlaying } from "@/modules/music/hooks/useCurrentPlaying";
import { useMusicLyrics } from "@/modules/music/hooks/useMusicLyrics";
import { usePlaybackClock } from "@/modules/music/hooks/usePlaybackClock";
import { ACTIVE_LINE_LEAD_MS } from "@/modules/music/components/KaraokeLineText";
import { getMusicSettings } from "@/modules/music/services/musicService";
import type { MusicSettings } from "@/modules/music/types/music.types";
import { findCurrentLyricLineIndex, resolvePlaybackMs } from "@/modules/music/utils/lyrics";

type ToggleAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type MiniSettingsState = {
  lyricsEnabled: boolean;
  lyricsOffsetMs: number;
  restoreHomeHotkey: string | null;
};

const MINI_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 300,
  damping: 26,
  mass: 0.72,
} as const;

const DEFAULT_MINI_SETTINGS: MiniSettingsState = {
  lyricsEnabled: true,
  lyricsOffsetMs: 0,
  restoreHomeHotkey: "Control+Shift+H",
};

const MINI_WINDOW_SIDE_BUFFER = 2;

function normalizeShortcut(input: string | null | undefined): string | null {
  if (!input) return null;
  const parts = input
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<string>();
  let key: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") {
      modifiers.add("Control");
      continue;
    }
    if (lower === "shift") {
      modifiers.add("Shift");
      continue;
    }
    if (lower === "alt" || lower === "option") {
      modifiers.add("Alt");
      continue;
    }
    if (lower === "meta" || lower === "command" || lower === "cmd" || lower === "super" || lower === "win") {
      modifiers.add("Meta");
      continue;
    }
    if (lower === "esc") {
      key = "Escape";
      continue;
    }
    key = part.length === 1 ? part.toUpperCase() : part;
  }

  if (!key) return null;

  const ordered: string[] = [];
  if (modifiers.has("Control")) ordered.push("Control");
  if (modifiers.has("Shift")) ordered.push("Shift");
  if (modifiers.has("Alt")) ordered.push("Alt");
  if (modifiers.has("Meta")) ordered.push("Meta");
  ordered.push(key);
  return ordered.join("+");
}

function eventToShortcut(event: KeyboardEvent): string | null {
  if (event.repeat) return null;
  const lower = event.key.toLowerCase();
  if (lower === "control" || lower === "shift" || lower === "alt" || lower === "meta") {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Control");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return normalizeShortcut(parts.join("+"));
}

function mapMiniSettings(settings: MusicSettings | null): MiniSettingsState {
  if (!settings) return DEFAULT_MINI_SETTINGS;
  const restoreHomeHotkey = normalizeShortcut(settings.music_hotkeys_bindings.restore_mini_home);
  return {
    lyricsEnabled: settings.music_lyrics_enabled,
    lyricsOffsetMs: settings.music_lyrics_offset_ms,
    restoreHomeHotkey:
      settings.music_hotkeys_bindings.restore_mini_home === undefined
        ? DEFAULT_MINI_SETTINGS.restoreHomeHotkey
        : restoreHomeHotkey,
  };
}

function pickDensity(width: number, height: number): IslandDensity {
  if (width < 560 || height <= 30) return "tight";
  if (width < 820 || height <= 42) return "compact";
  return "comfortable";
}

function toPlaybackStateLabel(playbackStatus: string | null, isVisible: boolean) {
  if (!isVisible) return "Idle";
  if (playbackStatus === "Playing") return "Playing";
  if (playbackStatus === "Paused") return "Paused";
  return "Idle";
}

export function MiniPlayerPage({
  className,
  onToggleMini,
  isTransitioning = false,
  bgType = "none",
  bgPath = null,
  bgBlur = 12,
}: {
  className?: string;
  onToggleMini?: (anchorRect?: ToggleAnchorRect) => void;
  isTransitioning?: boolean;
  bgType?: "none" | "image" | "video";
  bgPath?: string | null;
  bgBlur?: number;
}) {
  const [wantsExpanded, setWantsExpanded] = useState(false);
  const [miniSettings, setMiniSettings] = useState(DEFAULT_MINI_SETTINGS);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const islandShellRef = useRef<HTMLDivElement | null>(null);
  const scheduleHitRegionSyncRef = useRef<((rafDepth?: number) => void) | null>(null);
  const { sizes } = useIslandSizes();
  const { data: current } = useCurrentPlaying();

  const playbackTrackKey = `${current?.source_app_id ?? ""}::${current?.artist ?? ""}::${current?.title ?? ""}`;
  const livePlaybackPositionSecs = usePlaybackClock(
    current?.position_secs,
    current?.playback_status,
    current?.duration_secs,
    current?.position_sampled_at_ms,
    playbackTrackKey,
  );

  const isMusicVisible = useMemo(
    () => Boolean(current?.title && current.playback_status !== "Stopped" && current.playback_status !== "Closed"),
    [current?.title, current?.playback_status],
  );
  const isPlaying = current?.playback_status === "Playing";

  const lyrics = useMusicLyrics({
    current,
    enabled: isMusicVisible && miniSettings.lyricsEnabled,
    playbackPositionSecs: livePlaybackPositionSecs,
    offsetMs: miniSettings.lyricsOffsetMs,
    autoReview: false,
  });

  const lyricPlaybackMs = useMemo(
    () => resolvePlaybackMs(livePlaybackPositionSecs, miniSettings.lyricsOffsetMs),
    [livePlaybackPositionSecs, miniSettings.lyricsOffsetMs],
  );
  const activeLyricLine = useMemo(() => {
    if (!isMusicVisible || !miniSettings.lyricsEnabled || !lyrics.response?.ok) {
      return null;
    }

    const lines = lyrics.response.lines;
    if (lines.length === 0) {
      return null;
    }

    const activeLinePlaybackMs =
      lyricPlaybackMs == null ? null : lyricPlaybackMs + ACTIVE_LINE_LEAD_MS;
    const activeIndex = findCurrentLyricLineIndex(lines, activeLinePlaybackMs);
    if (activeIndex >= 0) {
      return lines[activeIndex] ?? null;
    }

    return lines.find((line) => line.text.trim().length > 0) ?? null;
  }, [
    isMusicVisible,
    lyricPlaybackMs,
    lyrics.response,
    miniSettings.lyricsEnabled,
  ]);

  const lyricLine = useMemo(() => {
    if (!isMusicVisible || !miniSettings.lyricsEnabled || !lyrics.response?.ok) {
      return null;
    }

    const currentLine = activeLyricLine?.text.trim();
    if (currentLine) return currentLine;

    const firstTimedLine = lyrics.response.lines.find((line) => line.text.trim().length > 0)?.text.trim();
    if (firstTimedLine) return firstTimedLine;

    const firstPlainLine = lyrics.response.plain_text
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return firstPlainLine ?? null;
  }, [
    activeLyricLine,
    isMusicVisible,
    lyrics.response,
    miniSettings.lyricsEnabled,
  ]);

  const playbackProgress = useMemo(() => {
    const duration = current?.duration_secs ?? 0;
    const position = livePlaybackPositionSecs ?? current?.position_secs ?? 0;
    if (duration <= 0) return 0;
    return Math.min(1, Math.max(0, position / duration));
  }, [current, livePlaybackPositionSecs]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        hourCycle: "h23",
      }),
    [],
  );

  const timeLabel = useMemo(() => timeFormatter.format(clockNow), [clockNow, timeFormatter]);
  const playbackStateLabel = useMemo(
    () => toPlaybackStateLabel(current?.playback_status ?? null, isMusicVisible),
    [current?.playback_status, isMusicVisible],
  );
  const titleLabel = useMemo(() => current?.title?.trim() || "Now Playing", [current?.title]);

  const layoutSizes = useMemo(
    () => resolveMiniIslandLayout(sizes.capsuleWidth, sizes.capsuleHeight),
    [sizes.capsuleHeight, sizes.capsuleWidth],
  );

  const capsuleContext = useMemo<IslandModuleRenderContext>(
    () => ({
      frame: {
        state: "capsule",
        width: layoutSizes.capsuleWidth,
        height: layoutSizes.capsuleHeight,
        density: pickDensity(layoutSizes.capsuleWidth, layoutSizes.capsuleHeight),
      },
      music: {
        current,
        isVisible: isMusicVisible,
        isPlaying,
        lyricLine,
        activeLyricLine,
        lyricPlaybackMs,
        playbackProgress,
        titleLabel,
        playbackStateLabel,
      },
      clock: {
        timeLabel,
      },
    }),
    [
      current,
      isMusicVisible,
      isPlaying,
      layoutSizes.capsuleHeight,
      layoutSizes.capsuleWidth,
      lyricLine,
      activeLyricLine,
      lyricPlaybackMs,
      playbackProgress,
      playbackStateLabel,
      timeLabel,
      titleLabel,
    ],
  );

  const activeModule = useMemo(() => resolveIslandModule(capsuleContext), [capsuleContext]);
  const canExpand = activeModule.canExpand?.(capsuleContext) ?? Boolean(activeModule.renderExpanded);
  const displayState: IslandFrameState = canExpand && wantsExpanded ? "expanded" : "capsule";
  const isCapsuleState = displayState === "capsule";
  const islandWidth = displayState === "expanded" ? layoutSizes.expandedWidth : layoutSizes.capsuleWidth;
  const islandHeight = displayState === "expanded" ? layoutSizes.expandedHeight : layoutSizes.capsuleHeight;
  const frameDensity = useMemo(() => pickDensity(islandWidth, islandHeight), [islandHeight, islandWidth]);
  const borderRadius =
    displayState === "expanded"
      ? Math.min(Math.round(islandHeight * 0.5), 28)
      : Math.min(Math.round(islandHeight / 2), 999);
  const shellWidth = islandWidth + MINI_WINDOW_SIDE_BUFFER * 2;
  const shellHeight = islandHeight;
  const shellRadius = borderRadius;

  const hasCustomBg = bgType !== "none" && !!bgPath;
  const backgroundScale = 1.05;
  const normalizedBgBlur = (bgBlur / 100) * 32;
  const restoreShortcutLabel = miniSettings.restoreHomeHotkey;
  const ariaKeyShortcuts = useMemo(
    () => ["Escape", restoreShortcutLabel].filter(Boolean).join(", "),
    [restoreShortcutLabel],
  );

  const moduleContext = useMemo<IslandModuleRenderContext>(
    () => ({
      frame: {
        state: displayState,
        width: islandWidth,
        height: islandHeight,
        density: frameDensity,
      },
      music: capsuleContext.music,
      clock: capsuleContext.clock,
    }),
    [capsuleContext.clock, capsuleContext.music, displayState, frameDensity, islandHeight, islandWidth],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

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
    if (bgType !== "video" || !bgPath) return;
    const element = bgVideoRef.current;
    if (!element) return;
    try {
      element.load();
      void element.play().catch(() => void 0);
    } catch {
      void 0;
    }
  }, [bgType, bgPath]);

  useLayoutEffect(() => {
    if (!isTauriRuntime()) return;

    let rafId = 0;
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const syncRegion = () => {
      if (disposed) return;
      const element = islandShellRef.current ?? islandRef.current;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const scale = window.devicePixelRatio || 1;
      const viewportWidth = Math.max(1, Math.round(window.innerWidth * scale));
      const viewportHeight = Math.max(1, Math.round(window.innerHeight * scale));
      const computedStyle = window.getComputedStyle(element);
      const radiusPx =
        Number.parseFloat(computedStyle.borderTopLeftRadius) || Math.min(rect.height / 2, 999);
      const regionBleedX = 1;
      const regionBleedBottom = 1;
      const physicalLeft = Math.round(rect.left * scale);
      const physicalTop = Math.round(rect.top * scale);
      const physicalWidth = Math.round(rect.width * scale);
      const physicalHeight = Math.round(rect.height * scale);

      const x = Math.max(0, physicalLeft - regionBleedX);
      const y = Math.max(0, physicalTop);
      const width = Math.max(
        1,
        Math.min(viewportWidth - x, physicalWidth + regionBleedX * 2),
      );
      const height = Math.max(
        1,
        Math.min(viewportHeight - y, physicalHeight + regionBleedBottom),
      );
      const radius = Math.max(0, Math.round(radiusPx * scale) + 1);

      void setCurrentWindowRoundedRegion({ x, y, width, height, radius }).catch(() => void 0);
    };

    const scheduleRegionSync = (rafDepth = 1) => {
      if (disposed || rafId) return;
      let remainingFrames = Math.max(1, rafDepth);
      const tick = () => {
        if (disposed) {
          rafId = 0;
          return;
        }
        remainingFrames -= 1;
        if (remainingFrames > 0) {
          rafId = window.requestAnimationFrame(tick);
          return;
        }
        rafId = 0;
        syncRegion();
      };
      rafId = window.requestAnimationFrame(tick);
    };

    scheduleHitRegionSyncRef.current = scheduleRegionSync;
    scheduleRegionSync(2);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleRegionSync();
      });
      if (islandRef.current) {
        resizeObserver.observe(islandRef.current);
      }
      if (islandShellRef.current) {
        resizeObserver.observe(islandShellRef.current);
      }
    }

    const handleWindowResize = () => {
      scheduleRegionSync();
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      disposed = true;
      scheduleHitRegionSyncRef.current = null;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      void clearCurrentWindowRegion().catch(() => void 0);
    };
  }, []);

  useLayoutEffect(() => {
    scheduleHitRegionSyncRef.current?.(2);
  }, [borderRadius, displayState, islandHeight, islandWidth]);

  const handleIslandClick = useCallback(() => {
    if (!canExpand) return;
    setWantsExpanded((prev) => !prev);
  }, [canExpand]);

  const requestReturnHome = useCallback(() => {
    if (isTransitioning) return;
    onToggleMini?.();
  }, [isTransitioning, onToggleMini]);

  const moduleContent =
    displayState === "expanded" && canExpand && activeModule.renderExpanded
      ? activeModule.renderExpanded(moduleContext)
      : activeModule.renderCapsule(moduleContext);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isEscape = event.key === "Escape" && !event.repeat;
      const isShortcut =
        miniSettings.restoreHomeHotkey != null
          && eventToShortcut(event) === miniSettings.restoreHomeHotkey;
      if (!isEscape && !isShortcut) return;
      if (isTransitioning) return;
      event.preventDefault();
      requestReturnHome();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTransitioning, miniSettings.restoreHomeHotkey, requestReturnHome]);

  return (
    <div
      className="pointer-events-none relative flex h-[100vh] w-full select-none items-start justify-center"
      style={{ paddingTop: MINI_ISLAND_TOP_OFFSET }}
    >
      <motion.div
        ref={islandRef}
        initial={false}
        data-tauri-drag-region
        animate={{ width: shellWidth, height: shellHeight, borderRadius: shellRadius }}
        onAnimationComplete={() => {
          scheduleHitRegionSyncRef.current?.(2);
        }}
        onClick={handleIslandClick}
        className={cn(
          "halo-mini-standalone pointer-events-auto relative isolate overflow-hidden bg-transparent text-white transform-gpu",
          canExpand ? "cursor-pointer" : "cursor-default",
          className,
        )}
        aria-keyshortcuts={ariaKeyShortcuts}
        style={{ originX: 0.5, originY: 0.5, willChange: "width, height, border-radius" }}
        transition={MINI_LAYOUT_TRANSITION}
      >
        <motion.div
          ref={islandShellRef}
          layout
          className={cn(
            "absolute inset-y-0 overflow-hidden bg-black/[0.96] text-white",
            isCapsuleState
              ? "border border-transparent shadow-[0_18px_40px_-28px_rgba(0,0,0,0.96),inset_0_0_0_1px_rgba(255,255,255,0.02)]"
              : "border border-white/8 shadow-[0_22px_56px_-30px_rgba(0,0,0,0.96),inset_0_1px_0_rgba(255,255,255,0.08)]",
            hasCustomBg && "bg-black/88 backdrop-blur-[22px]",
          )}
          style={{
            top: 0,
            bottom: 0,
            left: MINI_WINDOW_SIDE_BUFFER,
            right: MINI_WINDOW_SIDE_BUFFER,
            borderRadius,
            backfaceVisibility: "hidden",
            transform: "translateZ(0)",
            willChange: "transform, width, height, border-radius",
          }}
          onLayoutAnimationComplete={() => {
            scheduleHitRegionSyncRef.current?.(2);
          }}
          transition={MINI_LAYOUT_TRANSITION}
        >
          {hasCustomBg && (
            <motion.div
              layout
              className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(circle_at_center,black_18%,black_48%,transparent_100%)]"
            >
              {bgType === "image" ? (
                <img
                  key={bgPath ?? "none"}
                  src={bgPath ?? ""}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-26"
                  style={{
                    filter: `blur(${Math.max(0, normalizedBgBlur * 0.36)}px) saturate(0.92)`,
                    transform: `scale(${Math.max(1.02, backgroundScale - 0.02)})`,
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
                  className="absolute inset-0 h-full w-full object-cover opacity-22"
                  style={{
                    filter: `blur(${Math.max(0, normalizedBgBlur * 0.28)}px) saturate(0.9)`,
                    transform: `scale(${Math.max(1.02, backgroundScale - 0.02)})`,
                  }}
                />
              )}
            </motion.div>
          )}

          <div
            className={cn(
              "pointer-events-none absolute inset-0",
              isCapsuleState
                ? "bg-[linear-gradient(180deg,rgba(255,255,255,0.008),transparent_18%,rgba(0,0,0,0.16))]"
                : "bg-[radial-gradient(circle_at_50%_-15%,rgba(255,255,255,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent_40%,rgba(0,0,0,0.18))]",
            )}
          />

          <motion.div layout className="relative z-10 h-full w-full" transition={MINI_LAYOUT_TRANSITION}>
            {moduleContent}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
