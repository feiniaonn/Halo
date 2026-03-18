import { invoke } from "@tauri-apps/api/core";

import type {
  VodAggregateResultItem,
  VodAggregateSessionState,
} from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

export const VOD_PERSISTED_AGGREGATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const VOD_PERSISTED_DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface VodCachedPayloadRecord {
  payload_json: string;
  updated_at: number;
  expires_at: number;
}

export interface PersistedAggregateSearchCache {
  items: VodAggregateResultItem[];
  statuses: VodAggregateSessionState["statuses"];
}

export interface PersistedVodDetailCache {
  detail: VodDetail;
  routes: VodRoute[];
  extInput: string;
}

export function buildVodPersistentKeywordKey(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function buildVodPersistentSiteSetKey(siteKeys: string[]): string {
  return siteKeys.map((siteKey) => siteKey.trim()).filter(Boolean).join(",");
}

export async function loadPersistedAggregateSearchCache(
  source: string,
  repoUrl: string,
  keyword: string,
  siteKeys: string[],
): Promise<PersistedAggregateSearchCache | null> {
  const normalizedSource = source.trim();
  const keywordKey = buildVodPersistentKeywordKey(keyword);
  const siteSetKey = buildVodPersistentSiteSetKey(siteKeys);
  if (!normalizedSource || !keywordKey || !siteSetKey) {
    return null;
  }

  const record = await invoke<VodCachedPayloadRecord | null>("load_vod_aggregate_search_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    keyword: keywordKey,
    siteSetKey,
  });

  if (!record?.payload_json?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.payload_json) as PersistedAggregateSearchCache;
    if (!Array.isArray(parsed?.items) || !Array.isArray(parsed?.statuses)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersistedAggregateSearchCache(
  source: string,
  repoUrl: string,
  keyword: string,
  siteKeys: string[],
  payload: PersistedAggregateSearchCache,
): Promise<void> {
  const normalizedSource = source.trim();
  const keywordKey = buildVodPersistentKeywordKey(keyword);
  const siteSetKey = buildVodPersistentSiteSetKey(siteKeys);
  if (!normalizedSource || !keywordKey || !siteSetKey) {
    return;
  }

  await invoke("save_vod_aggregate_search_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    keyword: keywordKey,
    siteSetKey,
    payloadJson: JSON.stringify(payload),
    ttlMs: VOD_PERSISTED_AGGREGATE_CACHE_TTL_MS,
  });
}

export async function loadPersistedVodDetailCache(
  source: string,
  repoUrl: string,
  siteKey: string,
  vodId: string,
): Promise<PersistedVodDetailCache | null> {
  const normalizedSource = source.trim();
  const normalizedSiteKey = siteKey.trim();
  const normalizedVodId = vodId.trim();
  if (!normalizedSource || !normalizedSiteKey || !normalizedVodId) {
    return null;
  }

  const record = await invoke<VodCachedPayloadRecord | null>("load_vod_detail_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    siteKey: normalizedSiteKey,
    vodId: normalizedVodId,
  });

  if (!record?.payload_json?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.payload_json) as PersistedVodDetailCache;
    if (!parsed?.detail?.vod_id || !Array.isArray(parsed?.routes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersistedVodDetailCache(
  source: string,
  repoUrl: string,
  siteKey: string,
  vodId: string,
  payload: PersistedVodDetailCache,
): Promise<void> {
  const normalizedSource = source.trim();
  const normalizedSiteKey = siteKey.trim();
  const normalizedVodId = vodId.trim();
  if (!normalizedSource || !normalizedSiteKey || !normalizedVodId) {
    return;
  }

  await invoke("save_vod_detail_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    siteKey: normalizedSiteKey,
    vodId: normalizedVodId,
    payloadJson: JSON.stringify(payload),
    ttlMs: VOD_PERSISTED_DETAIL_CACHE_TTL_MS,
  });
}
