import { useCallback, useEffect, useState } from "react";

import {
  listVodDispatchBackendStats,
  mergeVodDispatchBackendFailure,
  mergeVodDispatchBackendSuccess,
  recordVodDispatchBackendFailure,
  recordVodDispatchBackendSuccess,
} from "@/modules/media/services/vodDispatchHealth";
import type { VodDispatchBackendStat, VodDispatchFailureKind } from "@/modules/media/types/vodDispatch.types";

interface UseVodDispatchBackendStatsResult {
  backendStats: VodDispatchBackendStat[];
  recordBackendSuccess: (targetSiteKey: string) => void;
  recordBackendFailure: (targetSiteKey: string, failureKind: VodDispatchFailureKind) => void;
}

export function useVodDispatchBackendStats(
  source: string,
  repoUrl: string,
  originSiteKey: string,
): UseVodDispatchBackendStatsResult {
  const [backendStats, setBackendStats] = useState<VodDispatchBackendStat[]>([]);

  useEffect(() => {
    const normalizedSource = source.trim();
    const normalizedOriginSiteKey = originSiteKey.trim();
    if (!normalizedSource || !normalizedOriginSiteKey) {
      setBackendStats([]);
      return;
    }

    let cancelled = false;
    void listVodDispatchBackendStats(normalizedSource, repoUrl, normalizedOriginSiteKey)
      .then((records) => {
        if (!cancelled) {
          setBackendStats(records);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendStats([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [originSiteKey, repoUrl, source]);

  const recordBackendSuccess = useCallback((targetSiteKey: string) => {
    const normalizedSource = source.trim();
    const normalizedOriginSiteKey = originSiteKey.trim();
    const normalizedTargetSiteKey = targetSiteKey.trim();
    if (!normalizedSource || !normalizedOriginSiteKey || !normalizedTargetSiteKey) {
      return;
    }

    setBackendStats((current) => mergeVodDispatchBackendSuccess(current, normalizedTargetSiteKey));
    void recordVodDispatchBackendSuccess(normalizedSource, repoUrl, normalizedOriginSiteKey, normalizedTargetSiteKey).catch(() => {
      // Ignore persistence failures and keep the optimistic state.
    });
  }, [originSiteKey, repoUrl, source]);

  const recordBackendFailure = useCallback((targetSiteKey: string, failureKind: VodDispatchFailureKind) => {
    const normalizedSource = source.trim();
    const normalizedOriginSiteKey = originSiteKey.trim();
    const normalizedTargetSiteKey = targetSiteKey.trim();
    if (!normalizedSource || !normalizedOriginSiteKey || !normalizedTargetSiteKey) {
      return;
    }

    setBackendStats((current) => {
      const previous = current.find((record) => record.targetSiteKey === normalizedTargetSiteKey) ?? null;
      void recordVodDispatchBackendFailure(
        normalizedSource,
        repoUrl,
        normalizedOriginSiteKey,
        normalizedTargetSiteKey,
        failureKind,
        previous,
      ).catch(() => {
        // Ignore persistence failures and keep the optimistic state.
      });
      return mergeVodDispatchBackendFailure(current, normalizedTargetSiteKey, failureKind);
    });
  }, [originSiteKey, repoUrl, source]);

  return {
    backendStats,
    recordBackendSuccess,
    recordBackendFailure,
  };
}
