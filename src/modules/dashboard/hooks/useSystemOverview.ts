import { useEffect, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENT_SYSTEM_OVERVIEW_UPDATED } from "@/modules/shared/services/events";
import { getDashboardSystemOverview } from "../services/dashboardService";
import type { DashboardSystemOverview } from "../types/dashboard.types";

interface UseSystemOverviewResult {
  systemOverview: DashboardSystemOverview | null;
  systemLoading: boolean;
  systemError: string | null;
  lastUpdated: number | null;
}

export function useSystemOverview(): UseSystemOverviewResult {
  const isTauri = isTauriRuntime();
  const [systemOverview, setSystemOverview] = useState<DashboardSystemOverview | null>(null);
  const [systemLoading, setSystemLoading] = useState(true);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauri) {
      setSystemLoading(false);
      setSystemError("系统概览仅在桌面端可用");
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const applyOverview = (overview: DashboardSystemOverview) => {
      if (cancelled) return;
      setSystemOverview(overview);
      setSystemError(null);
      setSystemLoading(false);
      setLastUpdated(Date.now());
    };

    const bootstrap = async () => {
      try {
        const initial = await getDashboardSystemOverview();
        applyOverview(initial);
      } catch (e) {
        if (cancelled) return;
        setSystemError(`读取失败：${String(e)}`);
        setSystemLoading(false);
      }

      try {
        unlisten = await listen<DashboardSystemOverview>(EVENT_SYSTEM_OVERVIEW_UPDATED, (event) => {
          applyOverview(event.payload);
        });
      } catch (e) {
        if (cancelled) return;
        setSystemError((prev) => prev ?? `事件订阅失败：${String(e)}`);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isTauri]);

  return { systemOverview, systemLoading, systemError, lastUpdated };
}
