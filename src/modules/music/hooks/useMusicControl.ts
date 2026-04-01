import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  EVENT_MUSIC_SETTINGS_CHANGED,
  EVENT_MUSIC_TRACK_UPDATE,
} from "@/modules/shared/services/events";
import {
  getMusicControlSources,
  getMusicControlState,
  musicControl,
} from "../services/musicService";
import type {
  MusicCommand,
  MusicControlOptions,
  MusicControlResult,
  MusicControlSource,
  MusicControlState,
} from "../types/music.types";

const CONTROL_REFRESH_TIMEOUT_MS = 1800;
const CONTROL_POLL_MS = 2200;
const CONTROL_FAST_POLL_MS = 700;
const CONTROL_FAST_POLL_WINDOW_MS = 2500;
const CONTROL_TARGET_SWITCH_GUARD_MS = 250;
const CONTROL_SOURCES_REFRESH_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
}

export function useMusicControl() {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [state, setState] = useState<MusicControlState | null>(null);
  const [sources, setSources] = useState<MusicControlSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningCommand, setRunningCommand] = useState<MusicCommand | null>(null);
  const lastTargetSwitchAt = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const fastRefreshUntilRef = useRef(0);
  const lastSourcesRefreshAtRef = useRef(0);

  const requestFastRefresh = useCallback((windowMs = CONTROL_FAST_POLL_WINDOW_MS) => {
    fastRefreshUntilRef.current = Math.max(
      fastRefreshUntilRef.current,
      Date.now() + windowMs,
    );
  }, []);

  const refresh = useCallback(async (options?: { includeSources?: boolean }) => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }

    const shouldRefreshSources =
      Boolean(options?.includeSources) ||
      sources.length === 0 ||
      Date.now() - lastSourcesRefreshAtRef.current >= CONTROL_SOURCES_REFRESH_MS;

    const refreshTask = (async () => {
      try {
        const [nextState, nextSources] = await Promise.all([
          withTimeout(getMusicControlState(), CONTROL_REFRESH_TIMEOUT_MS),
          shouldRefreshSources
            ? withTimeout(getMusicControlSources(), CONTROL_REFRESH_TIMEOUT_MS)
            : Promise.resolve(null),
        ]);

        if (nextState) {
          setState((prev) => {
            if (!prev?.target || !nextState.target) {
              return nextState;
            }
            if (prev.target.source_id === nextState.target.source_id) {
              return nextState;
            }

            const now = Date.now();
            if (now - lastTargetSwitchAt.current < CONTROL_TARGET_SWITCH_GUARD_MS) {
              return {
                ...nextState,
                target: prev.target,
              };
            }

            lastTargetSwitchAt.current = now;
            return nextState;
          });
        }

        if (nextSources) {
          lastSourcesRefreshAtRef.current = Date.now();
          setSources(nextSources);
        }
      } finally {
        setLoading(false);
      }
    })();

    refreshInFlightRef.current = refreshTask;
    try {
      await refreshTask;
    } finally {
      if (refreshInFlightRef.current === refreshTask) {
        refreshInFlightRef.current = null;
      }
    }
  }, [isTauri, sources.length]);

  useEffect(() => {
    requestFastRefresh();
    void refresh({ includeSources: true });
  }, [refresh, requestFastRefresh]);

  useEffect(() => {
    if (!isTauri) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, CONTROL_POLL_MS);
    const fastTimer = window.setInterval(() => {
      if (Date.now() > fastRefreshUntilRef.current) return;
      void refresh();
    }, CONTROL_FAST_POLL_MS);

    const onVisibleOrFocus = () => {
      requestFastRefresh();
      void refresh({ includeSources: true });
    };
    const offSettings = listen(EVENT_MUSIC_SETTINGS_CHANGED, () => {
      requestFastRefresh();
      void refresh({ includeSources: true });
    });
    const offTrack = listen(EVENT_MUSIC_TRACK_UPDATE, () => {
      requestFastRefresh();
      void refresh({ includeSources: true });
    });

    window.addEventListener("focus", onVisibleOrFocus);
    window.addEventListener("pageshow", onVisibleOrFocus);
    document.addEventListener("visibilitychange", onVisibleOrFocus);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(fastTimer);
      window.removeEventListener("focus", onVisibleOrFocus);
      window.removeEventListener("pageshow", onVisibleOrFocus);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      void offSettings.then((fn) => fn()).catch(() => void 0);
      void offTrack.then((fn) => fn()).catch(() => void 0);
    };
  }, [isTauri, refresh, requestFastRefresh]);

  const runCommand = useCallback(
    async (
      command: MusicCommand,
      options?: MusicControlOptions,
    ): Promise<MusicControlResult> => {
      if (!isTauri) {
        return {
          ok: false,
          message: "当前环境不支持媒体控制",
          command,
          target: null,
          reason: "当前环境不支持媒体控制",
          retried: 0,
        };
      }

      setRunningCommand(command);
      requestFastRefresh();
      try {
        const result = await musicControl(command, options);
        await refresh({ includeSources: true });
        return result;
      } finally {
        setRunningCommand(null);
      }
    },
    [isTauri, refresh, requestFastRefresh],
  );

  return {
    state,
    sources,
    loading,
    runningCommand,
    refresh,
    runCommand,
  };
}
