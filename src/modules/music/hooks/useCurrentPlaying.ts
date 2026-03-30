 
 
import { useCallback, useEffect, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import {
  EVENT_MUSIC_TIMELINE_UPDATE,
  EVENT_MUSIC_TRACK_UPDATE,
} from "@/modules/shared/services/events";
import { listen } from "@tauri-apps/api/event";
import { getCurrentPlaying } from "../services/musicService";
import type {
  CurrentPlayingInfo,
  MusicTimelineUpdatePayload,
  MusicTrackUpdatePayload,
} from "../types/music.types";

type Snapshot = {
  data: CurrentPlayingInfo | null;
  loading: boolean;
};

const POLL_MS = 2500;
const FAST_POLL_MS = 600;
const HIDDEN_POLL_MS = 8000;
const FAST_POLL_WINDOW_MS = 5000;
const STARTUP_FAST_POLL_WINDOW_MS = 6000;

let sharedSnapshot: Snapshot = {
  data: null,
  loading: true,
};

let teardownShared: (() => void) | null = null;
let inFlight: Promise<void> | null = null;
let fastPollUntil = 0;
const subscribers = new Set<(snapshot: Snapshot) => void>();

function hasTrack(current: CurrentPlayingInfo | null) {
  if (!current) return false;
  return current.artist.trim().length > 0 || current.title.trim().length > 0;
}

function normalizeCurrentPlaying(current: CurrentPlayingInfo | null): CurrentPlayingInfo | null {
  if (!current) return null;
  const anchorMs = current.timeline_updated_at_ms ?? current.position_sampled_at_ms ?? null;
  return {
    ...current,
    position_sampled_at_ms: anchorMs,
    timeline_updated_at_ms: current.timeline_updated_at_ms ?? anchorMs,
  };
}

function createEmptyCurrent(): CurrentPlayingInfo {
  return {
    artist: "",
    title: "",
    cover_path: null,
    cover_data_url: null,
    duration_secs: null,
    position_secs: null,
    position_sampled_at_ms: null,
    timeline_updated_at_ms: null,
    playback_status: null,
    source_app_id: null,
    source_platform: null,
  };
}

function requestFastPoll(windowMs = FAST_POLL_WINDOW_MS) {
  fastPollUntil = Math.max(fastPollUntil, Date.now() + windowMs);
}

function isSameCurrentPlaying(a: CurrentPlayingInfo | null, b: CurrentPlayingInfo | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.artist === b.artist &&
    a.title === b.title &&
    a.cover_path === b.cover_path &&
    a.cover_data_url === b.cover_data_url &&
    a.duration_secs === b.duration_secs &&
    a.position_secs === b.position_secs &&
    a.position_sampled_at_ms === b.position_sampled_at_ms &&
    a.timeline_updated_at_ms === b.timeline_updated_at_ms &&
    a.playback_status === b.playback_status &&
    a.source_app_id === b.source_app_id &&
    a.source_platform === b.source_platform
  );
}

function applyTrackUpdate(update: MusicTrackUpdatePayload) {
  const next = update
    ? normalizeCurrentPlaying({
        ...(sharedSnapshot.data ?? createEmptyCurrent()),
        artist: update.artist,
        title: update.title,
        cover_path: update.cover_path,
        cover_data_url: update.cover_data_url,
        source_app_id: update.source_app_id,
        source_platform: update.source_platform,
      })
    : null;

  if (!isSameCurrentPlaying(sharedSnapshot.data, next)) {
    sharedSnapshot = {
      ...sharedSnapshot,
      data: next,
      loading: false,
    };
    emitShared();
  }
}

function applyTimelineUpdate(update: MusicTimelineUpdatePayload) {
  const next = update
    ? normalizeCurrentPlaying({
        ...(sharedSnapshot.data ?? createEmptyCurrent()),
        duration_secs: update.duration_secs,
        position_secs: update.position_secs,
        position_sampled_at_ms: update.last_updated_at_ms,
        timeline_updated_at_ms: update.last_updated_at_ms,
        playback_status: update.playback_status,
        source_app_id: update.source_app_id,
        source_platform: update.source_platform,
      })
    : null;

  if (!isSameCurrentPlaying(sharedSnapshot.data, next)) {
    sharedSnapshot = {
      ...sharedSnapshot,
      data: next,
      loading: false,
    };
    emitShared();
  }
}

