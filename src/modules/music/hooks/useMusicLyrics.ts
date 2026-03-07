import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { getMusicLyrics } from "@/modules/music/services/musicService";
import type {
  CurrentPlayingInfo,
  LyricLine,
  MusicLyricsCandidate,
  MusicLyricsResponse,
} from "@/modules/music/types/music.types";

type UseMusicLyricsArgs = {
  current: CurrentPlayingInfo | null | undefined;
  enabled: boolean;
  playbackPositionSecs: number | null;
  offsetMs: number;
  autoReview?: boolean;
};

type UseMusicLyricsResult = {
  response: MusicLyricsResponse | null;
  loading: boolean;
  errorMessage: string | null;
  activeCandidateId: string | null;
  retry: () => void;
  selectCandidate: (id: string) => void;
};

function normalizeLine(input: {
  start_ms?: number;
  end_ms?: number;
  time_ms?: number;
  text?: string;
  translation?: string | null;
  romanized?: string | null;
}): LyricLine {
  const start = Number.isFinite(input.start_ms) ? Number(input.start_ms) : Number(input.time_ms ?? 0);
  const end = Number.isFinite(input.end_ms) ? Number(input.end_ms) : start + 3000;
  return {
    start_ms: Math.max(0, start),
    end_ms: Math.max(start, end),
    text: (input.text ?? "").trim(),
    translation: input.translation ?? null,
    romanized: input.romanized ?? null,
  };
}

function normalizeLyricsResponse(raw: unknown): MusicLyricsResponse {
  const value = (raw ?? {}) as Record<string, unknown>;
  const linesRaw = Array.isArray(value.lines) ? value.lines : [];
  const lines = linesRaw
    .map((line) => normalizeLine(line as Record<string, unknown> as {
      start_ms?: number;
      end_ms?: number;
      time_ms?: number;
      text?: string;
      translation?: string | null;
      romanized?: string | null;
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.start_ms - b.start_ms);

  const provider = typeof value.provider === "string" ? value.provider : null;
  const candidateId = typeof value.candidate_id === "string"
    ? value.candidate_id
    : `auto:${provider ?? "unknown"}`;

  const candidates: MusicLyricsCandidate[] = Array.isArray(value.candidates)
    ? (value.candidates as MusicLyricsCandidate[])
    : [{ id: candidateId, label: "默认歌词", provider }];

  const found = typeof value.found === "boolean" ? value.found : lines.length > 0;

  return {
    ok: typeof value.ok === "boolean" ? value.ok : found,
    found,
    provider,
    from_cache: Boolean(value.from_cache),
    reason_message: typeof value.reason_message === "string" ? value.reason_message : null,
    candidate_id: candidateId,
    candidates,
    lines,
    plain_text: typeof value.plain_text === "string" ? value.plain_text : null,
  };
}

export function useMusicLyrics({ current, enabled }: UseMusicLyricsArgs): UseMusicLyricsResult {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [response, setResponse] = useState<MusicLyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const trackKeyRef = useRef<string>("");

  const trackKey = `${current?.artist ?? ""}::${current?.title ?? ""}`;

  useEffect(() => {
    if (!enabled || !isTauri || !current?.artist || !current?.title) {
      setResponse(null);
      setErrorMessage(null);
      setLoading(false);
      setActiveCandidateId(null);
      return;
    }

    if (trackKeyRef.current !== trackKey) {
      trackKeyRef.current = trackKey;
      setActiveCandidateId(null);
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);

    void (async () => {
      try {
        const raw = await getMusicLyrics({
          artist: current.artist,
          title: current.title,
          duration_secs: current.duration_secs,
          candidate_id: activeCandidateId ?? undefined,
          source_app_id: current.source_app_id,
          source_platform: current.source_platform,
        });
        if (cancelled) return;
        const normalized = normalizeLyricsResponse(raw);
        setResponse(normalized);
        setActiveCandidateId((prev) => prev ?? normalized.candidate_id ?? null);
      } catch (error) {
        if (cancelled) return;
        setResponse(null);
        setErrorMessage(error instanceof Error ? error.message : "歌词加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeCandidateId,
    current?.artist,
    current?.duration_secs,
    current?.title,
    enabled,
    isTauri,
    retryTick,
    trackKey,
  ]);

  const retry = useCallback(() => {
    setRetryTick((v) => v + 1);
  }, []);

  const selectCandidate = useCallback((id: string) => {
    setActiveCandidateId(id);
  }, []);

  return {
    response,
    loading,
    errorMessage,
    activeCandidateId,
    retry,
    selectCandidate,
  };
}
