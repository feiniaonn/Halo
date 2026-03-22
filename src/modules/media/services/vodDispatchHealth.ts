import { invoke } from "@tauri-apps/api/core";

import type { VodSiteRankingRecord } from "@/modules/media/services/vodSourceRanking";
import type { NormalizedTvBoxSite, SpiderExecutionReport } from "@/modules/media/types/tvbox.types";
import type {
  VodDispatchBackendStat,
  VodDispatchFailureKind,
  VodDispatchHealthState,
} from "@/modules/media/types/vodDispatch.types";

export const GLOBAL_VOD_DISPATCH_ORIGIN_SITE_KEY = "__aggregate__";
export const VOD_DISPATCH_BACKEND_QUARANTINE_WINDOW_MS = 30 * 60 * 1000;
const VOD_HARD_FAILURE_QUARANTINE_THRESHOLD = 2;
const VOD_UPSTREAM_QUARANTINE_THRESHOLD = 3;

function normalizeRepoUrl(repoUrl?: string): string {
  return repoUrl?.trim() ?? "";
}

function normalizeOriginSiteKey(originSiteKey: string): string {
  const normalized = originSiteKey.trim();
  return normalized || GLOBAL_VOD_DISPATCH_ORIGIN_SITE_KEY;
}

function normalizeTargetSiteKey(targetSiteKey: string): string {
  return targetSiteKey.trim();
}

export function isVodOriginMetadataSite(site: Pick<NormalizedTvBoxSite, "capability"> | null | undefined): boolean {
  return site?.capability.dispatchRole === "origin-metadata";
}

export function isVodDispatchBackendSite(site: Pick<NormalizedTvBoxSite, "capability">): boolean {
  return site.capability.canSearch && site.capability.dispatchRole !== "origin-metadata";
}

export function getVodDispatchHealthState(
  stat: VodDispatchBackendStat | null | undefined,
  now = Date.now(),
): VodDispatchHealthState {
  if (!stat) {
    return "healthy";
  }
  if ((stat.quarantineUntil ?? 0) > now) {
    return "quarantined";
  }
  if ((stat.consecutiveHardFailures ?? 0) > 0 || (stat.consecutiveUpstreamFailures ?? 0) > 0) {
    return "cooldown";
  }
  return "healthy";
}

export function isVodDispatchBackendQuarantined(
  stat: VodDispatchBackendStat | null | undefined,
  now = Date.now(),
): boolean {
  return getVodDispatchHealthState(stat, now) === "quarantined";
}

export function classifyVodDispatchFailure(
  message: string,
  report?: SpiderExecutionReport | null,
): VodDispatchFailureKind {
  const normalizedMessage = message.trim().toLowerCase();
  const failureKind = report?.failureKind ?? null;
  const failureCode = report?.failureCode ?? null;

  if (
    failureKind === "Timeout"
    || failureCode === "TransportTimeout"
    || /timeout|timed out|超时|interruptedioexception: interrupted/.test(normalizedMessage)
  ) {
    return "timeout";
  }

  if (
    failureKind === "ResponseShapeError"
    || failureCode === "PayloadSchemaInvalid"
    || failureCode === "UpstreamMalformedPayload"
    || /jsonexception|syntaxerror|json parse failed|payload|response shape|schema/i.test(normalizedMessage)
  ) {
    return "payload";
  }

  if (
    failureKind === "InitError"
    || failureKind === "SiteRuntimeError"
    || failureKind === "ClassSelectionError"
    || failureKind === "NativeMethodBlocked"
    || failureKind === "MissingDependency"
    || failureKind === "NeedsCompatPack"
    || failureKind === "NeedsContextShim"
    || failureKind === "NeedsLocalHelper"
    || failureCode === "ClassSelectionMiss"
    || failureCode === "RuntimeInitFailed"
    || failureCode === "RuntimeMethodFailed"
    || failureCode === "DependencyMissing"
    || /nullpointerexception|\bnpe\b|invoke method failed|runtimeexception|no such method|class not found/.test(normalizedMessage)
  ) {
    return "runtime";
  }

  if (
    failureKind === "FetchError"
    || failureCode === "TransportTlsFailed"
    || failureCode === "TransportProxyFailed"
    || failureCode === "UpstreamForbidden"
    || /error sending request|connection|forbidden|http\s+[45]\d{2}|ssl|proxy|upstream|ioexception/.test(normalizedMessage)
  ) {
    return "upstream";
  }

  return "runtime";
}

