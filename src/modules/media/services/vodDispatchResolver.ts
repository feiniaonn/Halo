import { invoke } from "@tauri-apps/api/core";

import {
  classifyVodDispatchFailure,
  isVodDispatchBackendQuarantined,
  isVodOriginMetadataSite,
  listVodDispatchBackendStats,
  recordVodDispatchBackendFailure,
  recordVodDispatchBackendSuccess,
  sortVodDispatchBackendSites,
} from "@/modules/media/services/vodDispatchHealth";
import { pickBestVodDispatchCandidate } from "@/modules/media/services/vodDispatchSearch";
import {
  runWithConcurrencyLimit,
  withVodInterfaceTimeout,
} from "@/modules/media/services/vodBrowseRuntime";
import {
  loadPersistedVodDispatchCache,
  savePersistedVodDispatchCache,
} from "@/modules/media/services/vodPersistentCache";
import { listVodSiteRankings } from "@/modules/media/services/vodSourceRanking";
import {
  parseVodResponse,
  resolveSiteSpiderUrl,
} from "@/modules/media/services/tvboxConfig";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import type {
  NormalizedTvBoxConfig,
  NormalizedTvBoxSite,
  SpiderExecutionReport,
} from "@/modules/media/types/tvbox.types";
import type {
  VodDispatchBackendStatus,
  VodDispatchResolution,
} from "@/modules/media/types/vodDispatch.types";

const DEFAULT_DISPATCH_SITE_LIMIT = 12;
const METADATA_DISPATCH_SITE_LIMIT = 6;
const METADATA_PRIORITY_SITE_LIMIT = 4;
const METADATA_DISPATCH_BATCH_SIZE = 3;
const METADATA_DISPATCH_MAX_MATCHES = 2;

