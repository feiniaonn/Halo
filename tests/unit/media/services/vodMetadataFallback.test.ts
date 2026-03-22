import { describe, expect, it } from "vitest";

import { getVodMetadataHomeFallbackTarget } from "@/modules/media/services/vodMetadataFallback";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

function createSite(
  overrides?: Partial<NormalizedTvBoxSite["capability"]>,
): Pick<NormalizedTvBoxSite, "capability"> {
  return {
    capability: {
      sourceKind: "spider",
      dispatchRole: "resource-backend",
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
      hasPresetCategories: true,
      ...overrides,
    },
  };
}

describe("vodMetadataFallback", () => {
  it("returns the first preset class for metadata sites", () => {
    const target = getVodMetadataHomeFallbackTarget(
      createSite({
        dispatchRole: "origin-metadata",
        canSearch: false,
      }),
      [
        { type_id: "movie", type_name: "电影" },
        { type_id: "tv", type_name: "电视剧" },
      ],
    );

    expect(target).toEqual({
      classId: "movie",
      classes: [
        { type_id: "movie", type_name: "电影" },
        { type_id: "tv", type_name: "电视剧" },
      ],
    });
  });

  it("does not fallback for non-metadata sites", () => {
    const target = getVodMetadataHomeFallbackTarget(createSite(), [
      { type_id: "movie", type_name: "电影" },
    ]);

    expect(target).toBeNull();
  });

  it("does not fallback when no category is available", () => {
    const target = getVodMetadataHomeFallbackTarget(
      createSite({
        dispatchRole: "origin-metadata",
        canSearch: false,
        canCategory: false,
      }),
      [{ type_id: "movie", type_name: "电影" }],
    );

    expect(target).toBeNull();
  });
});
