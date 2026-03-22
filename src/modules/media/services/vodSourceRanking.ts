import { invoke } from "@tauri-apps/api/core";

import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

export interface VodSiteRankingRecord {
  siteKey: string;
  successCount: number;
  lastSuccessAt: number;
}

function normalizeRepoUrl(repoUrl?: string): string {
  return repoUrl?.trim() ?? "";
}

export async function listVodSiteRankings(
  source: string,
  repoUrl?: string,
): Promise<VodSiteRankingRecord[]> {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    return [];
  }

  const records = await invoke<Array<{
    site_key: string;
    success_count: number;
    last_success_at: number;
  }>>("list_vod_site_rankings", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    limit: 16,
  });

  return records.map((record) => ({
    siteKey: record.site_key,
    successCount: Number(record.success_count ?? 0),
    lastSuccessAt: Number(record.last_success_at ?? 0),
  }));
}

export async function recordVodSiteSuccess(
  source: string,
  repoUrl: string | undefined,
  siteKey: string,
): Promise<void> {
  const normalizedSource = source.trim();
  const normalizedSiteKey = siteKey.trim();
  if (!normalizedSource || !normalizedSiteKey) {
    return;
  }

  await invoke("record_vod_site_success", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
  });
}

export function mergeVodSiteRankingSuccess(
  records: VodSiteRankingRecord[],
  siteKey: string,
): VodSiteRankingRecord[] {
  const normalizedSiteKey = siteKey.trim();
  if (!normalizedSiteKey) {
    return records;
  }

  const now = Date.now();
  const next = records.slice();
  const index = next.findIndex((record) => record.siteKey === normalizedSiteKey);
  if (index >= 0) {
    next[index] = {
      ...next[index],
      successCount: next[index].successCount + 1,
      lastSuccessAt: now,
    };
  } else {
    next.push({
      siteKey: normalizedSiteKey,
      successCount: 1,
      lastSuccessAt: now,
    });
  }
  return next.sort((left, right) => {
    if (right.successCount !== left.successCount) {
      return right.successCount - left.successCount;
    }
    if (right.lastSuccessAt !== left.lastSuccessAt) {
      return right.lastSuccessAt - left.lastSuccessAt;
    }
    return left.siteKey.localeCompare(right.siteKey);
  });
}

export function sortVodSitesByRanking(
  sites: NormalizedTvBoxSite[],
  records: VodSiteRankingRecord[],
  activeSiteKey = "",
): NormalizedTvBoxSite[] {
  if (sites.length <= 1) {
    return sites;
  }

  const rankingMap = new Map(records.map((record) => [record.siteKey, record]));
  return [...sites].sort((left, right) => {
    if (left.key === activeSiteKey && right.key !== activeSiteKey) {
      return -1;
    }
    if (right.key === activeSiteKey && left.key !== activeSiteKey) {
      return 1;
    }

    const leftRank = rankingMap.get(left.key);
    const rightRank = rankingMap.get(right.key);
    const leftScore = leftRank?.successCount ?? 0;
    const rightScore = rightRank?.successCount ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const leftTime = leftRank?.lastSuccessAt ?? 0;
    const rightTime = rightRank?.lastSuccessAt ?? 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.key.localeCompare(right.key);
  });
}
