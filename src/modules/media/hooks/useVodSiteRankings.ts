import { useCallback, useEffect, useState } from "react";

import {
  listVodSiteRankings,
  mergeVodSiteRankingSuccess,
  recordVodSiteSuccess,
  type VodSiteRankingRecord,
} from "@/modules/media/services/vodSourceRanking";

interface UseVodSiteRankingsResult {
  siteRankings: VodSiteRankingRecord[];
  recordSiteSuccess: (siteKey: string) => void;
}

export function useVodSiteRankings(
  source: string,
  activeRepoUrl: string,
): UseVodSiteRankingsResult {
  const [siteRankings, setSiteRankings] = useState<VodSiteRankingRecord[]>([]);

  useEffect(() => {
    const sourceKey = source.trim();
    if (!sourceKey) {
      setSiteRankings([]);
      return;
    }

    let cancelled = false;
    void listVodSiteRankings(sourceKey, activeRepoUrl)
      .then((records) => {
        if (!cancelled) {
          setSiteRankings(records);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSiteRankings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepoUrl, source]);

  const recordSiteSuccess = useCallback((siteKey: string) => {
    const normalizedSource = source.trim();
    const normalizedSiteKey = siteKey.trim();
    if (!normalizedSource || !normalizedSiteKey) {
      return;
    }

    setSiteRankings((current) => mergeVodSiteRankingSuccess(current, normalizedSiteKey));
    void recordVodSiteSuccess(normalizedSource, activeRepoUrl, normalizedSiteKey).catch(() => {
      // Ignore persistence failures and keep optimistic ranking in memory.
    });
  }, [activeRepoUrl, source]);

  return {
    siteRankings,
    recordSiteSuccess,
  };
}
