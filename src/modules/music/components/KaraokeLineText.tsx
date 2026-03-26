import { createRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { LyricLine, LyricWord } from "../types/music.types";
import { resolveLyricLineDisplayText } from "../utils/lyrics";

export const ACTIVE_LINE_LEAD_MS = 140;
const WORD_TIMED_RENDER_LEAD_MS = 80;

type KaraokeLineTextProps = {
  line: LyricLine;
  playbackMs: number | null;
  inactiveClassName?: string;
  activeClassName?: string;
};

type WordSegmentMetric = {
  left: number;
  width: number;
  right: number;
};
const CJK_LYRIC_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function KaraokeLineText({
  line,
  playbackMs,
  inactiveClassName = "text-foreground/22",
  activeClassName = "text-primary",
}: KaraokeLineTextProps) {
  if (!line.words || line.words.length === 0) {
    return <span>{resolveLyricLineDisplayText(line)}</span>;
  }

  return (
    <WordTimedLineText
      lineKey={`${line.start_ms}:${line.end_ms}:${line.text}`}
      words={line.words}
      playbackMs={playbackMs}
      inactiveClassName={inactiveClassName}
      activeClassName={activeClassName}
    />
  );
}

function WordTimedLineText({
  lineKey,
  words,
  playbackMs,
  inactiveClassName,
  activeClassName,
}: {
  lineKey: string;
  words: LyricWord[];
  playbackMs: number | null;
  inactiveClassName: string;
  activeClassName: string;
}) {
  const lineRef = useRef<HTMLSpanElement | null>(null);
  const shouldUseContinuousSweep = useMemo(
    () => words.some((word) => CJK_LYRIC_PATTERN.test(word.text)),
    [words],
  );
  const wordRefs = useMemo(
    () => words.map(() => createRef<HTMLSpanElement>()),
    [words],
  );
  const rawPlaybackMs = useMemo(
    () => resolveStableWordTimedPlaybackMs(playbackMs),
    [playbackMs],
  );
  const [stablePlaybackMs, setStablePlaybackMs] = useState(rawPlaybackMs);
  const [segmentMetrics, setSegmentMetrics] = useState<WordSegmentMetric[] | null>(null);
  const lastLineKeyRef = useRef(lineKey);
  const lastPlaybackMsRef = useRef<number | null>(rawPlaybackMs);

  useEffect(() => {
    if (!shouldUseContinuousSweep) {
      lastLineKeyRef.current = lineKey;
      lastPlaybackMsRef.current = rawPlaybackMs;
      return;
    }

    setStablePlaybackMs((previousPlaybackMs) => {
      if (lastLineKeyRef.current !== lineKey) {
        return rawPlaybackMs;
      }

      const committedPlaybackMs = lastPlaybackMsRef.current;
      if (rawPlaybackMs == null || committedPlaybackMs == null) {
        return rawPlaybackMs;
      }

      const playbackDelta = rawPlaybackMs - committedPlaybackMs;
      const likelySeek = playbackDelta < -450;
      const likelyJitter = playbackDelta < 0 && playbackDelta > -220;

      if (likelySeek) {
        return rawPlaybackMs;
      }

      if (likelyJitter) {
        return previousPlaybackMs;
      }

      return rawPlaybackMs;
    });

    lastLineKeyRef.current = lineKey;
    lastPlaybackMsRef.current = rawPlaybackMs;
  }, [lineKey, rawPlaybackMs, shouldUseContinuousSweep]);

  useLayoutEffect(() => {
    if (!shouldUseContinuousSweep) {
      return;
    }

    const element = lineRef.current;
    if (!element) return;

    let rafId = 0;
    let resizeObserver: ResizeObserver | null = null;

    const measure = () => {
      const nextMetrics = words.map((_, index) => {
        const wordNode = wordRefs[index]?.current;
        if (!wordNode) return null;
        const left = wordNode.offsetLeft;
        const width = wordNode.offsetWidth;
        return {
          left,
          width,
          right: left + width,
        };
      });

      if (nextMetrics.some((metric) => metric == null)) return;
      setSegmentMetrics(nextMetrics as WordSegmentMetric[]);
    };

    const scheduleMeasure = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        measure();
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
      });
      resizeObserver.observe(element);
    } else {
      window.addEventListener("resize", scheduleMeasure);
    }

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      if (!resizeObserver) {
        window.removeEventListener("resize", scheduleMeasure);
      }
    };
  }, [lineKey, shouldUseContinuousSweep, wordRefs, words]);

  const highlightWidth = useMemo(
    () => resolveHighlightWidth(words, segmentMetrics, stablePlaybackMs),
    [segmentMetrics, stablePlaybackMs, words],
  );

  const fallbackPlaybackMs = rawPlaybackMs;

  if (!shouldUseContinuousSweep) {
    return (
      <span className="inline whitespace-pre">
        {renderFallbackWordTimedText(
          words,
          lineKey,
          fallbackPlaybackMs,
          inactiveClassName,
          activeClassName,
        )}
      </span>
    );
  }

  if (!segmentMetrics || segmentMetrics.length !== words.length) {
    return (
      <span ref={lineRef} className="inline whitespace-pre">
        {renderFallbackWordTimedText(
          words,
          lineKey,
          fallbackPlaybackMs,
          inactiveClassName,
          activeClassName,
          wordRefs,
        )}
      </span>
    );
  }

  return (
    <span ref={lineRef} className="relative inline-block whitespace-pre align-baseline">
      <span className={cn("inline-block whitespace-pre", inactiveClassName)}>
        {words.map((word, index) => (
          <span
            key={`lyrics-word-base-${lineKey}-${word.start_ms}-${index}`}
            ref={wordRefs[index]}
            className="inline-block whitespace-pre"
          >
            {word.text}
          </span>
        ))}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden whitespace-pre"
        style={{ width: `${highlightWidth}px` }}
      >
        <span className={cn("inline-block whitespace-pre", activeClassName)}>
          {words.map((word, index) => (
            <span
              key={`lyrics-word-overlay-${lineKey}-${word.start_ms}-${index}`}
              className="inline-block whitespace-pre"
            >
              {word.text}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

function resolveStableWordTimedPlaybackMs(playbackMs: number | null) {
  if (playbackMs == null || Number.isNaN(playbackMs)) return null;
  return playbackMs + WORD_TIMED_RENDER_LEAD_MS;
}

function resolveWordProgress(word: LyricWord, playbackMs: number | null) {
  if (playbackMs == null || Number.isNaN(playbackMs)) return 0;
  if (playbackMs <= word.start_ms) return 0;
  if (playbackMs >= word.end_ms) return 1;

  const duration = Math.max(1, word.end_ms - word.start_ms);
  return Math.max(0, Math.min(1, (playbackMs - word.start_ms) / duration));
}

function resolveHighlightWidth(
  words: LyricWord[],
  segmentMetrics: WordSegmentMetric[] | null,
  playbackMs: number | null,
) {
  if (!segmentMetrics || segmentMetrics.length !== words.length || words.length === 0) {
    return 0;
  }

  if (playbackMs == null || Number.isNaN(playbackMs) || playbackMs <= words[0].start_ms) {
    return 0;
  }

  const lastMetric = segmentMetrics[segmentMetrics.length - 1];
  const lastWord = words[words.length - 1];
  if (playbackMs >= lastWord.end_ms) {
    return lastMetric.right;
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const metric = segmentMetrics[index];
    if (playbackMs <= word.end_ms) {
      return metric.left + metric.width * resolveWordProgress(word, playbackMs);
    }
  }

  return lastMetric.right;
}

function renderFallbackWordTimedText(
  words: LyricWord[],
  lineKey: string,
  playbackMs: number | null,
  inactiveClassName: string,
  activeClassName: string,
  wordRefs?: Array<ReturnType<typeof createRef<HTMLSpanElement>>>,
) {
  return words.map((word, index) => {
    const progress = resolveWordProgress(word, playbackMs);
    const isCompleted = progress >= 1;
    const isActive = progress > 0 && progress < 1;

    if (isCompleted) {
      return (
        <span
          key={`lyrics-word-${lineKey}-${word.start_ms}-${index}`}
          ref={wordRefs?.[index]}
          className={cn("whitespace-pre", activeClassName)}
        >
          {word.text}
        </span>
      );
    }

    if (isActive) {
      return (
        <span
          key={`lyrics-word-${lineKey}-${word.start_ms}-${index}`}
          ref={wordRefs?.[index]}
          className="relative inline-block whitespace-pre align-baseline"
        >
          <span className={cn(inactiveClassName)}>{word.text}</span>
          <span
            className={cn(
              "absolute left-0 top-0 overflow-hidden whitespace-pre",
              activeClassName,
            )}
            style={{ width: `${progress * 100}%` }}
          >
            {word.text}
          </span>
        </span>
      );
    }

    return (
      <span
        key={`lyrics-word-${lineKey}-${word.start_ms}-${index}`}
        ref={wordRefs?.[index]}
        className={cn("whitespace-pre", inactiveClassName)}
      >
        {word.text}
      </span>
    );
  });
}
