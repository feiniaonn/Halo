import { useEffect } from "react";

import { planVodWarmupSites } from "@/modules/media/services/vodDispatchHealth";
import { runWithConcurrencyLimit } from "@/modules/media/services/vodBrowseRuntime";
import { resolveSiteSpiderUrl } from "@/modules/media/services/tvboxConfig";
import { prefetchSiteExtInputs } from "@/modules/media/services/tvboxRuntime";
import type { NormalizedTvBoxConfig, NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDispatchBackendStat } from "@/modules/media/types/vodDispatch.types";

interface UseVodSpiderWarmupArgs {
  config: NormalizedTvBoxConfig | null;
  activeSiteKey: string;
  activeVodSite: NormalizedTvBoxSite | null;
  activeSiteExecutionTarget?: string;
  prioritizedSites: NormalizedTvBoxSite[];
  activeOriginDispatchBackendStats: VodDispatchBackendStat[];
  aggregateDispatchBackendStats: VodDispatchBackendStat[];
  runtimeSessionKey: string;
  networkPolicyGeneration: number;
  siteReloadToken: number;
  extPrefetchConcurrency: number;
  backgroundWarmupConcurrency: number;
  backgroundWarmupMaxSites: number;
  resolveSiteExt: (
    site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">,
    options?: { forceRefresh?: boolean },
  ) => Promise<string>;
  triggerJarPrefetch: (
    siteKey: string,
    spiderUrl: string,
    apiClass: string,
    ext: string,
    options?: { trackAsActive?: boolean; profileSite?: boolean; notifyOnFailure?: boolean },
  ) => Promise<unknown>;
  syncCompatHelperStatus: () => Promise<unknown>;
}

export function useVodSpiderWarmup({
  config,
  activeSiteKey,
  activeVodSite,
  activeSiteExecutionTarget,
  prioritizedSites,
  activeOriginDispatchBackendStats,
  aggregateDispatchBackendStats,
  runtimeSessionKey,
  networkPolicyGeneration,
  siteReloadToken,
  extPrefetchConcurrency,
  backgroundWarmupConcurrency,
  backgroundWarmupMaxSites,
  resolveSiteExt,
  triggerJarPrefetch,
  syncCompatHelperStatus,
}: UseVodSpiderWarmupArgs): void {
  useEffect(() => {
    if (!config?.sites.length || !runtimeSessionKey) {
      return;
    }
    void prefetchSiteExtInputs(config.sites, {
      sessionKey: runtimeSessionKey,
      policyGeneration: networkPolicyGeneration,
    }, extPrefetchConcurrency).catch(() => {
      // Ignore best-effort prefetch failures and resolve ext lazily on demand.
    });
  }, [config, extPrefetchConcurrency, networkPolicyGeneration, runtimeSessionKey]);

  useEffect(() => {
    if (!config?.sites.length || !activeSiteKey) {
      return;
    }

    const warmupCandidates = planVodWarmupSites({
      sites: prioritizedSites,
      activeSiteKey,
      activeOriginBackendStats: activeOriginDispatchBackendStats,
      aggregateBackendStats: aggregateDispatchBackendStats,
      maxSites: backgroundWarmupMaxSites,
    });

    void runWithConcurrencyLimit(
      warmupCandidates,
      backgroundWarmupConcurrency,
      async (site) => {
        const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
        if (!spiderUrl) {
          return;
        }
        const extInput = await resolveSiteExt(site);
        await triggerJarPrefetch(site.key, spiderUrl, site.api, extInput, {
          trackAsActive: site.key === activeSiteKey,
          profileSite: true,
        });
      },
    ).catch(() => {
      // Ignore best-effort warmup failures.
    });
  }, [
    activeOriginDispatchBackendStats,
    activeSiteKey,
    aggregateDispatchBackendStats,
    backgroundWarmupConcurrency,
    backgroundWarmupMaxSites,
    config,
    prioritizedSites,
    resolveSiteExt,
    siteReloadToken,
    triggerJarPrefetch,
  ]);

  useEffect(() => {
    if (!activeVodSite || !config || !activeVodSite.capability.requiresSpider) {
      return;
    }
    const spiderUrl = resolveSiteSpiderUrl(activeVodSite, config.spider);
    if (!spiderUrl) {
      return;
    }
    void resolveSiteExt(activeVodSite).then((extInput) => {
      void triggerJarPrefetch(activeVodSite.key, spiderUrl, activeVodSite.api, extInput, {
        trackAsActive: true,
        profileSite: true,
      });
    });
  }, [activeVodSite, config, resolveSiteExt, siteReloadToken, triggerJarPrefetch]);

  useEffect(() => {
    if (activeSiteExecutionTarget === "desktop-helper") {
      void syncCompatHelperStatus();
    }
  }, [activeSiteExecutionTarget, syncCompatHelperStatus]);
}
