import type { LyricLine, MusicLyricsCandidate } from "../types/music.types";

export function resolvePlaybackMs(
  positionSecs: number | null | undefined,
  offsetMs: number,
): number | null {
  if (positionSecs == null || Number.isNaN(positionSecs)) {
    return null;
  }
  return Math.max(0, Math.round(positionSecs * 1000) + offsetMs);
}

export function findCurrentLyricLineIndex(
  lines: LyricLine[],
  playbackMs: number | null | undefined,
): number {
  if (lines.length === 0 || playbackMs == null || Number.isNaN(playbackMs)) return -1;

  let low = 0;
  let high = lines.length - 1;
  let best = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = lines[mid];

    if (playbackMs < line.start_ms) {
      high = mid - 1;
    } else {
      best = mid;
      low = mid + 1;
    }
  }

  if (best < 0) return -1;

  const line = lines[best];
  if (playbackMs >= line.start_ms && playbackMs <= line.end_ms) {
    return best;
  }

  if (best < lines.length - 1 && playbackMs < lines[best + 1].start_ms) {
    return best;
  }

  return best;
}

export function resolveCurrentLyricText(
  lines: LyricLine[],
  playbackMs: number | null | undefined,
): string | null {
  const index = findCurrentLyricLineIndex(lines, playbackMs);
  if (index < 0) return null;
  const text = lines[index]?.text?.trim();
  return text ? text : null;
}

export function resolveLyricLineDisplayText(line: LyricLine): string {
  const text = line.text?.trim();
  return text && text.length > 0 ? text : "♪";
}

export function resolveLyricsProviderLabel(provider?: string | null): string {
  const value = provider?.trim().toLowerCase() ?? "";
  if (!value) return "未知来源";

  if (value.startsWith("qqmusic") || value.startsWith("scrape_qqmusic")) {
    return "QQ音乐";
  }
  if (value.startsWith("netease") || value.startsWith("scrape_netease")) {
    return "网易云音乐";
  }
  if (value.startsWith("kugou") || value.startsWith("scrape_kugou")) {
    return "酷狗音乐";
  }
  if (value.startsWith("kuwo") || value.startsWith("scrape_kuwo")) {
    return "酷我音乐";
  }
  if (value === "lrclib") {
    return "LRCLIB";
  }
  return provider ?? "未知来源";
}

function stripLyricModeTag(label: string): string {
  return label
    .replace(/[（(]\s*(?:mode\s*:\s*)?(?:word|line|逐字|逐行|译文|翻译|罗马音|romanized)\s*[）)]/gi, "")
    .replace(/[（(][^）)]*(?:逐字|逐行|译文|翻译|罗马音|word|line|romanized)[^）)]*[）)]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatLyricsCandidateLabel(candidate: MusicLyricsCandidate): string {
  const source = resolveLyricsProviderLabel(candidate.provider);
  return `${stripLyricModeTag(candidate.label)} · ${source}`;
}
