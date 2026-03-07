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

export function useMusicControl() {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [state, setState] = useState<MusicControlState | null>(null);
  const [sources, setSources] = useState<MusicControlSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningCommand, setRunningCommand] = useState<MusicCommand | null>(null);
  const lastTargetSwitchAt = useRef(0);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    try {
      const [nextState, nextSources] = await Promise.all([
        getMusicControlState(),
        getMusicControlSources(),
      ]);
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
      setSources(nextSources);
    } finally {
      setLoading(false);
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
