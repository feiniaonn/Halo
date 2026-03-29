import { invoke } from "@tauri-apps/api/core";

import { invokeSpiderDetailV2 } from "@/modules/media/services/spiderV2";
import { parseVodDetailResponse, resolveSiteSpiderUrl } from "@/modules/media/services/tvboxConfig";
import {
  loadPersistedVodDetailCache,
  savePersistedVodDetailCache,
} from "@/modules/media/services/vodPersistentCache";
import { resolveSiteExtInput } from "@/modules/media/services/tvboxRuntime";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodEpisode, VodRoute } from "@/modules/media/types/vodWindow.types";

export interface VodDetailContext {
  site: NormalizedTvBoxSite;
  spider: string;
  sourceKey?: string;
  repoUrl?: string;
  runtimeSessionKey?: string;
  policyGeneration?: number;
  forceRefresh?: boolean;
}

export function parseVodRoutes(playFrom?: string, playUrl?: string): VodRoute[] {
  if (!playFrom || !playUrl) return [];

  const sources = playFrom.split("$$$");
  const groups = playUrl.split("$$$");
  return sources
    .map((sourceName, index) => {
      const episodes: VodEpisode[] = (groups[index] ?? "")
        .split("#")
        .filter(Boolean)
        .map((episode) => {
          const splitAt = episode.indexOf("$");
          const name = splitAt >= 0 ? episode.slice(0, splitAt) : episode;
          const url = splitAt >= 0 ? episode.slice(splitAt + 1) : "";
          return {
            name: name.trim() || "未命名",
            url: url.trim(),
            searchOnly: url.startsWith("msearch:"),
          };
        })
        .filter((episode) => episode.url !== "");

      return {
        sourceName: sourceName.trim() || "默认线路",
        episodes,
      };
    })
    .filter((route) => route.episodes.length > 0);
}

export async function fetchVodDetail(
  context: VodDetailContext,
  vodId: string,
): Promise<{ detail: VodDetail; routes: VodRoute[]; extInput: string; }> {
  const { site, spider } = context;
  const sourceKey = context.sourceKey?.trim() ?? "";
  const repoUrl = context.repoUrl?.trim() ?? "";
  const normalizedVodId = String(vodId).trim();
  if (!context.forceRefresh && sourceKey) {
    const persisted = await loadPersistedVodDetailCache(sourceKey, repoUrl, site.key, normalizedVodId);
    const shouldBypassPersistedCache = Boolean(
      persisted
      && site.capability.supportsPlay
      && !site.capability.displayOnly
      && persisted.routes.length === 0,
    );
    if (persisted && !shouldBypassPersistedCache) {
      return persisted;
    }
  }

  const extInput = await resolveSiteExtInput(site, {
    sessionKey: context.runtimeSessionKey,
    policyGeneration: context.policyGeneration,
  });
  let normalizedPayload: unknown;
  if (site.capability.requiresSpider) {
    const response = await invokeSpiderDetailV2({
      spiderUrl: resolveSiteSpiderUrl(site, spider),
      siteKey: site.key,
      apiClass: site.api,
      ext: extInput,
      ids: [String(vodId)],
    });
    if (!response.rawPayload?.trim()) {
      throw new Error("源站返回空详情。");
    }
    normalizedPayload = response.normalizedPayload;
  } else {
    const response = await invoke<string>("fetch_vod_detail", {
      apiUrl: site.api,
      ids: String(vodId),
    });
    if (!response?.trim()) {
      throw new Error("源站返回空详情。");
    }
    normalizedPayload = response;
  }

  const detail = parseVodDetailResponse(normalizedPayload).list?.[0] as VodDetail | undefined;
  if (!detail?.vod_id) {
    throw new Error("未获取到影视详情。");
  }

  const result = {
    detail,
    routes: parseVodRoutes(detail.vod_play_from, detail.vod_play_url),
    extInput,
  };

  if (sourceKey && normalizedVodId) {
    void savePersistedVodDetailCache(sourceKey, repoUrl, site.key, normalizedVodId, result).catch(() => {
      // Ignore cache persistence failures and keep the fresh result.
    });
  }

  return result;
}
