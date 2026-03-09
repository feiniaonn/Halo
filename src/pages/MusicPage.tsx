import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/formatters";
import { CoverImage } from "@/modules/music/components/CoverImage";
import { MusicLyricsPanel } from "@/modules/music/components/MusicLyricsPanel";
import { MusicSettingsModal } from "@/modules/music/components/MusicSettingsModal";
import type {
  MusicHotkeyAction,
  MusicHotkeyCaptureState,
} from "@/modules/music/components/MusicSettingsModal";
import { MusicTop10List } from "@/modules/music/components/MusicTop10List";
import { OptionalCoverImage } from "@/modules/music/components/OptionalCoverImage";
import { useCurrentPlaying } from "@/modules/music/hooks/useCurrentPlaying";
import { useMusicControl } from "@/modules/music/hooks/useMusicControl";
import { useMusicDailySummary } from "@/modules/music/hooks/useMusicDailySummary";
import { useMusicLyrics } from "@/modules/music/hooks/useMusicLyrics";
import { usePlaybackClock } from "@/modules/music/hooks/usePlaybackClock";
import { usePlayHistory, useTop10 } from "@/modules/music/hooks/usePlayHistory";
import { applyMusicHotkeys } from "@/modules/music/services/musicHotkeyManager";
import { getMusicSettings, setMusicSettings } from "@/modules/music/services/musicService";
import type {
  MusicCommand,
  MusicControlResult,
  MusicMiniVisibleKey,
  MusicSettings,
} from "@/modules/music/types/music.types";
import { Play, Pause, SkipBack, SkipForward, RefreshCw, Settings2 } from "lucide-react";
import { Card } from "@/components/ui/card";

type MusicTab = "top10" | "all";

const DEFAULT_SETTINGS: MusicSettings = {
  music_control_target_mode: "auto",
  music_control_timeout_ms: 1200,
  music_control_retry_count: 1,
  music_control_whitelist: [],
  music_mini_controls_enabled: false,
  music_mini_visible_keys: ["play_pause", "next"],
  music_mini_show_stats_without_session: false,
  music_hotkeys_enabled: false,
  music_hotkeys_scope: "focus",
  music_hotkeys_bindings: {
    previous: null,
    play_pause: null,
    next: null,
  },
  music_lyrics_enabled: true,
  music_lyrics_show_translation: true,
  music_lyrics_show_romanized: true,
  music_lyrics_offset_ms: 0,
  music_lyrics_auto_follow: true,
  music_lyrics_manual_lock_ms: 8000,
  music_lyrics_scrape_enabled: false,
  music_lyrics_scrape_notice_ack: false,
};

const HOTKEY_ACTIONS: MusicHotkeyAction[] = ["previous", "play_pause", "next"];
const HISTORY_PAGE_SIZE = 10;

function normalizeHotkeyBinding(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSettingsForCompare(input: MusicSettings): MusicSettings {
  return {
    ...input,
    music_control_whitelist: Array.from(
      new Set(input.music_control_whitelist.map((item) => item.trim().toLowerCase()).filter(Boolean)),
    ).sort(),
    music_mini_visible_keys: [...input.music_mini_visible_keys].sort(),
    music_hotkeys_bindings: {
      previous: normalizeHotkeyBinding(input.music_hotkeys_bindings.previous),
      play_pause: normalizeHotkeyBinding(input.music_hotkeys_bindings.play_pause),
      next: normalizeHotkeyBinding(input.music_hotkeys_bindings.next),
    },
  };
}

function isSettingsEqual(a: MusicSettings, b: MusicSettings): boolean {
  return JSON.stringify(normalizeSettingsForCompare(a)) === JSON.stringify(normalizeSettingsForCompare(b));
}

function normalizeCapturedMainKey(key: string): string | null {
  const raw = key.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (lower === "escape") return "Escape";
  if (lower === "pageup") return "PageUp";
  if (lower === "pagedown") return "PageDown";
  if (lower === "arrowup" || lower === "up") return "ArrowUp";
  if (lower === "arrowdown" || lower === "down") return "ArrowDown";
  if (lower === "arrowleft" || lower === "left") return "ArrowLeft";
  if (lower === "arrowright" || lower === "right") return "ArrowRight";
  if (lower.length === 1) return lower.toUpperCase();
  return raw;
}

function modifierTokens(event: KeyboardEvent): string[] {
  const out: string[] = [];
  if (event.ctrlKey) out.push("Control");
  if (event.shiftKey) out.push("Shift");
  if (event.altKey) out.push("Alt");
  if (event.metaKey) out.push("Meta");
  return out;
}

function mergeSettings(input: MusicSettings | null): MusicSettings {
  if (!input) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    music_mini_visible_keys:
      input.music_mini_visible_keys.length > 0
        ? input.music_mini_visible_keys
        : DEFAULT_SETTINGS.music_mini_visible_keys,
    music_hotkeys_bindings: {
      ...DEFAULT_SETTINGS.music_hotkeys_bindings,
      ...input.music_hotkeys_bindings,
    },
  };
}

