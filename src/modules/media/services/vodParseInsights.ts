import {
  listVodParseRankings,
  recordVodParseSuccess,
  type VodParseRankingRecord,
} from "@/modules/media/services/vodParseRanking";
import {
  listVodParseHealthRecords,
  mergeVodParseHealthFailure,
  mergeVodParseHealthSuccess,
  recordVodParseHealthFailure,
  recordVodParseHealthSuccess,
  type VodParseFailureKind,
  type VodParseHealthRecord,
} from "@/modules/media/services/vodParseHealth";

export interface VodParseInsightsContext {
  sourceKey?: string;
  repoUrl?: string;
  siteKey: string;
  apiClass: string;
}

const PARSE_INSIGHTS_CACHE_TTL_MS = 30 * 1000;

const parseRankingCache = new Map<string, { records: VodParseRankingRecord[]; expiresAt: number }>();
const parseHealthCache = new Map<string, { records: VodParseHealthRecord[]; expiresAt: number }>();

function buildParseInsightsCacheKey(context: VodParseInsightsContext, routeName: string): string {
  return JSON.stringify([
    context.sourceKey?.trim() ?? "",
    context.repoUrl?.trim() ?? "",
    context.siteKey,
    context.apiClass,
    routeName,
  ]);
}

export function clearVodParseRankingCache(): void {
  parseRankingCache.clear();
}

export function clearVodParseHealthCache(): void {
  parseHealthCache.clear();
}

export async function listCachedVodParseSignals(
  context: VodParseInsightsContext,
  routeName: string,
): Promise<{
  rankingRecords: VodParseRankingRecord[];
  healthRecords: VodParseHealthRecord[];
}> {
  const sourceKey = context.sourceKey?.trim() ?? "";
  const siteKey = context.siteKey.trim();
  if (!sourceKey || !siteKey) {
    return {
      rankingRecords: [],
      healthRecords: [],
    };
  }

  const cacheKey = buildParseInsightsCacheKey(context, routeName);
  const now = Date.now();
  const cachedRanking = parseRankingCache.get(cacheKey);
  const cachedHealth = parseHealthCache.get(cacheKey);
  if (cachedRanking && cachedRanking.expiresAt > now && cachedHealth && cachedHealth.expiresAt > now) {
    return {
      rankingRecords: cachedRanking.records,
      healthRecords: cachedHealth.records,
    };
  }

  const [rankingRecords, healthRecords] = await Promise.all([
    cachedRanking && cachedRanking.expiresAt > now
      ? Promise.resolve(cachedRanking.records)
      : listVodParseRankings(
        sourceKey,
        context.repoUrl,
        siteKey,
        context.apiClass,
        routeName,
      ).catch(() => []),
    cachedHealth && cachedHealth.expiresAt > now
      ? Promise.resolve(cachedHealth.records)
      : listVodParseHealthRecords(
        sourceKey,
        context.repoUrl,
        siteKey,
        context.apiClass,
        routeName,
      ).catch(() => []),
  ]);

  parseRankingCache.set(cacheKey, {
    records: rankingRecords,
    expiresAt: now + PARSE_INSIGHTS_CACHE_TTL_MS,
  });
  parseHealthCache.set(cacheKey, {
    records: healthRecords,
    expiresAt: now + PARSE_INSIGHTS_CACHE_TTL_MS,
  });

  return {
    rankingRecords,
    healthRecords,
  };
}

export async function noteVodParseSuccess(
  context: VodParseInsightsContext,
  routeName: string,
  parseUrl: string,
  durationMs?: number,
): Promise<void> {
  const sourceKey = context.sourceKey?.trim() ?? "";
  const siteKey = context.siteKey.trim();
  const normalizedParseUrl = parseUrl.trim();
  if (!sourceKey || !siteKey || !normalizedParseUrl) {
    return;
  }

  const cacheKey = buildParseInsightsCacheKey(context, routeName);
  const now = Date.now();
  const currentRankings = parseRankingCache.get(cacheKey)?.records ?? [];
  const nextRankings = currentRankings.slice();
  const rankingIndex = nextRankings.findIndex((record) => record.parseUrl === normalizedParseUrl);
  if (rankingIndex >= 0) {
    nextRankings[rankingIndex] = {
      ...nextRankings[rankingIndex],
      successCount: nextRankings[rankingIndex].successCount + 1,
      lastSuccessAt: now,
    };
  } else {
    nextRankings.push({
      parseUrl: normalizedParseUrl,
      successCount: 1,
      lastSuccessAt: now,
    });
  }
  nextRankings.sort((left, right) => {
    if (right.successCount !== left.successCount) {
      return right.successCount - left.successCount;
    }
    if (right.lastSuccessAt !== left.lastSuccessAt) {
      return right.lastSuccessAt - left.lastSuccessAt;
    }
    return left.parseUrl.localeCompare(right.parseUrl);
  });
  parseRankingCache.set(cacheKey, {
    records: nextRankings,
    expiresAt: now + PARSE_INSIGHTS_CACHE_TTL_MS,
  });

  const nextHealth = mergeVodParseHealthSuccess(
    parseHealthCache.get(cacheKey)?.records ?? [],
    normalizedParseUrl,
    durationMs,
    now,
  );
  parseHealthCache.set(cacheKey, {
    records: nextHealth,
    expiresAt: now + PARSE_INSIGHTS_CACHE_TTL_MS,
  });

  await Promise.allSettled([
    recordVodParseSuccess(
      sourceKey,
      context.repoUrl,
      siteKey,
      context.apiClass,
      routeName,
      normalizedParseUrl,
    ),
    recordVodParseHealthSuccess(
      sourceKey,
      context.repoUrl,
      siteKey,
      context.apiClass,
      routeName,
      normalizedParseUrl,
      durationMs,
    ),
  ]);
}

export async function noteVodParseFailure(
  context: VodParseInsightsContext,
  routeName: string,
  parseUrl: string,
  failureKind: VodParseFailureKind,
  durationMs?: number,
): Promise<void> {
  const sourceKey = context.sourceKey?.trim() ?? "";
  const siteKey = context.siteKey.trim();
  const normalizedParseUrl = parseUrl.trim();
  if (!sourceKey || !siteKey || !normalizedParseUrl) {
    return;
  }

  const cacheKey = buildParseInsightsCacheKey(context, routeName);
  const now = Date.now();
  const previous = (parseHealthCache.get(cacheKey)?.records ?? []).find(
    (record) => record.parseUrl === normalizedParseUrl,
  );
  const nextHealth = mergeVodParseHealthFailure(
    parseHealthCache.get(cacheKey)?.records ?? [],
    normalizedParseUrl,
    failureKind,
    durationMs,
    now,
  );
  parseHealthCache.set(cacheKey, {
    records: nextHealth,
    expiresAt: now + PARSE_INSIGHTS_CACHE_TTL_MS,
  });

  await recordVodParseHealthFailure(
    sourceKey,
    context.repoUrl,
    siteKey,
    context.apiClass,
    routeName,
    normalizedParseUrl,
    failureKind,
    durationMs,
    previous,
    now,
  ).catch(() => void 0);
}