export function computeVodDispatchFailureUpdate(
  previous: VodDispatchBackendStat | null | undefined,
  failureKind: VodDispatchFailureKind,
  now = Date.now(),
): {
  nextStat: VodDispatchBackendStat;
  hardFailure: boolean;
  upstreamFailure: boolean;
  quarantineUntil: number;
} {
  const normalizedPrevious = previous ?? null;
  const hardFailure = failureKind === "payload" || failureKind === "runtime";
  const upstreamFailure = failureKind === "upstream";
  const consecutiveHardFailures = hardFailure
    ? (normalizedPrevious?.consecutiveHardFailures ?? 0) + 1
    : 0;
  const consecutiveUpstreamFailures = upstreamFailure
    ? (normalizedPrevious?.consecutiveUpstreamFailures ?? 0) + 1
    : 0;
  const quarantineUntil = (
    (hardFailure && consecutiveHardFailures >= VOD_HARD_FAILURE_QUARANTINE_THRESHOLD)
    || (upstreamFailure && consecutiveUpstreamFailures >= VOD_UPSTREAM_QUARANTINE_THRESHOLD)
  )
    ? now + VOD_DISPATCH_BACKEND_QUARANTINE_WINDOW_MS
    : Math.max(normalizedPrevious?.quarantineUntil ?? 0, 0);

  return {
    nextStat: {
      targetSiteKey: normalizedPrevious?.targetSiteKey ?? "",
      successCount: normalizedPrevious?.successCount ?? 0,
      failureCount: (normalizedPrevious?.failureCount ?? 0) + 1,
      lastStatus: `failed:${failureKind}`,
      lastFailureKind: failureKind,
      lastUsedAt: now,
      consecutiveHardFailures,
      consecutiveUpstreamFailures,
      quarantineUntil,
    },
    hardFailure,
    upstreamFailure,
    quarantineUntil,
  };
}

export function mergeVodDispatchBackendSuccess(
  records: VodDispatchBackendStat[],
  targetSiteKey: string,
  now = Date.now(),
): VodDispatchBackendStat[] {
  const normalizedTargetSiteKey = normalizeTargetSiteKey(targetSiteKey);
  if (!normalizedTargetSiteKey) {
    return records;
  }

  const next = records.slice();
  const index = next.findIndex((record) => record.targetSiteKey === normalizedTargetSiteKey);
  if (index >= 0) {
    next[index] = {
      ...next[index],
      successCount: next[index].successCount + 1,
      lastStatus: "success",
      lastFailureKind: null,
      lastUsedAt: now,
      consecutiveHardFailures: 0,
      consecutiveUpstreamFailures: 0,
      quarantineUntil: 0,
    };
  } else {
    next.push({
      targetSiteKey: normalizedTargetSiteKey,
      successCount: 1,
      failureCount: 0,
      lastStatus: "success",
      lastFailureKind: null,
      lastUsedAt: now,
      consecutiveHardFailures: 0,
      consecutiveUpstreamFailures: 0,
      quarantineUntil: 0,
    });
  }
  return next;
}

export function mergeVodDispatchBackendFailure(
  records: VodDispatchBackendStat[],
  targetSiteKey: string,
  failureKind: VodDispatchFailureKind,
  now = Date.now(),
): VodDispatchBackendStat[] {
  const normalizedTargetSiteKey = normalizeTargetSiteKey(targetSiteKey);
  if (!normalizedTargetSiteKey) {
    return records;
  }

  const next = records.slice();
  const index = next.findIndex((record) => record.targetSiteKey === normalizedTargetSiteKey);
  const previous = index >= 0 ? next[index] : null;
  const { nextStat } = computeVodDispatchFailureUpdate(
    previous
      ? {
        ...previous,
        targetSiteKey: normalizedTargetSiteKey,
      }
      : {
        targetSiteKey: normalizedTargetSiteKey,
        successCount: 0,
        failureCount: 0,
        lastStatus: "",
        lastFailureKind: null,
        lastUsedAt: 0,
        consecutiveHardFailures: 0,
        consecutiveUpstreamFailures: 0,
        quarantineUntil: 0,
      },
    failureKind,
    now,
  );

  if (index >= 0) {
    next[index] = nextStat;
  } else {
    next.push(nextStat);
  }
  return next;
}

