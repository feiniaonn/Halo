import { motion } from "framer-motion";

import { MarqueeText } from "@/components/ui/MarqueeText";
import { PlaybackActivity, PlaybackOrb } from "@/modules/island/components/IslandUi";
import type { IslandModuleDefinition } from "@/modules/island/types";
import { KaraokeLineText } from "@/modules/music/components/KaraokeLineText";

const ISLAND_MUSIC_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

function getCapsuleOrbSize(height: number) {
  return Math.max(22, Math.min(28, height - 10));
}

function getExpandedOrbSize(height: number) {
  return Math.max(28, Math.min(34, height - 12));
}

function decodeEscapedUnicode(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  if (!text) return "";

  return text
    .replace(/\\U([0-9a-fA-F]{4})/g, "\\u$1")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const musicIslandModule: IslandModuleDefinition = {
  id: "music",
  priority: 100,
  isActive: (context) => context.music.isVisible,
  canExpand: (context) => context.music.isVisible,
  renderCapsule: (context) => {
    const orbSize = getCapsuleOrbSize(context.frame.height);

    return (
      <motion.div layout className="flex h-full w-full items-center justify-between gap-4 px-3.5">
        <PlaybackOrb
          size={orbSize}
          progress={context.music.playbackProgress}
          isPlaying={context.music.isPlaying}
          coverPath={context.music.current?.cover_path ?? null}
          coverDataUrl={context.music.current?.cover_data_url ?? null}
        />

        <div className="flex min-w-0 flex-1 items-center justify-end pl-2">
          <PlaybackActivity isPlaying={context.music.isPlaying} className="h-4.5" />
        </div>
      </motion.div>
    );
  },
  renderExpanded: (context) => {
    const orbSize = getExpandedOrbSize(context.frame.height);
    const lyricLabel = context.music.lyricLine?.trim() || "等待歌词同步";
    const activeLyricLine = context.music.activeLyricLine;
    const rawRecommendationSong = decodeEscapedUnicode(context.music.recommendationSong);
    const rawRecommendationMood = decodeEscapedUnicode(context.music.recommendationMood);
    const hasRecommendation = Boolean(rawRecommendationSong);

    return (
      <motion.div layout className="flex h-full w-full items-center gap-3 px-4 py-[4px]">
        <PlaybackOrb
          size={orbSize}
          progress={context.music.playbackProgress}
          isPlaying={context.music.isPlaying}
          coverPath={context.music.current?.cover_path ?? null}
          coverDataUrl={context.music.current?.cover_data_url ?? null}
        />

        <div className="min-w-0 flex-1 pr-1" style={{ fontFamily: ISLAND_MUSIC_FONT_FAMILY }}>
          <div className="truncate text-[9.5px] font-medium leading-[1.18] tracking-[0.08em] text-white/42">
            {context.music.titleLabel}
          </div>
          <div className="mt-0.5 pb-[8px]">
            <MarqueeText
              containerClassName="w-full"
              className="text-[16px] font-semibold leading-[1.28] tracking-[-0.025em] text-white"
            >
              {activeLyricLine ? (
                <KaraokeLineText
                  line={activeLyricLine}
                  playbackMs={context.music.lyricPlaybackMs}
                  inactiveClassName="text-white/32"
                  activeClassName="text-white"
                />
              ) : (
                lyricLabel
              )}
            </MarqueeText>
          </div>
        </div>

        {hasRecommendation && (
          <div className="ml-auto flex min-w-0 max-w-[45%] shrink-0 flex-col items-end pl-4" style={{ fontFamily: ISLAND_MUSIC_FONT_FAMILY }}>
            {/* 顶部推荐歌曲 (类似左侧的 titleLabel) */}
            <div className="flex max-w-full min-w-0 items-center justify-end gap-[4px] opacity-90 text-[10px] leading-tight">
              <span className="shrink-0 font-normal tracking-wide text-white/40">
                推荐
              </span>
              <div className="min-w-0 flex shrink-0 justify-end items-center">
                <MarqueeText
                  containerClassName="max-w-full"
                  className="font-medium tracking-[0.04em] text-white/60"
                >
                  《{rawRecommendationSong}》
                </MarqueeText>
              </div>
            </div>

            {/* 底部心情展示 (类似左侧的歌词) */}
            <div className="mt-[3px] pb-[8px] flex w-full min-w-0 items-center justify-end">
              <div className="truncate text-right text-[12.5px] font-medium tracking-[-0.01em] text-white/50">
                <span className="mr-1.5 text-[10px] font-normal tracking-wide text-white/30">
                  听歌氛围
                </span>
                {rawRecommendationMood}
              </div>
            </div>
          </div>
        )}
      </motion.div>
    );
  },
};
