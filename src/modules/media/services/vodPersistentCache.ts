import { invoke } from "@tauri-apps/api/core";

import type {
  VodAggregateResultItem,
  VodAggregateSessionState,
} from "@/modules/media/types/tvbox.types";
import type {
  VodDispatchBackendStatus,
  VodDispatchCandidate,
  VodDispatchResolution,
} from "@/modules/media/types/vodDispatch.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";
import type { VodResolvedStreamSnapshot } from "@/modules/media/services/vodPlaybackResolutionCache";

export const VOD_PERSISTED_AGGREGATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const VOD_PERSISTED_DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const VOD_PERSISTED_DISPATCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const VOD_PERSISTED_PLAYBACK_RESOLUTION_CACHE_TTL_MS = 5 * 60 * 1000;

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

export interface PersistedVodDispatchCache {
  matches: VodDispatchCandidate[];
  backendStatuses?: VodDispatchBackendStatus[];
}

export interface PersistedVodPlaybackResolutionCache {
  stream: VodResolvedStreamSnapshot;
}

export function buildVodPersistentKeywordKey(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function buildVodPersistentSiteSetKey(siteKeys: string[]): string {
  return siteKeys.map((siteKey) => siteKey.trim()).filter(Boolean).join(",");
}

function normalizeVodPersistentOriginSiteKey(siteKey: string): string {
  return siteKey.trim();
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

export async function loadPersistedVodDispatchCache(
  source: string,
  repoUrl: string,
  originSiteKey: string,
  keyword: string,
): Promise<VodDispatchResolution | null> {
  const normalizedSource = source.trim();
  const normalizedOriginSiteKey = normalizeVodPersistentOriginSiteKey(originSiteKey);
  const keywordKey = buildVodPersistentKeywordKey(keyword);
  if (!normalizedSource || !normalizedOriginSiteKey || !keywordKey) {
    return null;
  }

  const record = await invoke<VodCachedPayloadRecord | null>("load_vod_dispatch_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    originSiteKey: normalizedOriginSiteKey,
    keyword: keywordKey,
  });

  if (!record?.payload_json?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.payload_json) as PersistedVodDispatchCache;
    if (!Array.isArray(parsed?.matches)) {
      return null;
    }
    return {
      originSiteKey: normalizedOriginSiteKey,
      keyword: keywordKey,
      cacheHit: true,
      matches: parsed.matches,
      backendStatuses: Array.isArray(parsed.backendStatuses) ? parsed.backendStatuses : [],
    };
  } catch {
    return null;
  }
}

export async function savePersistedVodDispatchCache(
  source: string,
  repoUrl: string,
  originSiteKey: string,
  keyword: string,
  payload: Pick<VodDispatchResolution, "matches" | "backendStatuses">,
): Promise<void> {
  const normalizedSource = source.trim();
  const normalizedOriginSiteKey = normalizeVodPersistentOriginSiteKey(originSiteKey);
  const keywordKey = buildVodPersistentKeywordKey(keyword);
  if (!normalizedSource || !normalizedOriginSiteKey || !keywordKey || payload.matches.length === 0) {
    return;
  }

  await invoke("save_vod_dispatch_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    originSiteKey: normalizedOriginSiteKey,
    keyword: keywordKey,
    payloadJson: JSON.stringify({
      matches: payload.matches,
      backendStatuses: payload.backendStatuses,
    }),
    ttlMs: VOD_PERSISTED_DISPATCH_CACHE_TTL_MS,
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

export async function loadPersistedVodPlaybackResolutionCache(
  source: string,
  repoUrl: string,
  cacheKey: string,
): Promise<PersistedVodPlaybackResolutionCache | null> {
  const normalizedSource = source.trim();
  const normalizedCacheKey = cacheKey.trim();
  if (!normalizedSource || !normalizedCacheKey) {
    return null;
  }

  const record = await invoke<VodCachedPayloadRecord | null>("load_vod_playback_resolution_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    cacheKey: normalizedCacheKey,
  });

  if (!record?.payload_json?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(record.payload_json) as PersistedVodPlaybackResolutionCache;
    if (!parsed?.stream?.url || !parsed.stream.resolvedBy) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function savePersistedVodPlaybackResolutionCache(
  source: string,
  repoUrl: string,
  cacheKey: string,
  payload: PersistedVodPlaybackResolutionCache,
): Promise<void> {
  const normalizedSource = source.trim();
  const normalizedCacheKey = cacheKey.trim();
  if (!normalizedSource || !normalizedCacheKey || !payload.stream?.url) {
    return;
  }

  await invoke("save_vod_playback_resolution_cache", {
    source: normalizedSource,
    repoUrl: repoUrl.trim() || null,
    cacheKey: normalizedCacheKey,
    payloadJson: JSON.stringify(payload),
    ttlMs: VOD_PERSISTED_PLAYBACK_RESOLUTION_CACHE_TTL_MS,
  });
}
