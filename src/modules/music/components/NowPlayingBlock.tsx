import { cn } from "@/lib/utils";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { CoverImage } from "./CoverImage";
import { usePlaybackClock } from "../hooks/usePlaybackClock";
import type { CurrentPlayingInfo } from "../types/music.types";

export function NowPlayingBlock({
  current,
  lyricText,
}: {
  current: CurrentPlayingInfo | null;
  lyricText?: string | null;
}) {
  const playbackTrackKey = `${current?.source_app_id ?? ""}::${current?.artist ?? ""}::${current?.title ?? ""}`;
  const livePositionSecs = usePlaybackClock(
    current?.position_secs,
    current?.playback_status,
    current?.duration_secs,
    current?.position_sampled_at_ms,
    playbackTrackKey,
  );
  const displayPosition = livePositionSecs ?? current?.position_secs ?? 0;
  const duration = current?.duration_secs ?? 0;
  const progress = duration > 0
    ? Math.min(1, Math.max(0, displayPosition / duration))
    : 0;
  const normalizedLyric = lyricText?.trim() ?? "";

  if (!current || (current.artist === "" && current.title === "")) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2 pr-5",
        "transition-all duration-300 ease-out",
      )}
    >
      <div className="relative flex-shrink-0 flex items-center justify-center size-11">
        {duration > 0 && (
          <svg className="absolute inset-0 size-full -rotate-90 pointer-events-none scale-110" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="4" className="text-black/10 dark:text-white/10" />
            <circle
              cx="50" cy="50" r="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray="301.6"
              strokeDashoffset={301.6 - (301.6 * progress)}
              strokeLinecap="round"
              className="text-primary will-change-[stroke-dashoffset] drop-shadow-[0_0_3px_rgba(var(--primary),0.5)]"
            />
          </svg>
        )}
        <CoverImage
          coverPath={current.cover_path}
          dataUrl={current.cover_data_url ?? null}
          size="md"
          className={cn(
            "size-10 shadow-sm rounded-full object-cover ring-1 ring-white/10",
            current.playback_status === "Playing" ? "animate-[spin_20s_linear_infinite]" : ""
          )}
        />
      </div>

      <div className="flex flex-col justify-center w-[180px] overflow-hidden">
        <MarqueeText className="inline-flex items-baseline gap-2">
          <span className="text-[13px] font-bold text-foreground tracking-tight drop-shadow-sm whitespace-nowrap">
            {current.title || "未知标题"}
          </span>
        </MarqueeText>

        {normalizedLyric ? (
          <div className="mt-0.5 overflow-hidden">
            <MarqueeText
              className="text-[11px] font-semibold text-emerald-500/90 dark:text-emerald-400/90 tracking-wide"
            >
              {normalizedLyric}
            </MarqueeText>
          </div>
        ) : (
          <div className="mt-0.5 text-[10px] flex items-center gap-1.5 text-muted-foreground/60">
            <span className={cn(
              "size-1.5 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.5)]",
              current.playback_status === "Playing" ? "bg-green-500/80 animate-pulse" : "bg-zinc-500/80"
            )}></span>
            {current.playback_status === "Playing" ? "正在播放" : "已暂停"}
          </div>
        )}
      </div>
    </div>
  );
}
