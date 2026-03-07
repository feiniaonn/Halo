import { invoke } from "@tauri-apps/api/core";

import { parseVodDetailResponse, resolveSiteSpiderUrl } from "@/modules/media/services/tvboxConfig";
import { resolveSiteExtInput } from "@/modules/media/services/tvboxRuntime";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodEpisode, VodRoute } from "@/modules/media/types/vodWindow.types";

export interface VodDetailContext {
  site: NormalizedTvBoxSite;
  spider: string;
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
  const extInput = await resolveSiteExtInput(site);
  const response = site.capability.requiresSpider
    ? await invoke<string>("spider_detail", {
      spiderUrl: resolveSiteSpiderUrl(site, spider),
      siteKey: site.key,
      apiClass: site.api,
      ext: extInput,
      ids: [String(vodId)],
    })
    : await invoke<string>("fetch_vod_detail", {
      apiUrl: site.api,
      ids: String(vodId),
    });

  if (!response || !response.trim()) {
    throw new Error("源站返回空详情。");
  }

  const detail = parseVodDetailResponse(response).list?.[0] as VodDetail | undefined;
  if (!detail?.vod_id) {
    throw new Error("未获取到影视详情。");
  }

  return {
    detail,
    routes: parseVodRoutes(detail.vod_play_from, detail.vod_play_url),
    extInput,
  };
}
