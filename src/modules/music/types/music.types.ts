export type PlayRecord = {
  artist: string;
  title: string;
  cover_path: string | null;
  play_count: number;
  last_played?: string | null;
};

export type CurrentPlayingInfo = {
  artist: string;
  title: string;
  cover_path: string | null;
  cover_data_url: string | null;
  duration_secs: number | null;
  position_secs: number | null;
  playback_status: string | null;
  source_app_id: string | null;
  source_platform: string | null;
};

export type MusicCommand = "previous" | "play_pause" | "next" | "refresh";

export type MusicControlOptions = {
  target_source_id?: string | null;
  timeout_ms?: number;
  retry_count?: number;
};

export type MusicControlSource = {
  source_id: string;
  source_name: string;
  source_kind: string;
  can_prev: boolean;
  can_play_pause: boolean;
  can_next: boolean;
};

export type MusicControlTarget = {
  source_id: string;
  source_name: string;
  source_kind: string;
  playback_status?: string | null;
  supports_previous?: boolean;
  supports_play_pause?: boolean;
  supports_next?: boolean;
};

export type MusicControlState = {
  target: MusicControlTarget | null;
  sources_count?: number;
  reason?: string | null;
};

export type MusicControlResult = {
  ok: boolean;
  message: string;
  command: string;
  target: MusicControlTarget | null;
  reason: string | null;
  retried: number;
};

export type MusicMiniVisibleKey = "previous" | "play_pause" | "next";

export type MusicSettings = {
  music_control_target_mode: "auto" | "browser" | "native";
  music_control_timeout_ms: number;
  music_control_retry_count: number;
  music_control_whitelist: string[];
  music_mini_controls_enabled: boolean;
  music_mini_visible_keys: MusicMiniVisibleKey[];
  music_mini_show_stats_without_session: boolean;
  music_hotkeys_enabled: boolean;
  music_hotkeys_scope: "focus" | "global";
  music_hotkeys_bindings: {
    previous: string | null;
    play_pause: string | null;
    next: string | null;
  };
  music_lyrics_enabled: boolean;
  music_lyrics_show_translation: boolean;
  music_lyrics_show_romanized: boolean;
  music_lyrics_offset_ms: number;
  music_lyrics_auto_follow: boolean;
  music_lyrics_manual_lock_ms: number;
  music_lyrics_scrape_enabled: boolean;
  music_lyrics_scrape_notice_ack: boolean;
};

export type MusicSettingsPatch = Partial<MusicSettings>;

export type MusicHotkeysBindings = MusicSettings["music_hotkeys_bindings"];

export type MusicLyricsRequest = {
  artist: string;
  title: string;
  album?: string | null;
  duration_secs?: number | null;
  candidate_id?: string | null;
  source_app_id?: string | null;
  source_platform?: string | null;
};

export type LyricLine = {
  start_ms: number;
  end_ms: number;
  text: string;
  translation?: string | null;
  romanized?: string | null;
};

export type MusicLyricsLine = LyricLine;

export type MusicLyricsCandidate = {
  id: string;
  label: string;
  provider?: string | null;
};

export type MusicLyricsResponse = {
  ok: boolean;
  found: boolean;
  provider?: string | null;
  from_cache?: boolean;
  reason_message?: string | null;
  candidate_id?: string | null;
  candidates: MusicLyricsCandidate[];
  lines: LyricLine[];
  plain_text?: string | null;
};

export type MusicDailySummary = {
  total_play_events: number;
  top_song: PlayRecord | null;
};
