import { invoke } from "@tauri-apps/api/core";

import { classifyVodDispatchFailure } from "@/modules/media/services/vodDispatchHealth";
import {
  buildAggregateSearchItems,
  buildAggregateSiteStatuses,
  updateAggregateSiteStatus,
} from "@/modules/media/services/vodAggregateSearch";
import {
  normalizeVodRequestErrorMessage,
  runWithConcurrencyLimit,
  withVodInterfaceTimeout,
} from "@/modules/media/services/vodBrowseRuntime";
import {
  parseVodResponse,
  resolveSiteSpiderUrl,
} from "@/modules/media/services/tvboxConfig";
import type {
  NormalizedTvBoxSite,
  SpiderExecutionReport,
  VodAggregateResultItem,
  VodAggregateSessionState,
} from "@/modules/media/types/tvbox.types";
import type { VodDispatchFailureKind } from "@/modules/media/types/vodDispatch.types";

interface ExecuteAggregateVodSearchArgs {
  keyword: string;
  sites: NormalizedTvBoxSite[];
  spider: string;
  concurrency: number;
  isStale: () => boolean;
  resolveSiteExt: (site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">) => Promise<string>;
  getSpiderRuntimeWarmupPromise: (
    spiderUrl: string,
    apiClass: string,
  ) => Promise<unknown> | null;
  syncSpiderExecutionState: (siteKey: string) => Promise<SpiderExecutionReport | null>;
  onItems: (items: VodAggregateResultItem[]) => void;
  onStatusesChange: (
    statuses: VodAggregateSessionState["statuses"],
    running: boolean,
  ) => void;
  onSiteSuccess?: (siteKey: string) => void;
  onSiteFailure?: (siteKey: string, failureKind: VodDispatchFailureKind) => void;
}

interface ExecuteAggregateVodSearchResult {
  items: VodAggregateResultItem[];
  statuses: VodAggregateSessionState["statuses"];
}

export async function executeAggregateVodSearch({
  keyword,
  sites,
  spider,
  concurrency,
  isStale,
  resolveSiteExt,
  getSpiderRuntimeWarmupPromise,
  syncSpiderExecutionState,
  onItems,
  onStatusesChange,
  onSiteSuccess,
  onSiteFailure,
}: ExecuteAggregateVodSearchArgs): Promise<ExecuteAggregateVodSearchResult> {
  let statuses = buildAggregateSiteStatuses(sites);
  const aggregateItems: VodAggregateResultItem[] = [];

  const syncStatuses = (running: boolean) => {
    if (isStale()) {
      return;
    }
    onStatusesChange(statuses, running);
  };

  const patchStatus = (
    siteKey: string,
    patch: Partial<VodAggregateSessionState["statuses"][number]>,
    running = true,
  ) => {
    statuses = updateAggregateSiteStatus(statuses, siteKey, patch);
    syncStatuses(running);
  };

  syncStatuses(true);

  await runWithConcurrencyLimit(
    sites,
    concurrency,
    async (site, order) => {
      if (isStale()) {
        return;
      }

      patchStatus(site.key, {
        state: "loading",
        resultCount: 0,
        message: undefined,
      });

      try {
        const spiderUrl = resolveSiteSpiderUrl(site, spider);
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExt(site), `aggregate_ext:${site.key}`)
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

        const response = site.capability.requiresSpider
          ? await invoke<string>("spider_search", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
            keyword,
            quick: site.quickSearch,
          })
          : await withVodInterfaceTimeout(invoke<string>("fetch_vod_search", {
            apiUrl: site.api,
            keyword,
          }), `aggregate_search:${site.key}`);

        const items = buildAggregateSearchItems(
          site,
          keyword,
          parseVodResponse(response).list ?? [],
          order,
        );
        if (isStale()) {
          return;
        }

        if (site.capability.requiresSpider) {
          await syncSpiderExecutionState(site.key);
          if (isStale()) {
            return;
          }
        }

        aggregateItems.push(...items);
        onItems(items);
        if (items.length > 0) {
          onSiteSuccess?.(site.key);
        }
        patchStatus(site.key, {
          state: items.length > 0 ? "success" : "empty",
          resultCount: items.length,
        });
      } catch (reason) {
        if (isStale()) {
          return;
        }
        const message = normalizeVodRequestErrorMessage(reason);
        const report = site.capability.requiresSpider
          ? await syncSpiderExecutionState(site.key).catch(() => null)
          : null;
        onSiteFailure?.(site.key, classifyVodDispatchFailure(message, report));
        patchStatus(site.key, {
          state: message.includes("超时") ? "timeout" : "error",
          resultCount: 0,
          message,
        });
      }
    },
  );

  return {
    items: aggregateItems,
    statuses,
  };
}
