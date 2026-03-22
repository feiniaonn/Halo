import { describe, expect, it } from "vitest";

import {
  pickBestVodDispatchCandidate,
  scoreVodDispatchCandidate,
} from "@/modules/media/services/vodDispatchSearch";

describe("vodDispatchSearch", () => {
  it("prefers exact title matches", () => {
    const score = scoreVodDispatchCandidate("the movie", {
      vod_id: "1",
      vod_name: "the movie",
      vod_pic: "",
      vod_remarks: "",
    });

    expect(score).toBe(140);
  });

  it("picks the strongest fuzzy match", () => {
    const picked = pickBestVodDispatchCandidate("the movie", [
      { vod_id: "1", vod_name: "the movie 2024", vod_pic: "", vod_remarks: "" },
      { vod_id: "2", vod_name: "another title", vod_pic: "", vod_remarks: "" },
    ]);

    expect(picked?.vod_id).toBe("1");
  });

  it("does not force-pick unrelated results", () => {
    const picked = pickBestVodDispatchCandidate("the movie", [
      { vod_id: "1", vod_name: "other series", vod_pic: "", vod_remarks: "" },
      { vod_id: "2", vod_name: "totally different", vod_pic: "", vod_remarks: "" },
    ]);

    expect(picked).toBeNull();
  });
});