export async function listVodDispatchBackendStats(
  source: string,
  repoUrl: string | undefined,
  originSiteKey: string,
): Promise<VodDispatchBackendStat[]> {
  const normalizedSource = source.trim();
  const normalizedOriginSiteKey = normalizeOriginSiteKey(originSiteKey);
  if (!normalizedSource || !normalizedOriginSiteKey) {
    return [];
  }

  const records = await invoke<Array<{
    target_site_key: string;
    success_count: number;
    failure_count: number;
    last_status: string;
    last_failure_kind?: VodDispatchFailureKind | null;
    last_used_at: number;
    consecutive_hard_failures: number;
    consecutive_upstream_failures: number;
    quarantine_until: number;
  }>>("load_vod_dispatch_backend_stats", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    originSiteKey: normalizedOriginSiteKey,
    limit: 32,
  });

  return records.map((record) => ({
    targetSiteKey: record.target_site_key,
    successCount: Number(record.success_count ?? 0),
    failureCount: Number(record.failure_count ?? 0),
    lastStatus: record.last_status ?? "",
    lastFailureKind: record.last_failure_kind ?? null,
    lastUsedAt: Number(record.last_used_at ?? 0),
    consecutiveHardFailures: Number(record.consecutive_hard_failures ?? 0),
    consecutiveUpstreamFailures: Number(record.consecutive_upstream_failures ?? 0),
    quarantineUntil: Number(record.quarantine_until ?? 0),
  }));
}

export async function recordVodDispatchBackendSuccess(
  source: string,
  repoUrl: string | undefined,
  originSiteKey: string,
  targetSiteKey: string,
): Promise<void> {
  const normalizedSource = source.trim();
  const normalizedOriginSiteKey = normalizeOriginSiteKey(originSiteKey);
  const normalizedTargetSiteKey = normalizeTargetSiteKey(targetSiteKey);
  if (!normalizedSource || !normalizedOriginSiteKey || !normalizedTargetSiteKey) {
    return;
  }

  await invoke("record_vod_dispatch_backend_success", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    originSiteKey: normalizedOriginSiteKey,
    targetSiteKey: normalizedTargetSiteKey,
  });
}

export async function recordVodDispatchBackendFailure(
  source: string,
  repoUrl: string | undefined,
  originSiteKey: string,
  targetSiteKey: string,
  failureKind: VodDispatchFailureKind,
  previous: VodDispatchBackendStat | null | undefined,
  now = Date.now(),
): Promise<VodDispatchBackendStat> {
  const normalizedSource = source.trim();
  const normalizedOriginSiteKey = normalizeOriginSiteKey(originSiteKey);
  const normalizedTargetSiteKey = normalizeTargetSiteKey(targetSiteKey);
  const { nextStat, hardFailure, upstreamFailure, quarantineUntil } = computeVodDispatchFailureUpdate(previous, failureKind, now);
  if (!normalizedSource || !normalizedOriginSiteKey || !normalizedTargetSiteKey) {
    return {
      ...nextStat,
      targetSiteKey: normalizedTargetSiteKey,
    };
  }

  await invoke("record_vod_dispatch_backend_failure", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    originSiteKey: normalizedOriginSiteKey,
    targetSiteKey: normalizedTargetSiteKey,
    lastStatus: `failed:${failureKind}`,
    failureKind,
    hardFailure,
    upstreamFailure,
    quarantineUntilMs: quarantineUntil,
  });

  return {
    ...nextStat,
    targetSiteKey: normalizedTargetSiteKey,
  };
}

