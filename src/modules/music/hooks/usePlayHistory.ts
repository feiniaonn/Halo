import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getPlayHistory, getTop10 } from "../services/musicService";
import type { PlayRecord } from "../types/music.types";

type FetchRecords = () => Promise<PlayRecord[]>;

function useMusicRecords(fetcher: FetchRecords) {
  const [data, setData] = useState<PlayRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      const result = await fetcher();
      setData(result);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen("music:play-recorded", () => {
      void fetch();
    }).then((fn) => {
      unlistenFn = fn;
    }).catch(() => void 0);

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function usePlayHistory(limit = 100) {
  const fetcher = useCallback(() => getPlayHistory(limit), [limit]);
  return useMusicRecords(fetcher);
}

export function useTop10() {
  const fetcher = useCallback(() => getTop10(), []);
  return useMusicRecords(fetcher);
}