function emitShared() {
  for (const listener of subscribers) {
    listener(sharedSnapshot);
  }
}

async function fetchShared() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const previous = sharedSnapshot.data;
      const next = normalizeCurrentPlaying(await getCurrentPlaying());
      const changed = !isSameCurrentPlaying(previous, next);
      if (!isSameCurrentPlaying(sharedSnapshot.data, next)) {
        sharedSnapshot = {
          ...sharedSnapshot,
          data: next,
        };
      }
      if (changed || !hasTrack(next)) {
        requestFastPoll(hasTrack(next) ? FAST_POLL_WINDOW_MS : STARTUP_FAST_POLL_WINDOW_MS);
      }
    } catch {
      // Keep last known state to avoid UI flicker.
      requestFastPoll();
    } finally {
      if (sharedSnapshot.loading) {
        sharedSnapshot = {
          ...sharedSnapshot,
          loading: false,
        };
      }
      emitShared();
      inFlight = null;
    }
  })();
  return inFlight;
}

function ensureSharedRunner(isTauri: boolean) {
  if (!isTauri) return;
  if (teardownShared) return;
  let active = true;
  requestFastPoll(STARTUP_FAST_POLL_WINDOW_MS);
  void fetchShared();

  const hasWindow = typeof window !== "undefined";
  const hasDocument = typeof document !== "undefined";
  let lastHiddenPollAt = 0;

  const interval = hasWindow
    ? window.setInterval(() => {
        if (!active) return;
        if (hasDocument && typeof document.hidden !== "undefined" && document.hidden) {
          const now = Date.now();
          if (now - lastHiddenPollAt < HIDDEN_POLL_MS) return;
          lastHiddenPollAt = now;
        }
        void fetchShared();
      }, POLL_MS)
    : undefined;
  const fastInterval = hasWindow
    ? window.setInterval(() => {
        if (!active || Date.now() > fastPollUntil) return;
        if (hasDocument && typeof document.hidden !== "undefined" && document.hidden) {
          return;
        }
        void fetchShared();
      }, FAST_POLL_MS)
    : undefined;

  const offTrackPromise = listen<MusicTrackUpdatePayload>(EVENT_MUSIC_TRACK_UPDATE, (event) => {
    if (!active) return;
    requestFastPoll();
    applyTrackUpdate(event.payload);
  });
  const offTimelinePromise = listen<MusicTimelineUpdatePayload>(EVENT_MUSIC_TIMELINE_UPDATE, (event) => {
    if (!active) return;
    applyTimelineUpdate(event.payload);
  });
  const onVisibleOrFocus = () => {
    if (!active) return;
    requestFastPoll();
    void fetchShared();
  };
  if (hasDocument) {
    document.addEventListener("visibilitychange", onVisibleOrFocus);
  }
  if (hasWindow) {
    window.addEventListener("focus", onVisibleOrFocus);
    window.addEventListener("pageshow", onVisibleOrFocus);
  }

  teardownShared = () => {
    active = false;
    if (interval !== undefined && hasWindow) {
      window.clearInterval(interval);
    }
    if (fastInterval !== undefined && hasWindow) {
      window.clearInterval(fastInterval);
    }
    if (hasDocument) {
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
    }
    if (hasWindow) {
      window.removeEventListener("focus", onVisibleOrFocus);
      window.removeEventListener("pageshow", onVisibleOrFocus);
    }
    void offTrackPromise.then((fn) => fn()).catch(() => void 0);
    void offTimelinePromise.then((fn) => fn()).catch(() => void 0);
    teardownShared = null;
  };
}

function subscribe(listener: (snapshot: Snapshot) => void, isTauri: boolean) {
  subscribers.add(listener);
  listener(sharedSnapshot);
  ensureSharedRunner(isTauri);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && teardownShared) {
      teardownShared();
    }
  };
}

export function useCurrentPlaying() {
  const isTauri = isTauriRuntime();
  const [snapshot, setSnapshot] = useState<Snapshot>(sharedSnapshot);

  useEffect(() => {
    if (!isTauri) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshot((prev) => (prev.loading ? { ...prev, loading: false } : prev));
      return;
    }
    return subscribe(setSnapshot, isTauri);
  }, [isTauri]);

  const refetch = useCallback(async () => {
    await fetchShared();
  }, []);

  return {
    data: snapshot.data,
    loading: snapshot.loading,
    refetch,
  };
}
