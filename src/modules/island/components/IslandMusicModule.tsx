import { motion } from "framer-motion";
import { KaraokeLineText } from "@/modules/music/components/KaraokeLineText";
import { PlaybackActivity, PlaybackOrb } from "@/modules/island/components/IslandUi";
import type { IslandModuleDefinition } from "@/modules/island/types";

const ISLAND_MUSIC_FONT_FAMILY = '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

function getCapsuleOrbSize(height: number) {
  return Math.max(22, Math.min(28, height - 10));
}

function getExpandedOrbSize(height: number) {
  return Math.max(28, Math.min(34, height - 12));
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

    return (
      <motion.div layout className="flex h-full w-full items-center gap-3.5 px-4 py-[4px]">
        <PlaybackOrb
          size={orbSize}
          progress={context.music.playbackProgress}
          isPlaying={context.music.isPlaying}
          coverPath={context.music.current?.cover_path ?? null}
          coverDataUrl={context.music.current?.cover_data_url ?? null}
        />

        <div className="min-w-0 flex-1" style={{ fontFamily: ISLAND_MUSIC_FONT_FAMILY }}>
          <div className="truncate text-[9.5px] font-medium leading-[1.18] tracking-[0.08em] text-white/42">
            {context.music.titleLabel}
          </div>
          <div className="mt-0.5 pb-[8px]">
            <div className="truncate text-[16px] font-semibold leading-[1.28] tracking-[-0.025em] text-white">
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
            </div>
          </div>
        </div>
      </motion.div>
    );
  },
};
