 
 
 import { useEffect, useRef, useState } from "react";

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

    const newPos = Math.max(0, positionSecs);
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

    const newPos = Math.max(0, positionSecs);
    if (
      anchorRef.current
      && anchorRef.current.hasFreshPosition
      && anchorRef.current.status === "Playing"
      && status === "Playing"
    ) {
      const elapsed = (now - anchorRef.current.atMs) / 1000;
      const extrapolated = anchorRef.current.position + elapsed;
      if (newPos < extrapolated && extrapolated - newPos < 1.5) {
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

    const timer = window.setInterval(() => {
      const latest = anchorRef.current;
      if (!latest || !latest.hasFreshPosition) return;

      const elapsed = (Date.now() - latest.atMs) / 1000;
      let next = latest.position + Math.max(0, elapsed);
      if (latest.duration != null) {
        next = Math.min(next, latest.duration);
      }
      setLivePosition(next);
    }, 120);

    return () => window.clearInterval(timer);
  }, [playbackStatus]);

  return livePosition;
}
