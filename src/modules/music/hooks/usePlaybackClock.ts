 
 
import { useEffect, useRef, useState } from "react";

const PLAYBACK_REPORT_LATENCY_SECS = 0.14;
const TRACK_END_RESET_WINDOW_SECS = 0.35;
const PLAYBACK_REWIND_SNAP_SECS = 0.75;
const PLAYBACK_REWIND_IGNORE_WINDOW_SECS = 1.5;
const SEEK_REWIND_SNAP_SECS = 2.25;

function normalizeAnchoredPosition(
  positionSecs: number,
  playbackStatus: string | null | undefined,
  durationSecs: number | null | undefined,
) {
  const compensated =
    playbackStatus === "Playing"
      ? positionSecs + PLAYBACK_REPORT_LATENCY_SECS
      : positionSecs;

  if (durationSecs == null || Number.isNaN(durationSecs)) {
    return Math.max(0, compensated);
  }

  return Math.min(Math.max(0, compensated), Math.max(0, durationSecs));
}

export function usePlaybackClock(
  positionSecs: number | null | undefined,
  playbackStatus: string | null | undefined,
  durationSecs: number | null | undefined,
  trackKey?: string | null,
): number | null {
  const [livePosition, setLivePosition] = useState<number | null>(
    positionSecs == null || Number.isNaN(positionSecs) ? null : Math.max(0, positionSecs),
  );
  const anchorRef = useRef<{
    position: number;
    atMs: number;
    status: string;
    duration: number | null;
    hasFreshPosition: boolean;
  } | null>(null);
  const trackRef = useRef<string>((trackKey ?? "").trim());

  useEffect(() => {
    const normalizedTrackKey = (trackKey ?? "").trim();
    if (trackRef.current === normalizedTrackKey) {
      return;
    }
    trackRef.current = normalizedTrackKey;
    anchorRef.current = null;

    if (positionSecs == null || Number.isNaN(positionSecs)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
setLivePosition(null);
      return;
    }

    const newPos = normalizeAnchoredPosition(
      positionSecs,
      playbackStatus,
      durationSecs,
    );
    anchorRef.current = {
      position: newPos,
      atMs: Date.now(),
      status: playbackStatus ?? "",
      duration: durationSecs ?? null,
      hasFreshPosition: true,
    };
    setLivePosition(newPos);
  }, [durationSecs, playbackStatus, positionSecs, trackKey]);

  useEffect(() => {
    const now = Date.now();
    const status = playbackStatus ?? "";

    if (positionSecs == null || Number.isNaN(positionSecs)) {
      if (!anchorRef.current) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
setLivePosition(null);
        return;
      }
      anchorRef.current.status = status;
      anchorRef.current.duration = durationSecs ?? anchorRef.current.duration;
      anchorRef.current.hasFreshPosition = false;
      setLivePosition(anchorRef.current.position);
      return;
    }

    const newPos = normalizeAnchoredPosition(
      positionSecs,
      status,
      durationSecs,
    );
    const previousAnchor = anchorRef.current;
    const previousPosition = previousAnchor?.position ?? null;
    const previousDuration = previousAnchor?.duration ?? durationSecs ?? null;
    const rewindDelta =
      previousPosition == null ? 0 : Math.max(0, previousPosition - newPos);
    const wasNearTrackEnd = Boolean(
      previousPosition != null
        && previousDuration != null
        && previousDuration > 0
        && previousPosition >= Math.max(previousDuration * 0.82, previousDuration - 1.2),
    );
    const hardResetToStart = Boolean(
      previousPosition != null
        && newPos <= TRACK_END_RESET_WINDOW_SECS
        && wasNearTrackEnd,
    );
    const snappedRewind = Boolean(
      previousPosition != null && rewindDelta >= SEEK_REWIND_SNAP_SECS,
    );

    if (hardResetToStart || snappedRewind) {
      anchorRef.current = {
        position: newPos,
        atMs: now,
        status,
        duration: durationSecs ?? null,
        hasFreshPosition: true,
      };
      setLivePosition(newPos);
      return;
    }

    if (
      anchorRef.current
      && anchorRef.current.hasFreshPosition
      && anchorRef.current.status === "Playing"
      && status === "Playing"
    ) {
      const elapsed = (now - anchorRef.current.atMs) / 1000;
      const extrapolated = anchorRef.current.position + elapsed;
      const rewindVsAnchor = Math.max(0, anchorRef.current.position - newPos);
      if (
        newPos < extrapolated
        && extrapolated - newPos < PLAYBACK_REWIND_IGNORE_WINDOW_SECS
        && rewindVsAnchor < PLAYBACK_REWIND_SNAP_SECS
      ) {
        anchorRef.current.status = status;
        anchorRef.current.duration = durationSecs ?? anchorRef.current.duration;
        return;
      }
    }

    anchorRef.current = {
      position: newPos,
      atMs: now,
      status,
      duration: durationSecs ?? null,
      hasFreshPosition: true,
    };
    setLivePosition(newPos);
  }, [durationSecs, playbackStatus, positionSecs, trackKey]);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    if (playbackStatus !== "Playing" || !anchor.hasFreshPosition) {
      setLivePosition(anchor.position);
      return;
    }

    let rafId = 0;

    const tick = () => {
      const latest = anchorRef.current;
      if (!latest || !latest.hasFreshPosition) return;

      const elapsed = (Date.now() - latest.atMs) / 1000;
      let next = latest.position + Math.max(0, elapsed);
      if (latest.duration != null) {
        next = Math.min(next, latest.duration);
      }
      setLivePosition(next);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(rafId);
  }, [playbackStatus]);

  return livePosition;
}
