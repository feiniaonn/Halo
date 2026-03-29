import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return;
    }

    const refreshTask = (async () => {
      try {
        const [nextState, nextSources] = await Promise.all([
          withTimeout(getMusicControlState(), CONTROL_REFRESH_TIMEOUT_MS),
          withTimeout(getMusicControlSources(), CONTROL_REFRESH_TIMEOUT_MS),
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
            if (now - lastTargetSwitchAt.current < 1000) {
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
  }, [isTauri]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);

    const offSettings = listen("music:settings-changed", () => {
      void refresh();
    });

    return () => {
      window.clearInterval(timer);
      void offSettings.then((fn) => fn()).catch(() => void 0);
    };
  }, [isTauri, refresh]);

  const runCommand = useCallback(async (
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
    try {
      const result = await musicControl(command, options);
      await refresh();
      return result;
    } finally {
      setRunningCommand(null);
    }
  }, [isTauri, refresh]);

  return {
    state,
    sources,
    loading,
    runningCommand,
    refresh,
    runCommand,
  };
}
