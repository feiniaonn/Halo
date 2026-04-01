import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getMusicAiRecommendation } from "@/modules/ai/services/aiService";
import type { MusicAiRecommendation } from "@/modules/ai/types/ai.types";

type UseMusicAiRecommendationOptions = {
  enabled?: boolean;
  autoRefreshOnPlayRecorded?: boolean;
  autoRefreshAtMidnight?: boolean;
};

function todayDateKey() {
  return new Date().toLocaleDateString("en-CA");
}

function msUntilNextMidnight() {
  const next = new Date();
  next.setHours(24, 0, 0, 0);
  return Math.max(1_000, next.getTime() - Date.now());
}

export function useMusicAiRecommendation(
  options: UseMusicAiRecommendationOptions = {},
) {
  const {
    enabled = true,
    autoRefreshOnPlayRecorded = true,
    autoRefreshAtMidnight = true,
  } = options;
  const [data, setData] = useState<MusicAiRecommendation | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const midnightTimerRef = useRef<number | null>(null);

  const load = useCallback(
    async (forceRefresh = false, showRefreshing = forceRefresh) => {
      if (!enabled) {
        setLoading(false);
        return null;
      }

      if (showRefreshing) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const minPendingMs = showRefreshing ? 650 : 0;
      const startedAt = performance.now();

      try {
        const next = await getMusicAiRecommendation(forceRefresh);
        setData(next);
        return next;
      } finally {
        const remaining = minPendingMs - (performance.now() - startedAt);
        if (remaining > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, remaining);
          });
        }
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    void load(false, false);
  }, [load]);

  useEffect(() => {
    if (!enabled || !autoRefreshOnPlayRecorded) return;

    let unlisten: (() => void) | undefined;
    listen("music:play-recorded", () => {
      const shouldAutoRefresh =
        !data ||
        data.source === "no-data" ||
        data.source === "error" ||
        data.date_key !== todayDateKey();
      if (!shouldAutoRefresh) {
        return;
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void load(false, false);
      }, 1200);
    })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => void 0);

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      unlisten?.();
    };
  }, [autoRefreshOnPlayRecorded, data, enabled, load]);

  useEffect(() => {
    if (!enabled || !autoRefreshAtMidnight) return;

    const schedule = () => {
      midnightTimerRef.current = window.setTimeout(() => {
        midnightTimerRef.current = null;
        void load(false, false).finally(schedule);
      }, msUntilNextMidnight());
    };

    schedule();
    return () => {
      if (midnightTimerRef.current !== null) {
        window.clearTimeout(midnightTimerRef.current);
        midnightTimerRef.current = null;
      }
    };
  }, [autoRefreshAtMidnight, enabled, load]);

  return {
    data,
    loading,
    refreshing,
    refresh: (forceRefresh = true) => load(forceRefresh, true),
  };
}
