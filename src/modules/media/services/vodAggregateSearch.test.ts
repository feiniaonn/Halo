import { describe, expect, it } from "vitest";

import {
  buildAggregateSearchItems,
  getDefaultVodBrowseMode,
} from "@/modules/media/services/vodAggregateSearch";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

function createSite(
  key: string,
  options?: Partial<NormalizedTvBoxSite["capability"]>,
): NormalizedTvBoxSite {
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
      ...options,
    },
  };
}

describe("vodAggregateSearch", () => {
  it("defaults to aggregate mode when multiple searchable sites exist", () => {
    expect(getDefaultVodBrowseMode([
      createSite("alpha"),
      createSite("beta"),
    ])).toBe("aggregate");
  });

  it("keeps site mode when only one searchable site remains", () => {
    expect(getDefaultVodBrowseMode([
      createSite("alpha"),
      createSite("beta", { canSearch: false }),
    ])).toBe("site");
  });

  it("tags aggregate search items with source metadata", () => {
    const items = buildAggregateSearchItems(
      createSite("douban"),
      "庆余年",
      [{ vod_id: "1", vod_name: "庆余年", vod_pic: "", vod_remarks: "" }],
      2,
    );

    expect(items).toEqual([
      expect.objectContaining({
        vod_id: "1",
        aggregateKeyword: "庆余年",
        aggregateSource: expect.objectContaining({
          siteKey: "douban",
          order: 2,
        }),
      }),
    ]);
  });
});
