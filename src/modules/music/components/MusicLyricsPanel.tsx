import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { ACTIVE_LINE_LEAD_MS, KaraokeLineText } from "@/modules/music/components/KaraokeLineText";
import { cn } from "@/lib/utils";
import type {
  CurrentPlayingInfo,
  LyricLine,
  MusicLyricsCandidate,
  MusicLyricsResponse,
} from "../types/music.types";
import {
  findCurrentLyricLineIndex,
  formatLyricsCandidateLabel,
  resolveLyricLineDisplayText,
  resolveLyricsProviderLabel,
  resolvePlaybackMs,
} from "../utils/lyrics";

type MusicLyricsPanelProps = {
  current: CurrentPlayingInfo;
  playbackPositionSecs: number | null;
  response: MusicLyricsResponse | null;
  loading: boolean;
  errorMessage: string | null;
  showTranslation: boolean;
  showRomanized: boolean;
  offsetMs: number;
  devMode: boolean;
  activeCandidateId: string | null;
  onSelectCandidate: (id: string) => void;
};

const LYRICS_ROW_HEIGHT = 64;
const LYRICS_VISIBLE_ROWS = 5;
const LYRICS_CENTER_SLOT = Math.floor(LYRICS_VISIBLE_ROWS / 2);

function renderLineText(
  line: LyricLine,
  options?: {
    playbackMs?: number | null;
    wordTimed?: boolean;
  },
) {
  if (options?.wordTimed && line.words && line.words.length > 0) {
    return <KaraokeLineText line={line} playbackMs={options.playbackMs ?? null} />;
  }
  return <span>{resolveLyricLineDisplayText(line)}</span>;
}

function resolveRowMotion(distance: number): { opacity: number; scale: number } {
  if (distance <= 0) return { opacity: 1, scale: 1 };
  if (distance === 1) return { opacity: 0.9, scale: 0.988 };
  if (distance === 2) return { opacity: 0.76, scale: 0.972 };
  if (distance === 3) return { opacity: 0.58, scale: 0.956 };
  return { opacity: 0.42, scale: 0.944 };
}

