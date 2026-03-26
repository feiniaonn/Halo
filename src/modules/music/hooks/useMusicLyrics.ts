import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { getMusicLyrics } from "@/modules/music/services/musicService";
import type {
  CurrentPlayingInfo,
  LyricLine,
  LyricWord,
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

const LYRICS_REASON_TRANSLATIONS: Record<string, string> = {
  "artist or title is empty": "歌曲信息不完整，暂时无法获取歌词",
  "no lyrics found from any providers": "当前来源没有找到可用歌词",
  "no confident lyrics match found": "没有找到足够匹配的歌词，请切换候选或稍后再试",
  "parsed lyrics are empty": "已找到歌词源，但当前歌词格式暂时无法解析",
};

function translateLyricsReasonMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return LYRICS_REASON_TRANSLATIONS[trimmed.toLowerCase()] ?? trimmed;
}

function normalizeLine(input: {
  start_ms?: number;
  end_ms?: number;
  time_ms?: number;
  text?: string;
  translation?: string | null;
  romanized?: string | null;
  words?: Array<{
    start_ms?: number;
    end_ms?: number;
    text?: string;
  }> | null;
}): LyricLine {
  const start = Number.isFinite(input.start_ms) ? Number(input.start_ms) : Number(input.time_ms ?? 0);
  const end = Number.isFinite(input.end_ms) ? Number(input.end_ms) : start + 3000;
  const words = Array.isArray(input.words)
    ? input.words
      .map((word) => normalizeWord(word))
      .filter((word): word is LyricWord => word != null)
      .sort((a, b) => a.start_ms - b.start_ms)
    : [];
  return {
    start_ms: Math.max(0, start),
    end_ms: Math.max(start, end),
    text: (input.text ?? "").trim(),
    translation: input.translation ?? null,
    romanized: input.romanized ?? null,
    words,
  };
}

function normalizeWord(input: {
  start_ms?: number;
  end_ms?: number;
  text?: string;
}): LyricWord | null {
  const text = typeof input.text === "string" ? input.text : "";
  if (text.length === 0) return null;

  const start = Number.isFinite(input.start_ms) ? Number(input.start_ms) : 0;
  const end = Number.isFinite(input.end_ms) ? Number(input.end_ms) : start + 1;
  return {
    start_ms: Math.max(0, start),
    end_ms: Math.max(start + 1, end),
    text,
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
      words?: Array<{
        start_ms?: number;
        end_ms?: number;
        text?: string;
      }> | null;
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
    reason_message: translateLyricsReasonMessage(value.reason_message),
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

  const trackKey = [
    current?.artist ?? "",
    current?.title ?? "",
    current?.source_app_id ?? "",
    current?.source_platform ?? "",
    current?.duration_secs ?? "",
  ].join("::");

  useEffect(() => {
    if (!enabled || !isTauri || !current?.artist || !current?.title) {
      trackKeyRef.current = "";
      setResponse(null);
      setErrorMessage(null);
      setLoading(false);
      setActiveCandidateId(null);
      return;
    }

    const trackChanged = trackKeyRef.current !== trackKey;
    if (trackChanged) {
      trackKeyRef.current = trackKey;
      setResponse(null);
      setActiveCandidateId(null);
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    const requestTrackKey = trackKey;
    const requestCandidateId = trackChanged ? null : activeCandidateId;

    void (async () => {
      try {
        const raw = await getMusicLyrics({
          artist: current.artist,
          title: current.title,
          duration_secs: current.duration_secs,
          candidate_id: requestCandidateId ?? undefined,
          source_app_id: current.source_app_id,
          source_platform: current.source_platform,
        });
        if (cancelled || trackKeyRef.current !== requestTrackKey) return;
        const normalized = normalizeLyricsResponse(raw);
        setResponse(normalized);
        setActiveCandidateId((prev) => {
          if (trackKeyRef.current !== requestTrackKey) {
            return prev;
          }
          if (trackChanged) {
            return normalized.candidate_id ?? null;
          }
          return requestCandidateId ?? prev ?? normalized.candidate_id ?? null;
        });
      } catch (error) {
        if (cancelled || trackKeyRef.current !== requestTrackKey) return;
        setResponse(null);
        setErrorMessage(
          error instanceof Error
            ? translateLyricsReasonMessage(error.message) ?? error.message
            : "歌词加载失败",
        );
      } finally {
        if (!cancelled && trackKeyRef.current === requestTrackKey) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeCandidateId,
    current?.artist,
    current?.source_app_id,
    current?.source_platform,
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
