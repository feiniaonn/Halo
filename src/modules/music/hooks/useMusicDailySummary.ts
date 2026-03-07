import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getMusicDailySummary } from "../services/musicService";
import type { MusicDailySummary } from "../types/music.types";

export function useMusicDailySummary() {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [data, setData] = useState<MusicDailySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    try {
      const next = await getMusicDailySummary();
      setData(next);
    } catch {
      // Keep stale snapshot on transient backend errors.
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
    }, 5000);

    const offPlayRecorded = listen("music:play-recorded", () => {
      void refresh();
    });

    return () => {
      window.clearInterval(timer);
      void offPlayRecorded.then((fn) => fn()).catch(() => void 0);
    };
  }, [isTauri, refresh]);

  return {
    data,
    loading,
    refresh,
  };
}