function toBindingValue(value: string | null | undefined): string {
  return value ?? "";
}

function normalizeSourceName(name: string): string {
  const cleaned = name.trim();
  const pathLeaf = cleaned.split(/[/\\]/).pop() ?? cleaned;
  const stem = pathLeaf.replace(/\.[^.]+$/, "").trim();
  const base = stem || cleaned;
  const lowered = base.toLowerCase();

  if (lowered.includes("cloudmusic") || lowered.includes("netease")) return "网易云音乐";
  if (lowered.includes("kugou")) return "酷狗音乐";
  if (lowered.includes("qqmusic") || lowered.includes("tencent")) return "QQ音乐";
  if (lowered.includes("kuwo")) return "酷我音乐";
  if (lowered.includes("spotify")) return "Spotify";
  if (lowered.includes("apple") || lowered.includes("itunes")) return "Apple Music";
  if (lowered.includes("youtube")) return "YouTube Music";
  if (lowered.includes("bilibili")) return "哔哩哔哩";
  if (lowered.includes("chrome") || lowered.includes("edge") || lowered.includes("firefox")) return "浏览器";
  return base;
}

function normalizeSourceKind(kind: string): string {
  if (kind === "browser") return "网页播放";
  if (kind === "native") return "本地应用";
  return kind;
}

function normalizeControlReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const lowered = reason.toLowerCase();
  if (lowered.includes("timeout")) return "控制超时，请稍后重试";
  if (lowered.includes("no_controllable_session")) return "当前没有可控会话";
  if (lowered.includes("whitelist_blocked")) return "当前会话被白名单拦截";
  if (lowered.includes("command_not_supported")) return "当前会话不支持此控制";
  if (lowered.includes("query_failed")) return "媒体会话查询失败";
  if (lowered.includes("unsupported_command")) return "不支持的控制命令";
  if (lowered.includes("unknown_error")) return "控制失败，请稍后重试";
  return reason;
}

function toControlFeedback(result: MusicControlResult): string {
  if (result.ok) {
    return "控制成功";
  }
  return normalizeControlReason(result.reason ?? result.message) ?? "控制失败";
}

