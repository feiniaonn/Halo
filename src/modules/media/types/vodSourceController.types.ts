import type {
  TvBoxClass,
  TvBoxVodItem,
  VodAggregateResultItem,
  VodAggregateSessionState,
} from "@/modules/media/types/tvbox.types";

export interface MediaNetworkPolicyStatus {
  generation: number;
  request_header_rule_count: number;
  host_mapping_count: number;
  doh_entry_count: number;
  supports_doh_resolver: boolean;
  active_doh_provider_name?: string | null;
  unsupported_doh_entry_count?: number;
}

export interface HomeCacheEntry {
  classes: TvBoxClass[];
  activeClassId: string;
  list: TvBoxVodItem[];
  shouldSkipInitialCategoryFetch: boolean;
}

export interface CategoryCacheEntry {
  list: TvBoxVodItem[];
  hasMore: boolean;
}

export interface AggregateCacheEntry {
  items: VodAggregateResultItem[];
  statuses: VodAggregateSessionState["statuses"];
}
