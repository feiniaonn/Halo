 
 
import { useCallback, useEffect, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { EVENT_MUSIC_CURRENT_CHANGED } from "@/modules/shared/services/events";
import { listen } from "@tauri-apps/api/event";
import { getCurrentPlaying } from "../services/musicService";
import type { CurrentPlayingInfo } from "../types/music.types";

type Snapshot = {
  data: CurrentPlayingInfo | null;
  loading: boolean;
};

const POLL_MS = 1500;
const HIDDEN_POLL_MS = 5000;

let sharedSnapshot: Snapshot = {
  data: null,
  loading: true,
};

let teardownShared: (() => void) | null = null;
let inFlight: Promise<void> | null = null;
const subscribers = new Set<(snapshot: Snapshot) => void>();

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
    a.playback_status === b.playback_status &&
    a.source_app_id === b.source_app_id &&
    a.source_platform === b.source_platform
  );
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
      const next = await getCurrentPlaying();
      if (!isSameCurrentPlaying(sharedSnapshot.data, next)) {
        sharedSnapshot = {
          ...sharedSnapshot,
          data: next,
        };
      }
    } catch {
      // Keep last known state to avoid UI flicker.
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

  const unlistenPromise = listen(EVENT_MUSIC_CURRENT_CHANGED, () => {
    if (!active) return;
    void fetchShared();
  });

  const onVisibleOrFocus = () => {
    if (!active) return;
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
    if (hasDocument) {
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
    }
    if (hasWindow) {
      window.removeEventListener("focus", onVisibleOrFocus);
      window.removeEventListener("pageshow", onVisibleOrFocus);
    }
    void unlistenPromise.then((fn) => fn()).catch(() => void 0);
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