export function sortVodDispatchBackendSites(
  sites: NormalizedTvBoxSite[],
  rankingRecords: VodSiteRankingRecord[],
  backendStats: VodDispatchBackendStat[],
  originSiteKey: string,
  activeSiteKey = "",
  now = Date.now(),
): NormalizedTvBoxSite[] {
  const rankingMap = new Map(rankingRecords.map((record) => [record.siteKey, record]));
  const backendStatMap = new Map(backendStats.map((record) => [record.targetSiteKey, record]));
  const originSite = sites.find((site) => site.key === originSiteKey) ?? null;

  return sites
    .filter((site) => {
      if (!isVodDispatchBackendSite(site)) {
        return false;
      }
      if (site.key !== originSiteKey) {
        return true;
      }
      return !isVodOriginMetadataSite(originSite);
    })
    .sort((left, right) => {
      if (left.key === activeSiteKey && right.key !== activeSiteKey) {
        return -1;
      }
      if (right.key === activeSiteKey && left.key !== activeSiteKey) {
        return 1;
      }

      const leftHealth = getVodDispatchHealthState(backendStatMap.get(left.key), now);
      const rightHealth = getVodDispatchHealthState(backendStatMap.get(right.key), now);
      const healthWeight = {
        healthy: 0,
        cooldown: 1,
        quarantined: 2,
      } as const;
      if (healthWeight[leftHealth] !== healthWeight[rightHealth]) {
        return healthWeight[leftHealth] - healthWeight[rightHealth];
      }

      const leftBackend = backendStatMap.get(left.key);
      const rightBackend = backendStatMap.get(right.key);
      const leftSuccess = leftBackend?.successCount ?? 0;
      const rightSuccess = rightBackend?.successCount ?? 0;
      if (rightSuccess !== leftSuccess) {
        return rightSuccess - leftSuccess;
      }

      const leftLastUsedAt = leftBackend?.lastUsedAt ?? 0;
      const rightLastUsedAt = rightBackend?.lastUsedAt ?? 0;
      if (rightLastUsedAt !== leftLastUsedAt) {
        return rightLastUsedAt - leftLastUsedAt;
      }

      const leftRank = rankingMap.get(left.key);
      const rightRank = rankingMap.get(right.key);
      const leftRankScore = leftRank?.successCount ?? 0;
      const rightRankScore = rightRank?.successCount ?? 0;
      if (rightRankScore !== leftRankScore) {
        return rightRankScore - leftRankScore;
      }

      const roleWeight = {
        "resource-backend": 0,
        "search-only-backend": 1,
        "origin-metadata": 2,
      } as const;
      if (roleWeight[left.capability.dispatchRole] !== roleWeight[right.capability.dispatchRole]) {
        return roleWeight[left.capability.dispatchRole] - roleWeight[right.capability.dispatchRole];
      }

      return left.key.localeCompare(right.key);
    });
}

export function filterAggregateAutoSearchSites(
  sites: NormalizedTvBoxSite[],
  backendStats: VodDispatchBackendStat[],
  now = Date.now(),
): NormalizedTvBoxSite[] {
  const backendStatMap = new Map(backendStats.map((record) => [record.targetSiteKey, record]));
  return sites.filter((site) => isVodDispatchBackendSite(site) && !isVodDispatchBackendQuarantined(backendStatMap.get(site.key), now));
}

export function planVodWarmupSites(args: {
  sites: NormalizedTvBoxSite[];
  activeSiteKey: string;
  activeOriginBackendStats: VodDispatchBackendStat[];
  aggregateBackendStats: VodDispatchBackendStat[];
  maxSites: number;
}): NormalizedTvBoxSite[] {
  const { sites, activeSiteKey, activeOriginBackendStats, aggregateBackendStats, maxSites } = args;
  const activeSite = sites.find((site) => site.key === activeSiteKey) ?? null;
  if (!activeSite) {
    return [];
  }

  const originCandidates = sortVodDispatchBackendSites(
    sites,
    [],
    activeOriginBackendStats,
    activeSiteKey,
    activeSiteKey,
  );
  const globalCandidates = filterAggregateAutoSearchSites(sites, aggregateBackendStats);
  const next = new Map<string, NormalizedTvBoxSite>();

  next.set(activeSite.key, activeSite);
  const followups = isVodOriginMetadataSite(activeSite)
    ? originCandidates.slice(0, 2)
    : globalCandidates.slice(0, Math.max(maxSites - 1, 0));

  for (const site of followups) {
    if (next.size >= maxSites) {
      break;
    }
    if (site.capability.requiresSpider) {
      next.set(site.key, site);
    }
  }

  return Array.from(next.values()).filter((site) => site.capability.requiresSpider).slice(0, maxSites);
}
