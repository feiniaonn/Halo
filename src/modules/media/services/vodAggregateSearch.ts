import type {
  NormalizedTvBoxSite,
  TvBoxVodItem,
  VodAggregateResultItem,
  VodAggregateSessionState,
  VodAggregateSiteStatus,
  VodBrowseMode,
} from "@/modules/media/types/tvbox.types";

export function getAggregateEligibleSites(
  sites: NormalizedTvBoxSite[],
  activeSiteKey = "",
): NormalizedTvBoxSite[] {
  const active = sites.find((site) => site.key === activeSiteKey) ?? null;
  return [
    ...(active ? [active] : []),
    ...sites.filter((site) => site.key !== activeSiteKey),
  ].filter((site) => site.capability.canSearch);
}

export function getDefaultVodBrowseMode(sites: NormalizedTvBoxSite[]): VodBrowseMode {
  return getAggregateEligibleSites(sites).length > 1 ? "aggregate" : "site";
}

export function buildAggregateSiteStatuses(
  sites: NormalizedTvBoxSite[],
): VodAggregateSiteStatus[] {
  return sites.map((site, order) => ({
    siteKey: site.key,
    siteName: site.name,
    state: "idle",
    order,
    resultCount: 0,
    updatedAt: 0,
  }));
}

export function buildAggregateSessionState(
  keyword: string,
  statuses: VodAggregateSiteStatus[],
  isRunning: boolean,
): VodAggregateSessionState {
  const completedCount = statuses.filter((status) => status.state !== "idle" && status.state !== "loading").length;
  const successCount = statuses.filter((status) => status.state === "success").length;
  return {
    keyword,
    siteCount: statuses.length,
    completedCount,
    successCount,
    isRunning,
    statuses: [...statuses].sort((left, right) => left.order - right.order),
  };
}

export function updateAggregateSiteStatus(
  statuses: VodAggregateSiteStatus[],
  siteKey: string,
  patch: Partial<Omit<VodAggregateSiteStatus, "siteKey" | "siteName" | "order">>,
): VodAggregateSiteStatus[] {
  return statuses.map((status) => {
    if (status.siteKey !== siteKey) {
      return status;
    }
    return {
      ...status,
      ...patch,
      updatedAt: Date.now(),
    };
  });
}

export function buildAggregateSearchItems(
  site: NormalizedTvBoxSite,
  keyword: string,
  items: TvBoxVodItem[],
  order: number,
): VodAggregateResultItem[] {
  return items.map((item) => ({
    ...item,
    aggregateKeyword: keyword,
    aggregateSource: {
      siteKey: site.key,
      siteName: site.name,
      sourceKind: site.capability.sourceKind,
      order,
    },
  }));
}
