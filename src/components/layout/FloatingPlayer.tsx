 
 
 import { useEffect, useMemo, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCurrentPlaying } from "@/modules/music/hooks/useCurrentPlaying";
import { useMusicControl } from "@/modules/music/hooks/useMusicControl";
import { useMusicLyrics } from "@/modules/music/hooks/useMusicLyrics";
import { usePlaybackClock } from "@/modules/music/hooks/usePlaybackClock";
import { getMusicSettings } from "@/modules/music/services/musicService";
import type { MusicSettings } from "@/modules/music/types/music.types";
import { resolveCurrentLyricText, resolvePlaybackMs } from "@/modules/music/utils/lyrics";
import { NowPlayingBlock } from "@/modules/music/components/NowPlayingBlock";

const DEFAULT_FLOAT_SETTINGS = {
  lyricsEnabled: true,
  lyricsOffsetMs: 0,
};

function mapFloatSettings(settings: MusicSettings | null) {
  if (!settings) return DEFAULT_FLOAT_SETTINGS;
  return {
    lyricsEnabled: settings.music_lyrics_enabled,
    lyricsOffsetMs: settings.music_lyrics_offset_ms,
  };
}

export function FloatingPlayer() {
  const { data: current } = useCurrentPlaying();
  const [floatSettings, setFloatSettings] = useState(DEFAULT_FLOAT_SETTINGS);

  const { state: controlState, runCommand, runningCommand } = useMusicControl();

  const livePlaybackPositionSecs = usePlaybackClock(
    current?.position_secs,
    current?.playback_status,
    current?.duration_secs,
  );

  const lyrics = useMusicLyrics({
    current,
    enabled: floatSettings.lyricsEnabled,
    playbackPositionSecs: livePlaybackPositionSecs,
    offsetMs: floatSettings.lyricsOffsetMs,
    autoReview: false,
  });

  const floatingLyricText = useMemo(() => {
    if (!floatSettings.lyricsEnabled || !current || !lyrics.response?.ok) {
      return null;
    }
    const playbackMs = resolvePlaybackMs(livePlaybackPositionSecs, floatSettings.lyricsOffsetMs);
    return resolveCurrentLyricText(lyrics.response.lines, playbackMs);
  }, [
    current,
    floatSettings.lyricsEnabled,
    floatSettings.lyricsOffsetMs,
    livePlaybackPositionSecs,
    lyrics.response,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
setFloatSettings(DEFAULT_FLOAT_SETTINGS);
      return;
    }

    const loadSettings = async () => {
      try {
        const settings = await getMusicSettings();
        setFloatSettings(mapFloatSettings(settings));
      } catch {
        setFloatSettings(DEFAULT_FLOAT_SETTINGS);
      }
    };
    void loadSettings();

    const unlistenPromise = listen<MusicSettings>("music:settings-changed", (event) => {
      setFloatSettings(mapFloatSettings(event.payload ?? null));
    });

    return () => {
      void unlistenPromise.then((fn) => fn()).catch(() => void 0);
    };
  }, []);

  if (!current || current.playback_status !== "Playing") {
    return null;
  }

  return (
    <div 
      className="fixed bottom-8 right-8 z-50 animate-in slide-in-from-bottom-6 fade-in duration-400 ease-out group cursor-pointer"
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (controlState?.target?.supports_play_pause && runningCommand === null) {
          void runCommand("play_pause");
        }
      }}
      title="双击播放/暂停"
    >
      <div className="relative overflow-hidden rounded-full shadow-lg ring-1 ring-white/10 backdrop-blur-xl bg-background/80 transition-transform duration-300 hover:scale-105 active:scale-95">
        {current.cover_data_url && (
          <div
            className="pointer-events-none absolute inset-0 z-0 scale-[1.2] blur-xl opacity-[0.25] dark:opacity-[0.15] mix-blend-overlay transition-opacity duration-300 group-hover:opacity-[0.3]"
            style={{
              backgroundImage: `url(${current.cover_data_url})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}
        <div className="relative z-10">
          <NowPlayingBlock current={current} lyricText={floatingLyricText} />
        </div>
      </div>
    </div>
  );
}