interface ResolveVodDispatchMatchesArgs {
  keyword: string;
  fallbackTitle?: string;
  maxMatches?: number;
  config: NormalizedTvBoxConfig;
  activeSiteKey: string;
  originSiteKey?: string;
  sourceKey: string;
  repoUrl: string;
  runtimeSessionKey: string;
  policyGeneration: number;
  concurrency: number;
  isStale: () => boolean;
  resolveSiteExt: (site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">) => Promise<string>;
  getSpiderRuntimeWarmupPromise: (
    spiderUrl: string,
    apiClass: string,
  ) => Promise<unknown> | null;
  syncSpiderExecutionState: (siteKey: string) => Promise<SpiderExecutionReport | null>;
}

function updateBackendStatus(
  statuses: VodDispatchBackendStatus[],
  nextStatus: VodDispatchBackendStatus,
): VodDispatchBackendStatus[] {
  const next = statuses.filter((status) => status.targetSiteKey !== nextStatus.targetSiteKey);
  next.push(nextStatus);
  return next.sort((left, right) => left.order - right.order);
}

function buildCacheHitStatuses(
  resolution: VodDispatchResolution,
): VodDispatchBackendStatus[] {
  if (resolution.backendStatuses.length > 0) {
    return resolution.backendStatuses;
  }
  return resolution.matches.map((match, order) => ({
    targetSiteKey: match.siteKey,
    targetSiteName: match.siteName,
    order,
    state: "cache-hit",
    updatedAt: Date.now(),
  }));
}

function isMetadataDispatchAuxiliarySite(site: NormalizedTvBoxSite): boolean {
  return /(?:^|_)(market|push)$/i.test(site.api)
    || /(?:\u5e94\u7528|\u5546\u5e97|\u624b\u673a|\u63a8\u9001)/.test(site.name);
}

function isMetadataDispatchPreviewSite(site: NormalizedTvBoxSite): boolean {
  return /(?:^|_)ygp$/i.test(site.api) || /\u9884\u544a/.test(site.name);
}

function isPreferredMetadataSearchSite(site: NormalizedTvBoxSite): boolean {
  const normalizedApi = site.api.trim();
  const hasNamedSearchApi = !/^https?:\/\//i.test(normalizedApi)
    && /(?:^|[_./-])(m?search)(?:$|[_./-])/i.test(normalizedApi);

  return (
    !isMetadataDispatchPreviewSite(site)
    && !isMetadataDispatchAuxiliarySite(site)
    && (
      site.capability.searchOnly
      || site.capability.dispatchRole === "search-only-backend"
      || /(search|\u641c\u7d22|\u641c\u7247|\u641c\u5267|\u68c0\u7d22|\u805a\u641c)/i.test(site.name)
      || hasNamedSearchApi
    )
  );
}

function isFastMetadataDispatchSite(site: NormalizedTvBoxSite): boolean {
  if (isPreferredMetadataSearchSite(site)) {
    return false;
  }

  if (isMetadataDispatchPreviewSite(site) || isMetadataDispatchAuxiliarySite(site)) {
    return false;
  }

  if (site.capability.dispatchRole !== "resource-backend" || !site.capability.supportsPlay) {
    return false;
  }

  if (/\.py$/i.test(site.api)) {
    return false;
  }

  if (site.capability.hasRemoteExt || site.extKind === "url") {
    return false;
  }

  return true;
}

function buildMetadataDispatchSites(sortedSites: NormalizedTvBoxSite[]): NormalizedTvBoxSite[] {
  const preferredSites: NormalizedTvBoxSite[] = [];
  const fastSites: NormalizedTvBoxSite[] = [];
  const fallbackSites: NormalizedTvBoxSite[] = [];
  const previewSites: NormalizedTvBoxSite[] = [];
  const auxiliarySites: NormalizedTvBoxSite[] = [];

  for (const site of sortedSites) {
    if (isPreferredMetadataSearchSite(site)) {
      preferredSites.push(site);
      continue;
    }
    if (isMetadataDispatchPreviewSite(site)) {
      previewSites.push(site);
      continue;
    }
    if (isMetadataDispatchAuxiliarySite(site)) {
      auxiliarySites.push(site);
      continue;
    }
    if (isFastMetadataDispatchSite(site)) {
      fastSites.push(site);
      continue;
    }
    fallbackSites.push(site);
  }

  const limitedPreferredSites = preferredSites.slice(0, METADATA_PRIORITY_SITE_LIMIT);
  const preferredKeys = new Set(limitedPreferredSites.map((site) => site.key));
  const remainingSites = [
    ...fastSites,
    ...fallbackSites,
    ...previewSites,
    ...auxiliarySites,
  ]
    .filter((site) => !preferredKeys.has(site.key))
    .slice(0, METADATA_DISPATCH_SITE_LIMIT);

  return [...limitedPreferredSites, ...remainingSites]
    .slice(0, METADATA_DISPATCH_SITE_LIMIT + METADATA_PRIORITY_SITE_LIMIT);
}

export async function resolveVodDispatchMatches({
  keyword,
  fallbackTitle = "",
  maxMatches = 4,
  config,
  activeSiteKey,
  originSiteKey = "",
  sourceKey,
  repoUrl,
  runtimeSessionKey,
  policyGeneration,
  concurrency,
  isStale,
  resolveSiteExt,
  getSpiderRuntimeWarmupPromise,
  syncSpiderExecutionState,
}: ResolveVodDispatchMatchesArgs): Promise<VodDispatchResolution> {
  const normalizedKeyword = keyword.trim() || fallbackTitle.trim();
  const resolvedOriginSiteKey = originSiteKey.trim() || activeSiteKey.trim();
  if (!normalizedKeyword || !resolvedOriginSiteKey) {
    return {
      originSiteKey: resolvedOriginSiteKey,
      keyword: normalizedKeyword,
      cacheHit: false,
      matches: [],
      backendStatuses: [],
    };
  }

  const cappedMaxMatches = Math.max(1, Math.min(maxMatches, 12));
  const originSite = config.sites.find((site) => site.key === resolvedOriginSiteKey) ?? null;
  const shouldDeferDetailResolution = isVodOriginMetadataSite(originSite);
  const effectiveMaxMatches = shouldDeferDetailResolution
    ? Math.min(cappedMaxMatches, METADATA_DISPATCH_MAX_MATCHES)
    : cappedMaxMatches;
  const persistedResolution = await loadPersistedVodDispatchCache(
    sourceKey,
    repoUrl,
    resolvedOriginSiteKey,
    normalizedKeyword,
  ).catch(() => null);
  if (persistedResolution?.matches.length) {
    const nextResolution: VodDispatchResolution = {
      ...persistedResolution,
      originSiteKey: resolvedOriginSiteKey,
      keyword: normalizedKeyword,
      cacheHit: true,
      backendStatuses: buildCacheHitStatuses(persistedResolution),
      matches: persistedResolution.matches.slice(0, effectiveMaxMatches),
    };
    return nextResolution;
  }

  const [rankingRecords, backendStats] = await Promise.all([
    listVodSiteRankings(sourceKey, repoUrl).catch(() => []),
    listVodDispatchBackendStats(sourceKey, repoUrl, resolvedOriginSiteKey).catch(() => []),
  ]);

  const backendStatMap = new Map(backendStats.map((record) => [record.targetSiteKey, record]));
  const sortedSites = sortVodDispatchBackendSites(
    config.sites,
    rankingRecords,
    backendStats,
    resolvedOriginSiteKey,
    activeSiteKey,
  );
  const orderedSites = shouldDeferDetailResolution
    ? buildMetadataDispatchSites(sortedSites)
    : sortedSites.slice(0, DEFAULT_DISPATCH_SITE_LIMIT);

  const initialStatuses: VodDispatchBackendStatus[] = orderedSites.map((site, order) => {
    const previous = backendStatMap.get(site.key);
    return {
      targetSiteKey: site.key,
      targetSiteName: site.name,
      order,
      state: isVodDispatchBackendQuarantined(previous) ? "skipped-quarantined" : "attempting",
      message: isVodDispatchBackendQuarantined(previous) ? "Recently quarantined due to repeated hard failures." : undefined,
      quarantinedUntil: previous?.quarantineUntil,
      updatedAt: Date.now(),
    };
  });

  if (!orderedSites.length) {
    return {
      originSiteKey: resolvedOriginSiteKey,
      keyword: normalizedKeyword,
      cacheHit: false,
      matches: [],
      backendStatuses: [],
    };
  }

  let backendStatuses = initialStatuses;
  const matches: Array<{ order: number; value: VodDispatchResolution["matches"][number] }> = [];

  const executeSearchBatch = async (
    batchSites: NormalizedTvBoxSite[],
    batchOffset: number,
  ) => runWithConcurrencyLimit(
    batchSites,
    Math.min(concurrency, batchSites.length),
    async (site, batchIndex) => {
      const order = batchOffset + batchIndex;
      if (isStale() || matches.length >= effectiveMaxMatches) {
        return;
      }

      const previousBackendStat = backendStatMap.get(site.key);
      if (isVodDispatchBackendQuarantined(previousBackendStat)) {
        backendStatuses = updateBackendStatus(backendStatuses, {
          targetSiteKey: site.key,
          targetSiteName: site.name,
          order,
          state: "skipped-quarantined",
          message: "Skipped because this backend is in the quarantine window.",
          quarantinedUntil: previousBackendStat?.quarantineUntil,
          updatedAt: Date.now(),
        });
        return;
      }

      backendStatuses = updateBackendStatus(backendStatuses, {
        targetSiteKey: site.key,
        targetSiteName: site.name,
        order,
        state: "attempting",
        updatedAt: Date.now(),
      });

      const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
      if (site.capability.requiresSpider && !spiderUrl) {
        return;
      }

      try {
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExt(site), `dispatch_ext:${site.key}`)
          : site.extValue;
        if (isStale()) {
          return;
        }

        const runtimeWarmup = site.capability.requiresSpider && spiderUrl
          ? getSpiderRuntimeWarmupPromise(spiderUrl, site.api)
          : null;
        if (runtimeWarmup) {
          await runtimeWarmup;
          if (isStale()) {
            return;
          }
        }

        const searchResponse = site.capability.requiresSpider
          ? await invoke<string>("spider_search", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
            keyword: normalizedKeyword,
            quick: site.quickSearch,
          })
          : await withVodInterfaceTimeout(invoke<string>("fetch_vod_search", {
            apiUrl: site.api,
            keyword: normalizedKeyword,
          }), `dispatch_search:${site.key}`);
        if (isStale()) {
          return;
        }

        const candidateList = parseVodResponse(searchResponse).list ?? [];
        const bestCandidate = pickBestVodDispatchCandidate(normalizedKeyword, candidateList);
        if (!bestCandidate?.vod_id) {
          backendStatuses = updateBackendStatus(backendStatuses, {
            targetSiteKey: site.key,
            targetSiteName: site.name,
            order,
            state: "no-match",
            message: "No relevant title match was found on this backend.",
            updatedAt: Date.now(),
          });
          return;
        }

        if (shouldDeferDetailResolution) {
          matches.push({
            order,
            value: {
              siteKey: site.key,
              siteName: site.name,
              sourceKind: site.capability.sourceKind,
              vodId: bestCandidate.vod_id,
              matchTitle: bestCandidate.vod_name,
              remarks: bestCandidate.vod_remarks,
              originSiteKey: resolvedOriginSiteKey,
              requiresDetailResolve: true,
            },
          });
          backendStatuses = updateBackendStatus(backendStatuses, {
            targetSiteKey: site.key,
            targetSiteName: site.name,
            order,
            state: "success",
            message: "Matched a likely playable title. Detail will resolve only when selected.",
            updatedAt: Date.now(),
          });
          return;
        }

        const detailResult = await fetchVodDetail(
          {
            site,
            spider: config.spider,
            sourceKey,
            repoUrl,
            runtimeSessionKey,
            policyGeneration,
          },
          bestCandidate.vod_id,
        );
        if (isStale()) {
          return;
        }
        if (!detailResult.routes.length) {
          backendStatuses = updateBackendStatus(backendStatuses, {
            targetSiteKey: site.key,
            targetSiteName: site.name,
            order,
            state: "no-routes",
            message: "Matched detail loaded, but the backend returned no playable routes.",
            updatedAt: Date.now(),
          });
          return;
        }

        matches.push({
          order,
          value: {
            siteKey: site.key,
            siteName: site.name,
            sourceKind: site.capability.sourceKind,
            vodId: bestCandidate.vod_id,
            matchTitle: bestCandidate.vod_name,
            remarks: bestCandidate.vod_remarks,
            detail: detailResult.detail,
            routes: detailResult.routes,
            extInput: detailResult.extInput,
          },
        });
        backendStatuses = updateBackendStatus(backendStatuses, {
          targetSiteKey: site.key,
          targetSiteName: site.name,
          order,
          state: "success",
          message: `Matched ${detailResult.routes.length} playable route(s).`,
          updatedAt: Date.now(),
        });
        backendStatMap.set(site.key, {
          ...(previousBackendStat ?? {
            targetSiteKey: site.key,
            successCount: 0,
            failureCount: 0,
            lastStatus: "",
            lastFailureKind: null,
            lastUsedAt: 0,
            consecutiveHardFailures: 0,
            consecutiveUpstreamFailures: 0,
            quarantineUntil: 0,
          }),
          targetSiteKey: site.key,
          successCount: (previousBackendStat?.successCount ?? 0) + 1,
          lastStatus: "success",
          lastFailureKind: null,
          lastUsedAt: Date.now(),
          consecutiveHardFailures: 0,
          consecutiveUpstreamFailures: 0,
          quarantineUntil: 0,
        });
        void recordVodDispatchBackendSuccess(sourceKey, repoUrl, resolvedOriginSiteKey, site.key).catch(() => {
          // Ignore persistence failures and keep the fresh result.
        });
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        const report = site.capability.requiresSpider
          ? await syncSpiderExecutionState(site.key)
          : null;
        if (isStale()) {
          return;
        }
        const failureKind = classifyVodDispatchFailure(message, report);
        const nextStat = await recordVodDispatchBackendFailure(
          sourceKey,
          repoUrl,
          resolvedOriginSiteKey,
          site.key,
          failureKind,
          previousBackendStat,
        ).catch(() => null);
        if (nextStat) {
          backendStatMap.set(site.key, nextStat);
        }
        backendStatuses = updateBackendStatus(backendStatuses, {
          targetSiteKey: site.key,
          targetSiteName: site.name,
          order,
          state: "failed",
          failureKind,
          message,
          quarantinedUntil: nextStat?.quarantineUntil,
          updatedAt: Date.now(),
        });
      }
    },
  );

  if (shouldDeferDetailResolution) {
    for (let batchOffset = 0; batchOffset < orderedSites.length; batchOffset += METADATA_DISPATCH_BATCH_SIZE) {
      if (isStale() || matches.length >= effectiveMaxMatches) {
        break;
      }
      const batchSites = orderedSites.slice(batchOffset, batchOffset + METADATA_DISPATCH_BATCH_SIZE);
      await executeSearchBatch(batchSites, batchOffset);
      if (matches.length > 0) {
        break;
      }
    }
  } else {
    await executeSearchBatch(orderedSites, 0);
  }

  if (isStale()) {
    return {
      originSiteKey: resolvedOriginSiteKey,
      keyword: normalizedKeyword,
      cacheHit: false,
      matches: [],
      backendStatuses: [],
    };
  }

  const resolvedMatches = matches
    .sort((left, right) => left.order - right.order)
    .slice(0, effectiveMaxMatches)
    .map((item) => item.value);

  const resolution: VodDispatchResolution = {
    originSiteKey: resolvedOriginSiteKey,
    keyword: normalizedKeyword,
    cacheHit: false,
    matches: resolvedMatches,
    backendStatuses,
  };

  if (resolvedMatches.length > 0) {
    void savePersistedVodDispatchCache(
      sourceKey,
      repoUrl,
      resolvedOriginSiteKey,
      normalizedKeyword,
      resolution,
    ).catch(() => {
      // Ignore persistence failures and keep the fresh dispatch result.
    });
  }

  return resolution;
}