export function MusicPage() {
  const [tab, setTab] = useState<MusicTab>("top10");
  const [historyPage, setHistoryPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [settings, setSettings] = useState<MusicSettings>(DEFAULT_SETTINGS);
  const [savedSettingsSnapshot, setSavedSettingsSnapshot] = useState<MusicSettings>(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [hotkeyCapture, setHotkeyCapture] = useState<MusicHotkeyCaptureState | null>(null);

  const controlFeedbackRef = useRef({ text: "", at: 0 });
  const hotkeyInputRefs = useRef<Record<MusicHotkeyAction, HTMLInputElement | null>>({
    previous: null,
    play_pause: null,
    next: null,
  });

  const { data: top10, loading: top10Loading } = useTop10();
  const { data: history, loading: historyLoading } = usePlayHistory(500);
  const { data: currentPlaying } = useCurrentPlaying();
  const { data: dailySummary, loading: dailyLoading } = useMusicDailySummary();
  const {
    state: controlState,
    sources: controlSources,
    runningCommand,
    runCommand,
  } = useMusicControl();
  const playbackTrackKey = `${currentPlaying?.source_app_id ?? ""}::${currentPlaying?.artist ?? ""}::${currentPlaying?.title ?? ""}`;
  const livePlaybackPositionSecs = usePlaybackClock(
    currentPlaying?.position_secs,
    currentPlaying?.playback_status,
    currentPlaying?.duration_secs,
    playbackTrackKey,
  );
  const lyrics = useMusicLyrics({
    current: currentPlaying,
    enabled: settings.music_lyrics_enabled,
    playbackPositionSecs: livePlaybackPositionSecs,
    offsetMs: settings.music_lyrics_offset_ms,
    autoReview: false,
  });

  const resolvedPositionSecs = livePlaybackPositionSecs ?? currentPlaying?.position_secs ?? null;
  const progressPercent = useMemo(() => {
    const duration = currentPlaying?.duration_secs ?? null;
    if (duration == null || duration <= 0 || resolvedPositionSecs == null) {
      return 0;
    }
    return Math.min(100, Math.max(0, (resolvedPositionSecs / duration) * 100));
  }, [currentPlaying?.duration_secs, resolvedPositionSecs]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const next = await getMusicSettings();
        const merged = mergeSettings(next);
        setSettings(merged);
        setSavedSettingsSnapshot(merged);
      } catch {
        setSettings(DEFAULT_SETTINGS);
        setSavedSettingsSnapshot(DEFAULT_SETTINGS);
      } finally {
        setSettingsLoading(false);
      }
    };
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!settingsMessage) return;
    const timer = window.setTimeout(() => setSettingsMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [settingsMessage]);

  useEffect(() => {
    if (!controlMessage) return;
    const timer = window.setTimeout(() => setControlMessage(null), 2200);
    return () => window.clearTimeout(timer);
  }, [controlMessage]);

  const toggleWhitelistSource = (sourceId: string, checked: boolean) => {
    setSettings((prev) => {
      const next = new Set(prev.music_control_whitelist);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return {
        ...prev,
        music_control_whitelist: Array.from(next),
      };
    });
  };

  const toggleVisibleKey = (key: MusicMiniVisibleKey, checked: boolean) => {
    setSettings((prev) => {
      const next = new Set(prev.music_mini_visible_keys);
      if (checked) next.add(key);
      else next.delete(key);
      return {
        ...prev,
        music_mini_visible_keys: Array.from(next) as MusicMiniVisibleKey[],
      };
    });
  };

  const patchSettings = (patch: Partial<MusicSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleRunCommand = async (command: MusicCommand) => {
    const result = await runCommand(command, {
      timeout_ms: settings.music_control_timeout_ms,
      retry_count: settings.music_control_retry_count,
    });

    const nextMessage = toControlFeedback(result);
    const now = Date.now();
    if (
      controlFeedbackRef.current.text === nextMessage
      && now - controlFeedbackRef.current.at < 1200
    ) {
      return;
    }

    controlFeedbackRef.current = { text: nextMessage, at: now };
    setControlMessage(nextMessage);
  };

  const saveSettings = async (): Promise<boolean> => {
    setSettingsSaving(true);
    try {
      const payload: MusicSettings = {
        ...settings,
        music_control_timeout_ms: Math.max(200, Math.min(5000, settings.music_control_timeout_ms)),
        music_control_retry_count: Math.max(0, Math.min(5, settings.music_control_retry_count)),
        music_lyrics_offset_ms: Math.max(-5000, Math.min(5000, settings.music_lyrics_offset_ms)),
        music_lyrics_manual_lock_ms: Math.max(
          1000,
          Math.min(30000, settings.music_lyrics_manual_lock_ms),
        ),
        music_hotkeys_bindings: {
          previous: settings.music_hotkeys_bindings.previous?.trim() ?? "",
          play_pause: settings.music_hotkeys_bindings.play_pause?.trim() ?? "",
          next: settings.music_hotkeys_bindings.next?.trim() ?? "",
        },
      };
      await setMusicSettings(payload);
      await applyMusicHotkeys(payload);
      setSettings(payload);
      setSavedSettingsSnapshot(payload);
      setSettingsMessage("音乐设置已保存");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setSettingsMessage(`保存失败: ${message}`);
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };

  const canPrevious = Boolean(controlState?.target?.supports_previous);
  const canNext = Boolean(controlState?.target?.supports_next);
  const canPlayPause = Boolean(controlState?.target?.supports_play_pause);

  const controlHint = useMemo(() => {
    if (controlMessage) return controlMessage;
    return normalizeControlReason(controlState?.reason) ?? null;
  }, [controlMessage, controlState?.reason]);

  const settingsDirty = useMemo(() => {
    return !isSettingsEqual(settings, savedSettingsSnapshot);
  }, [savedSettingsSnapshot, settings]);

  const applyHotkeyBinding = (action: MusicHotkeyAction, value: string | null) => {
    setSettings((prev) => ({
      ...prev,
      music_hotkeys_bindings: {
        ...prev.music_hotkeys_bindings,
        [action]: normalizeHotkeyBinding(value),
      },
    }));
  };

  const hotkeyFieldValue = (action: MusicHotkeyAction) => {
    if (hotkeyCapture?.action === action) {
      return hotkeyCapture.preview;
    }
    return toBindingValue(settings.music_hotkeys_bindings[action]);
  };

  const startHotkeyCapture = (action: MusicHotkeyAction) => {
    if (!settings.music_hotkeys_enabled) {
      return;
    }
    setHotkeyCapture({
      action,
      preview: toBindingValue(settings.music_hotkeys_bindings[action]),
      changed: false,
    });
  };

  const closeSettingsModal = () => {
    setShowUnsavedPrompt(false);
    setHotkeyCapture(null);
    setShowSettings(false);
  };

  const requestCloseSettings = useCallback(() => {
    if (settingsDirty) {
      setShowUnsavedPrompt(true);
      return;
    }
    closeSettingsModal();
  }, [settingsDirty]);

  const discardAndCloseSettings = () => {
    setSettings(savedSettingsSnapshot);
    setSettingsMessage("已放弃本次更改");
    closeSettingsModal();
  };

  const saveAndCloseSettings = async () => {
    const ok = await saveSettings();
    if (ok) {
      closeSettingsModal();
    }
  };

  useEffect(() => {
    if (!showSettings || !hotkeyCapture) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setHotkeyCapture(null);
        setSettingsMessage("快捷键录制已取消");
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        applyHotkeyBinding(hotkeyCapture.action, null);
        setHotkeyCapture((prev) => (prev ? { ...prev, preview: "", changed: true } : prev));
        return;
      }

      const lowered = event.key.toLowerCase();
      if (lowered === "control" || lowered === "shift" || lowered === "alt" || lowered === "meta") {
        setHotkeyCapture((prev) => (prev ? { ...prev, preview: modifierTokens(event).join("+") } : prev));
        return;
      }

      const mainKey = normalizeCapturedMainKey(event.key);
      if (!mainKey) return;

      const combo = [...modifierTokens(event), mainKey].join("+");
      applyHotkeyBinding(hotkeyCapture.action, combo);
      setHotkeyCapture((prev) => (prev ? { ...prev, preview: combo, changed: true } : prev));
    };

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const onHotkeyInput = HOTKEY_ACTIONS.some((action) => {
        const node = hotkeyInputRefs.current[action];
        return Boolean(node && target && (node === target || node.contains(target)));
      });
      if (onHotkeyInput) {
        return;
      }

      if (hotkeyCapture.changed) {
        setSettingsMessage("快捷键已记录，点击“保存更改”后生效");
      }
      setHotkeyCapture(null);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [hotkeyCapture, showSettings, settings.music_hotkeys_enabled]);

  useEffect(() => {
    if (!showSettings) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (hotkeyCapture) {
        setHotkeyCapture(null);
        return;
      }

      if (showUnsavedPrompt) {
        setShowUnsavedPrompt(false);
        return;
      }

      requestCloseSettings();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
     
  }, [hotkeyCapture, requestCloseSettings, showSettings, showUnsavedPrompt]);

  useEffect(() => {
    if (tab !== "all" && historyPage !== 1) {
      setHistoryPage(1);
    }
  }, [tab, historyPage]);

  const totalHistoryPages = useMemo(() => {
    return Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  }, [history.length]);

  useEffect(() => {
    if (historyPage > totalHistoryPages) {
      setHistoryPage(totalHistoryPages);
    }
  }, [historyPage, totalHistoryPages]);

  const pagedHistory = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return history.slice(start, start + HISTORY_PAGE_SIZE);
  }, [history, historyPage]);

  return (
    <div className="flex h-full flex-col gap-5 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">音乐</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            控制浏览器/本地软件播放，支持统一的全局快捷键。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(true)}
            className="inline-flex items-center justify-center rounded-xl bg-muted/60 p-2.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            aria-label="音乐设置"
            title="音乐设置"
          >
            <Settings2 className="size-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row gap-6 min-h-0">
        {/* Left Column: Player & Lyrics Panel */}
        <div className="flex flex-1 flex-col gap-4 min-w-0 min-h-0">
          {currentPlaying ? (
            <>
              <Card className="glass-card border-none flex flex-col gap-4 p-5 shrink-0 relative overflow-hidden">
                <div className="relative z-10 flex flex-col gap-4">
                  <div className="flex gap-4 items-center">
                    <CoverImage
                      coverPath={currentPlaying.cover_path}
                      dataUrl={currentPlaying.cover_data_url}
                      size="lg"
                      className="w-24 h-24 shadow-2xl rounded-2xl flex-shrink-0 object-cover ring-4 ring-white/10"
                    />
                    <div className="min-w-0 flex-1 flex flex-col justify-center gap-1.5 py-1">
                      <p className="truncate text-3xl font-black tracking-tighter text-foreground drop-shadow-md leading-tight">
                        {currentPlaying.title || "未知标题"}
                      </p>
                      <p className="truncate text-sm text-foreground/70 font-medium">
                        {currentPlaying.artist || "未知艺术家"}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        disabled={!canPrevious || runningCommand !== null}
                        onClick={() => void handleRunCommand("previous")}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/70 transition-all hover:text-foreground hover:bg-white/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="上一首"
                        title="上一首"
                      >
                        <SkipBack className="size-5" />
                      </button>
                      <button
                        type="button"
                        disabled={!canPlayPause || runningCommand !== null}
                        onClick={() => void handleRunCommand("play_pause")}
                        className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_15px_rgba(var(--primary),0.4)] transition-all hover:scale-105 hover:shadow-[0_6px_20px_rgba(var(--primary),0.5)] active:scale-90 active:shadow-none disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100 disabled:shadow-none"
                        aria-label={controlState?.target?.playback_status === "Playing" ? "暂停" : "播放"}
                        title={controlState?.target?.playback_status === "Playing" ? "暂停" : "播放"}
                      >
                        {controlState?.target?.playback_status === "Playing" ? (
                          <Pause className="size-6 fill-current" />
                        ) : (
                          <Play className="size-6 fill-current ml-1" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!canNext || runningCommand !== null}
                        onClick={() => void handleRunCommand("next")}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground/70 transition-all hover:text-foreground hover:bg-white/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="下一首"
                        title="下一首"
                      >
                        <SkipForward className="size-5" />
                      </button>
                      <button
                        type="button"
                        disabled={runningCommand !== null}
                        onClick={() => void handleRunCommand("refresh")}
                        className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground/50 transition-colors hover:text-foreground hover:bg-white/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="刷新状态"
                        title="刷新状态"
                      >
                        <RefreshCw className={cn("size-4", runningCommand !== null && "animate-spin")} />
                      </button>
                    </div>
                  </div>

                  <div className="z-10 flex flex-col gap-1.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/20 dark:bg-white/5 cursor-default group relative">
                      <div
                        className="h-full rounded-full bg-primary/90 hover:bg-primary transition-colors will-change-transform drop-shadow-[0_0_6px_rgba(var(--primary),0.6)]"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-medium tabular-nums text-muted-foreground/70 px-0.5">
                      <span>{resolvedPositionSecs !== null ? formatDuration(resolvedPositionSecs) : "--:--"}</span>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 bg-black/10 dark:bg-white/5 rounded-full text-[10px] font-semibold tracking-tight text-foreground/80 ring-1 ring-white/5">
                          <span className="size-1.5 rounded-full bg-green-500/80 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                          {controlState?.target
                            ? `${normalizeSourceName(controlState.target.source_name)}（${normalizeSourceKind(controlState.target.source_kind)}）`
                            : "无控制目标"}
                        </span>
                        {controlHint && <span className="text-amber-500/90">{controlHint}</span>}
                        <span>{currentPlaying.duration_secs ? formatDuration(currentPlaying.duration_secs) : "--:--"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {currentPlaying.cover_data_url && (
                  <div
                    className="pointer-events-none absolute inset-0 z-0 scale-125 blur-[60px] opacity-[0.15] dark:opacity-10"
                    style={{
                      backgroundImage: `url(${currentPlaying.cover_data_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                )}
              </Card>

              {settings.music_lyrics_enabled && (
                <Card className="glass-card border-none flex flex-col flex-1 min-h-0 p-4 relative overflow-hidden">
                  <MusicLyricsPanel
                    current={currentPlaying}
                    playbackPositionSecs={livePlaybackPositionSecs}
                    response={lyrics.response}
                    loading={lyrics.loading}
                    errorMessage={lyrics.errorMessage}
                    showTranslation={settings.music_lyrics_show_translation}
                    showRomanized={settings.music_lyrics_show_romanized}
                    offsetMs={settings.music_lyrics_offset_ms}
                    devMode={Boolean(import.meta.env.DEV)}
                    activeCandidateId={lyrics.activeCandidateId}
                    onSelectCandidate={lyrics.selectCandidate}
                  />
                </Card>
              )}
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-muted-foreground">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4 h-12 w-12 opacity-20">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
              <p className="font-medium text-base text-foreground/80">当前暂无播放内容</p>
              <p className="mt-1.5 text-xs text-foreground/50">打开支持的网页或本地音乐软件开始播放</p>
            </div>
          )}
        </div>

        {/* Right Column: History & Stats */}
        <Card className="glass-card border-none w-full lg:w-[320px] xl:w-[360px] shrink-0 flex flex-col gap-4 min-h-0 p-4 relative overflow-hidden">
          <nav className="relative flex rounded-lg bg-black/5 dark:bg-white/5 p-1 w-full shrink-0 isolate" aria-label="音乐标签">
            <motion.div
              className="absolute inset-y-1 rounded-md bg-background shadow-sm ring-1 ring-black/5 dark:ring-white/10 z-0"
              initial={false}
              animate={{
                left: tab === "top10" ? 4 : "50%",
                width: "calc(50% - 4px)",
                x: tab === "top10" ? 0 : 0
              }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 35,
                mass: 1
              }}
            />
            <button
              type="button"
              onClick={() => setTab("top10")}
              className={cn(
                "relative z-10 flex-1 rounded-md px-4 py-1.5 text-xs font-medium transition-colors duration-200",
                tab === "top10"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Top 10
            </button>
            <button
              type="button"
              onClick={() => setTab("all")}
              className={cn(
                "relative z-10 flex-1 rounded-md px-4 py-1.5 text-xs font-medium transition-colors duration-200",
                tab === "all"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              全部记录
            </button>
          </nav>

          <section className="rounded-xl bg-black/5 dark:bg-white/5 border border-white/5 p-4 shrink-0 relative overflow-hidden">
            <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">今日概览</h2>
            {dailyLoading ? (
              <p className="mt-3 text-xs text-muted-foreground">加载中...</p>
            ) : (
              <div className="mt-3 flex items-center gap-4">
                <div className="pr-4 border-r border-border">
                  <p className="text-2xl font-bold tracking-tight">
                    {dailySummary?.total_play_events ?? 0}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">播放首数</p>
                </div>

                {dailySummary?.top_song ? (
                  <div className="flex min-w-0 items-center gap-3">
                    <OptionalCoverImage
                      coverPath={dailySummary.top_song.cover_path}
                      className="h-10 w-10 rounded-lg shadow-md ring-1 ring-white/10"
                    />
                    <div className="min-w-0 flex flex-col justify-center">
                      <p className="truncate text-xs font-semibold text-foreground">{dailySummary.top_song.title}</p>
                      <p className="truncate text-[10px] text-muted-foreground mt-0.5">{dailySummary.top_song.artist}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">今日暂无 Top 歌曲</p>
                )}
              </div>
            )}
          </section>

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <AnimatePresence mode="wait">
              {tab === "top10" ? (
                <motion.div
                  key="top10"
                  initial={{ opacity: 0, x: -5, filter: "blur(2px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: 5, filter: "blur(2px)" }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="absolute inset-0 flex flex-col"
                >
                  <MusicTop10List records={top10} loading={top10Loading} />
                </motion.div>
              ) : (
                <motion.div
                  key="all"
                  initial={{ opacity: 0, x: 5, filter: "blur(2px)" }}
                  animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, x: -5, filter: "blur(2px)" }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="absolute inset-0 flex flex-col"
                >
                  <Card className="glass-card border-none flex-1 flex flex-col min-h-0 p-4 relative overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 shrink-0 mb-3">
                      <h2 className="text-sm font-semibold text-muted-foreground tracking-wide">播放历史</h2>
                      {!historyLoading && history.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="text-muted-foreground mr-1">
                            {historyPage} / {totalHistoryPages}
                          </span>
                          <button
                            type="button"
                            disabled={historyPage <= 1}
                            onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                            className="rounded text-muted-foreground p-1 transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="15 18 9 12 15 6" /></svg>
                          </button>
                          <button
                            type="button"
                            disabled={historyPage >= totalHistoryPages}
                            onClick={() => setHistoryPage((prev) => Math.min(totalHistoryPages, prev + 1))}
                            className="rounded text-muted-foreground p-1 transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><polyline points="9 18 15 12 9 6" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar pr-1">
                      {historyLoading ? (
                        <p className="mt-2 text-xs text-muted-foreground">加载中...</p>
                      ) : history.length === 0 ? (
                        <p className="mt-4 text-xs text-muted-foreground text-center py-8">暂无记录</p>
                      ) : (
                        <div className="space-y-1">
                          {pagedHistory.map((item) => (
                            <div
                              key={`${item.artist}-${item.title}-${item.last_played}`}
                              className={cn(
                                "group flex items-center gap-3 rounded-lg p-2 transition-all duration-200",
                                "hover:bg-white/5"
                              )}
                            >
                              <CoverImage coverPath={item.cover_path} size="sm" className="w-8 h-8 shadow-sm rounded-md ring-1 ring-white/5 opacity-90 group-hover:opacity-100 transition-opacity" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">{item.title}</p>
                                <p className="truncate text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground">{item.artist}</p>
                              </div>
                              <span className="shrink-0 text-[10px] text-muted-foreground/50 font-medium group-hover:text-muted-foreground transition-colors px-1">
                                {item.play_count} 次
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </div>

      <MusicSettingsModal
        show={showSettings}
        settings={settings}
        settingsLoading={settingsLoading}
        settingsSaving={settingsSaving}
        settingsMessage={settingsMessage}
        controlSources={controlSources}
        hotkeyCapture={hotkeyCapture}
        hotkeyInputRefs={hotkeyInputRefs}
        showUnsavedPrompt={showUnsavedPrompt}
        hotkeyFieldValue={hotkeyFieldValue}
        onStartHotkeyCapture={startHotkeyCapture}
        onPatchSettings={patchSettings}
        onToggleVisibleKey={toggleVisibleKey}
        onToggleWhitelistSource={toggleWhitelistSource}
        onAllowAllSources={() => patchSettings({ music_control_whitelist: [] })}
        onRequestClose={requestCloseSettings}
        onSave={() => {
          void saveSettings();
        }}
        onDiscardAndClose={discardAndCloseSettings}
        onSaveAndClose={() => {
          void saveAndCloseSettings();
        }}
        onCloseUnsavedPrompt={() => setShowUnsavedPrompt(false)}
      />
    </div>
  );
}
