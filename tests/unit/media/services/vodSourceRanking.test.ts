import { describe, expect, it } from "vitest";

import {
  mergeVodSiteRankingSuccess,
  sortVodSitesByRanking,
} from "@/modules/media/services/vodSourceRanking";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

function createSite(key: string): NormalizedTvBoxSite {
  return {
    key,
    name: key,
    type: 0,
    api: `https://example.com/${key}`,
    jar: "",
    ext: "",
    extKind: "text",
    extValue: "",
    searchable: true,
    quickSearch: false,
    filterable: false,
    playUrl: "",
    click: "",
    playerType: "",
    categories: [],
    capability: {
      sourceKind: "spider",
      canHome: true,
      canCategory: true,
      canSearch: true,
      searchOnly: false,
      displayOnly: false,
      requiresSpider: true,
      supportsDetail: true,
      supportsPlay: true,
      mayNeedParse: false,
      supportsBrowserParse: false,
      hasRemoteExt: false,
      hasPlayUrl: false,
      hasPresetCategories: false,
    },
  };
}

describe("vodSourceRanking", () => {
  it("increments success stats optimistically", () => {
    const ranked = mergeVodSiteRankingSuccess([
      { siteKey: "alpha", successCount: 2, lastSuccessAt: 10 },
    ], "alpha");

    expect(ranked).toEqual([
      expect.objectContaining({
        siteKey: "alpha",
        successCount: 3,
      }),
    ]);
  });

  it("prioritizes persisted successful sites ahead of the default order", () => {
    const sorted = sortVodSitesByRanking(
      [createSite("alpha"), createSite("beta"), createSite("gamma")],
      [
        { siteKey: "gamma", successCount: 5, lastSuccessAt: 30 },
        { siteKey: "beta", successCount: 2, lastSuccessAt: 20 },
      ],
      "alpha",
    );

    expect(sorted.map((site) => site.key)).toEqual(["gamma", "beta", "alpha"]);
  });
});
