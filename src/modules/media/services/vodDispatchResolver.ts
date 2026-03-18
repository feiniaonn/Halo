import { invoke } from "@tauri-apps/api/core";

import { pickBestVodDispatchCandidate } from "@/modules/media/services/vodDispatchSearch";
import {
  runWithConcurrencyLimit,
  withVodInterfaceTimeout,
} from "@/modules/media/services/vodBrowseRuntime";
import {
  parseVodResponse,
  resolveSiteSpiderUrl,
} from "@/modules/media/services/tvboxConfig";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import type {
  NormalizedTvBoxConfig,
  NormalizedTvBoxSite,
} from "@/modules/media/types/tvbox.types";
import type { VodDispatchCandidate } from "@/modules/media/types/vodDispatch.types";

interface ResolveVodDispatchMatchesArgs {
  keyword: string;
  fallbackTitle?: string;
  maxMatches?: number;
  config: NormalizedTvBoxConfig;
  activeSiteKey: string;
  runtimeSessionKey: string;
  policyGeneration: number;
  concurrency: number;
  isStale: () => boolean;
  resolveSiteExt: (site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">) => Promise<string>;
  getSpiderRuntimeWarmupPromise: (
    spiderUrl: string,
    apiClass: string,
  ) => Promise<unknown> | null;
}

export async function resolveVodDispatchMatches({
  keyword,
  fallbackTitle = "",
  maxMatches = 4,
  config,
  activeSiteKey,
  runtimeSessionKey,
  policyGeneration,
  concurrency,
  isStale,
  resolveSiteExt,
  getSpiderRuntimeWarmupPromise,
}: ResolveVodDispatchMatchesArgs): Promise<VodDispatchCandidate[]> {
  const normalizedKeyword = keyword.trim() || fallbackTitle.trim();
  if (!normalizedKeyword) {
    return [];
  }

  const cappedMaxMatches = Math.max(1, Math.min(maxMatches, 12));
  const active = config.sites.find((site) => site.key === activeSiteKey) ?? null;
  const orderedSites = [
    ...(active ? [active] : []),
    ...config.sites.filter((site) => site.key !== activeSiteKey),
  ]
    .filter((site) => site.capability.canSearch)
    .slice(0, 12);

  if (!orderedSites.length) {
    return [];
  }

  const matches: Array<{ order: number; value: VodDispatchCandidate }> = [];

  await runWithConcurrencyLimit(
    orderedSites,
    Math.min(concurrency, orderedSites.length),
    async (site, order) => {
      if (isStale() || matches.length >= cappedMaxMatches) {
        return;
      }

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
          return;
        }

        const detailResult = await fetchVodDetail(
          {
            site,
            spider: config.spider,
            runtimeSessionKey,
            policyGeneration,
          },
          bestCandidate.vod_id,
        );
        if (isStale() || !detailResult.routes.length) {
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
      } catch {
        // Continue with the next site.
      }
    },
  );

  if (isStale()) {
    return [];
  }

  return matches
    .sort((left, right) => left.order - right.order)
    .slice(0, cappedMaxMatches)
    .map((item) => item.value);
}
