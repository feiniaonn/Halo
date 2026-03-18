import { describe, expect, it } from "vitest";

import { mergeVodBrowseItems } from "@/modules/media/services/vodBrowseRuntime";
import type { VodAggregateResultItem, VodBrowseItem, TvBoxVodItem } from "@/modules/media/types/tvbox.types";

function createVodItem(vodId: string, vodName = vodId): TvBoxVodItem {
  return {
    vod_id: vodId,
    vod_name: vodName,
    vod_pic: "",
    vod_remarks: "",
  };
}

function createAggregateItem(siteKey: string, vodId: string): VodAggregateResultItem {
  return {
    ...createVodItem(vodId),
    aggregateKeyword: "test",
    aggregateSource: {
      siteKey,
      siteName: siteKey,
      sourceKind: "spider",
      order: 0,
    },
  };
}

describe("vodBrowseRuntime", () => {
  it("deduplicates the same aggregate result from the same site", () => {
    const current: VodBrowseItem[] = [createAggregateItem("alpha", "1")];
    const merged = mergeVodBrowseItems(current, [
      createAggregateItem("alpha", "1"),
      createAggregateItem("alpha", "2"),
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.vod_id)).toEqual(["1", "2"]);
  });

  it("keeps the same vod id when it comes from different aggregate sites", () => {
    const merged = mergeVodBrowseItems(
      [createAggregateItem("alpha", "same-id")],
      [createAggregateItem("beta", "same-id")],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ vod_id: "same-id" });
    expect(merged[1]).toMatchObject({
      vod_id: "same-id",
      aggregateSource: expect.objectContaining({ siteKey: "beta" }),
    });
  });
});
