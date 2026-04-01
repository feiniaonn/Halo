import type { ReactNode } from "react";
import type { CurrentPlayingInfo } from "@/modules/music/types/music.types";
import type { LyricLine } from "@/modules/music/types/music.types";

export type IslandDensity = "tight" | "compact" | "comfortable";
export type IslandFrameState = "capsule" | "expanded";

export interface IslandFrameContext {
  state: IslandFrameState;
  width: number;
  height: number;
  density: IslandDensity;
}

export interface IslandMusicRenderContext {
  current: CurrentPlayingInfo | null;
  isVisible: boolean;
  isPlaying: boolean;
  lyricLine: string | null;
  activeLyricLine: LyricLine | null;
  lyricPlaybackMs: number | null;
  playbackProgress: number;
  titleLabel: string;
  playbackStateLabel: string;
  recommendationSong: string | null;
  recommendationMood: string | null;
}

export interface IslandClockRenderContext {
  timeLabel: string;
}

export interface IslandModuleRenderContext {
  frame: IslandFrameContext;
  music: IslandMusicRenderContext;
  clock: IslandClockRenderContext;
}

export interface IslandModuleDefinition {
  id: string;
  priority: number;
  isActive: (context: IslandModuleRenderContext) => boolean;
  canExpand?: (context: IslandModuleRenderContext) => boolean;
  renderCapsule: (context: IslandModuleRenderContext) => ReactNode;
  renderExpanded?: (context: IslandModuleRenderContext) => ReactNode;
}
