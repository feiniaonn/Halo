import { invoke } from "@tauri-apps/api/core";

import type { NormalizedSpiderMethodResponse } from "@/modules/media/types/tvbox.types";

interface SpiderBaseParams {
  [key: string]: unknown;
  spiderUrl: string;
  siteKey: string;
  apiClass: string;
  ext: string;
}

interface SpiderSearchParams extends SpiderBaseParams {
  keyword: string;
  quick?: boolean;
}

interface SpiderCategoryParams extends SpiderBaseParams {
  tid: string;
  pg: number;
  filter?: Record<string, string>;
}

interface SpiderDetailParams extends SpiderBaseParams {
  ids: string[];
}

interface SpiderPlayerParams extends SpiderBaseParams {
  flag: string;
  id: string;
  vipFlags?: string[];
}

export function invokeSpiderHomeV2<T = unknown>(
  params: SpiderBaseParams,
): Promise<NormalizedSpiderMethodResponse<T>> {
  return invoke<NormalizedSpiderMethodResponse<T>>("spider_home_v2", params);
}

export function invokeSpiderCategoryV2<T = unknown>(
  params: SpiderCategoryParams,
): Promise<NormalizedSpiderMethodResponse<T>> {
  return invoke<NormalizedSpiderMethodResponse<T>>("spider_category_v2", params);
}

export function invokeSpiderSearchV2<T = unknown>(
  params: SpiderSearchParams,
): Promise<NormalizedSpiderMethodResponse<T>> {
  return invoke<NormalizedSpiderMethodResponse<T>>("spider_search_v2", params);
}

export function invokeSpiderDetailV2<T = unknown>(
  params: SpiderDetailParams,
): Promise<NormalizedSpiderMethodResponse<T>> {
  return invoke<NormalizedSpiderMethodResponse<T>>("spider_detail_v2", params);
}

export function invokeSpiderPlayerV2<T = unknown>(
  params: SpiderPlayerParams,
): Promise<NormalizedSpiderMethodResponse<T>> {
  return invoke<NormalizedSpiderMethodResponse<T>>("spider_player_v2", params);
}
