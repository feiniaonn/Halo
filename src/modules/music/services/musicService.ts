import { invoke } from "@tauri-apps/api/core";
import type {
  CurrentPlayingInfo,
  MusicCommand,
  MusicControlOptions,
  MusicControlResult,
  MusicControlSource,
  MusicControlState,
  MusicDailySummary,
  MusicLyricsRequest,
  MusicLyricsResponse,
  MusicSettings,
  MusicSettingsPatch,
  PlayRecord,
} from "../types/music.types";

export async function getPlayHistory(limit = 100): Promise<PlayRecord[]> {
  return invoke<PlayRecord[]>("music_get_play_history", { limit });
}

export async function getTop10(): Promise<PlayRecord[]> {
  return invoke<PlayRecord[]>("music_get_top10");
}

export async function getCurrentPlaying(): Promise<CurrentPlayingInfo | null> {
  return invoke<CurrentPlayingInfo | null>("music_get_current");
}

export async function getCoverDataUrl(path: string): Promise<string | null> {
  return invoke<string | null>("get_cover_data_url", { path });
}

export async function getMusicControlState(): Promise<MusicControlState> {
  return invoke<MusicControlState>("music_get_control_state");
}

export async function getMusicControlSources(): Promise<MusicControlSource[]> {
  return invoke<MusicControlSource[]>("music_get_control_sources");
}

export async function musicControl(
  command: MusicCommand,
  options?: MusicControlOptions,
): Promise<MusicControlResult> {
  return invoke<MusicControlResult>("music_control", { command, options });
}

export async function getMusicSettings(): Promise<MusicSettings> {
  return invoke<MusicSettings>("get_music_settings");
}

export async function setMusicSettings(patch: MusicSettingsPatch): Promise<void> {
  return invoke("set_music_settings", { patch });
}

export async function getMusicDailySummary(): Promise<MusicDailySummary> {
  return invoke<MusicDailySummary>("music_get_daily_summary");
}

export async function getMusicLyrics(
  request: MusicLyricsRequest,
): Promise<MusicLyricsResponse> {
  return invoke<MusicLyricsResponse>("music_get_lyrics", { request });
}

export async function clearMusicLyricsCache(): Promise<void> {
  return invoke("music_clear_lyrics_cache");
}