function normalizeSubline(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = text
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function LyricsCandidateSelect({
  candidates,
  value,
  onChange,
}: {
  candidates: MusicLyricsCandidate[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedCandidate = candidates.find((c) => c.id === value) || candidates[0];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all w-52 focus:outline-none focus:ring-2 focus:ring-primary/20",
          isOpen
            ? "bg-background/80 border-primary/30 text-foreground ring-2 ring-primary/10 shadow-lg"
            : "bg-black/10 hover:bg-black/20 dark:bg-white/5 dark:hover:bg-white/10 border-transparent hover:border-white/10 text-muted-foreground hover:text-foreground"
        )}
      >
        <span className="truncate">{selectedCandidate ? formatLyricsCandidateLabel(selectedCandidate) : "选择歌词"}</span>
        <ChevronDown className={cn("size-3.5 opacity-50 shrink-0 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full left-0 mt-1.5 w-64 max-h-60 overflow-y-auto rounded-xl border border-border/50 bg-popover/95 backdrop-blur-xl p-1 shadow-2xl z-50 ring-1 ring-black/5"
          >
            {candidates.map((candidate) => {
              const isActive = candidate.id === value;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => {
                    onChange(candidate.id);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full text-left px-2.5 py-2 text-[11px] rounded-lg transition-colors truncate group",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                  )}
                  title={formatLyricsCandidateLabel(candidate)}
                >
                  <span className="flex-1 truncate">{formatLyricsCandidateLabel(candidate)}</span>
                  {isActive && <Check className="size-3 shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MusicLyricsPanel({
  current,
  playbackPositionSecs,
  response,
  loading,
  errorMessage,
  showTranslation,
  showRomanized,
  offsetMs,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  devMode: _devMode,
  activeCandidateId,
  onSelectCandidate,
}: MusicLyricsPanelProps) {
  const lines = useMemo(() => response?.lines ?? [], [response?.lines]);
  const playbackMs = resolvePlaybackMs(playbackPositionSecs ?? current.position_secs, offsetMs);
  const activeLinePlaybackMs = playbackMs == null ? null : playbackMs + ACTIVE_LINE_LEAD_MS;
  const providerLabel = resolveLyricsProviderLabel(response?.provider);
  const providerHint = response?.from_cache ? `${providerLabel}（缓存）` : providerLabel;
  const trackKey = `${current.artist ?? ""}::${current.title ?? ""}`;

  const currentLineIndex = useMemo(
    () => findCurrentLyricLineIndex(lines, activeLinePlaybackMs),
    [activeLinePlaybackMs, lines],
  );
  const [stableCenterIndex, setStableCenterIndex] = useState(0);

  useEffect(() => {
    setStableCenterIndex(0);
  }, [trackKey]);

  const centerIndex = useMemo(() => {
    if (lines.length === 0) {
      return 0;
    }

    if (currentLineIndex >= 0) {
      const next = Math.min(lines.length - 1, currentLineIndex);
      return next;
    }

    const fallback = Math.min(lines.length - 1, Math.max(0, stableCenterIndex));
    return fallback;
  }, [currentLineIndex, lines.length, stableCenterIndex]);

  useEffect(() => {
    setStableCenterIndex(centerIndex);
  }, [centerIndex]);

  const scrollOffsetY = useMemo(() => -centerIndex * LYRICS_ROW_HEIGHT, [centerIndex]);

  const panelShell =
    "halo-lyrics-panel relative flex-1 min-h-[300px] overflow-hidden rounded-[24px] border bg-[var(--halo-lyrics-panel-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl";
  const baseContainer = `${panelShell} p-4`;

  if (loading && (!response?.ok || lines.length === 0)) {
    return (
      <section className={baseContainer}>
        <div className="text-sm text-muted-foreground">歌词加载中...</div>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className={baseContainer}>
        <p className="text-sm text-muted-foreground">歌词加载失败：{errorMessage}</p>
      </section>
    );
  }

  if (!response?.ok || lines.length === 0) {
    return (
      <section className={baseContainer}>
        <div className="flex h-full min-h-[120px] items-center justify-center">
          <p className="text-sm text-muted-foreground/80">
            {response?.reason_message ?? "暂时没有可用歌词，请检查网络或切换源"}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(panelShell, "flex flex-col px-3 py-3")}
      style={{ borderColor: "var(--halo-lyrics-panel-border)" }}
    >
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="halo-lyrics-panel-layer absolute inset-0 bg-[linear-gradient(180deg,var(--halo-lyrics-panel-highlight),transparent_24%,transparent_76%,var(--halo-lyrics-panel-highlight))]" />
        <div className="halo-lyrics-panel-glow absolute inset-x-10 top-0 h-24 rounded-full bg-[var(--halo-lyrics-panel-primary-glow)] blur-3xl" />
      </div>

      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex gap-2">
            <LyricsCandidateSelect
              candidates={response.candidates}
              value={activeCandidateId ?? response.candidate_id ?? ""}
              onChange={onSelectCandidate}
            />
          </div>

          <span
            className="halo-lyrics-provider-chip max-w-[120px] truncate rounded-md border px-2.5 py-1 text-[10px] font-mono text-foreground/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            style={{
              borderColor: "var(--halo-lyrics-provider-border)",
              backgroundColor: "var(--halo-lyrics-provider-bg)",
            }}
            title={providerHint}
          >
            {providerHint}
          </span>
        </div>

        <div
          className="relative flex-1 overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)",
          }}
        >
          <div
            className="halo-lyrics-current-highlight pointer-events-none absolute left-0 right-0 z-0 rounded-xl"
            style={{
              top: `${LYRICS_CENTER_SLOT * LYRICS_ROW_HEIGHT + 4}px`,
              height: `${LYRICS_ROW_HEIGHT - 8}px`,
            }}
          >
            <div className="absolute inset-0 rounded-xl border bg-[var(--halo-lyrics-panel-bg-strong)]" style={{ borderColor: "var(--halo-lyrics-panel-border)" }} />
            <div className="absolute inset-0 rounded-xl bg-[var(--halo-lyrics-panel-primary-glow)] blur-xl" />
          </div>

          <div
            className="absolute inset-x-0 z-[5] will-change-transform transition-transform duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ transform: `translateY(${scrollOffsetY}px)` }}
          >
            <div style={{ height: `${LYRICS_CENTER_SLOT * LYRICS_ROW_HEIGHT}px` }} />
            {lines.map((line, index) => {
              const distance = Math.abs(index - centerIndex);
              const { opacity, scale } = resolveRowMotion(distance);
              const isCenterSlot = index === centerIndex;
              const translation = normalizeSubline(line.translation);
              const romanized = normalizeSubline(line.romanized);
              const secondary = showTranslation
                ? translation
                : showRomanized
                  ? romanized
                  : null;

              return (
                <div
                  key={`lyrics-row-${index}-${line.start_ms}`}
                  className={cn(
                    "flex origin-left items-center px-4 transition-all duration-500 ease-out",
                    isCenterSlot
                      ? "text-foreground"
                      : "text-[color:var(--halo-lyrics-row-color)]",
                  )}
                  style={{
                    height: `${LYRICS_ROW_HEIGHT}px`,
                    opacity,
                    transform: `scale(${scale})`,
                    textShadow: isCenterSlot
                      ? "var(--halo-lyrics-center-shadow)"
                      : "var(--halo-lyrics-row-shadow)",
                  }}
                >
                  <div className="min-w-0 w-full flex flex-col gap-0.5">
                    {isCenterSlot ? (
                        <MarqueeText
                          className="text-[20px] font-bold leading-tight tracking-tight transition-all duration-500"
                        >
                          {renderLineText(line, {
                            playbackMs,
                            wordTimed: true,
                          })}
                        </MarqueeText>
                      ) : (
                      <p
                        className="truncate text-[15px] font-medium leading-tight tracking-[-0.01em] transition-all duration-500"
                      >
                        {renderLineText(line)}
                      </p>
                    )}
                    {secondary && (
                      isCenterSlot ? (
                        <MarqueeText
                          className="mt-0.5 text-[13px] font-medium text-foreground/84 transition-all duration-500"
                        >
                          {secondary}
                        </MarqueeText>
                      ) : (
                        <p
                          className="mt-0.5 truncate text-[11px] text-[color:var(--halo-lyrics-subline-color)] transition-all duration-500"
                        >
                          {secondary}
                        </p>
                      )
                    )}
                  </div>
                </div>
              );
            })}
            <div style={{ height: `${LYRICS_CENTER_SLOT * LYRICS_ROW_HEIGHT}px` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
