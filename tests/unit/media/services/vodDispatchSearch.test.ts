import { describe, expect, it } from "vitest";

import {
  pickBestVodDispatchCandidate,
  scoreVodDispatchCandidate,
} from "@/modules/media/services/vodDispatchSearch";

describe("vodDispatchSearch", () => {
  it("prefers exact title matches", () => {
    const score = scoreVodDispatchCandidate("豆瓣热播", { vod_name: "豆瓣热播" });
    expect(score).toBe(100);
  });

  it("falls back to the best fuzzy match", () => {
    const picked = pickBestVodDispatchCandidate("凡人修仙传", [
      { vod_id: "1", vod_name: "凡人修仙传星海飞驰", vod_pic: "", vod_remarks: "" },
      { vod_id: "2", vod_name: "其他结果", vod_pic: "", vod_remarks: "" },
    ]);

    expect(picked?.vod_id).toBe("1");
  });
});
