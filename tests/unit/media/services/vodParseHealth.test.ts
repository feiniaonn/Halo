import { describe, expect, it } from "vitest";

import {
  VOD_PARSE_FAILURE_DECAY_WINDOW_MS,
  VOD_PARSE_QUARANTINE_WINDOW_MS,
  classifyVodParseFailure,
  getVodParseHealthSnapshot,
  getVodParseHealthState,
  mergeVodParseHealthFailure,
  mergeVodParseHealthSuccess,
} from "@/modules/media/services/vodParseHealth";

describe("vodParseHealth", () => {
  it("classifies validation failures from explicit probe reasons", () => {
    expect(classifyVodParseFailure("ignored", {
      validationReason: "stream_probe_hls_image_manifest",
    })).toBe("validation");
  });

  it("quarantines a parser after repeated hard failures", () => {
    const now = 1_710_000_000_000;
    const first = mergeVodParseHealthFailure([], "https://jiexi-a.example.com/?url=", "validation", 900, now);
    const second = mergeVodParseHealthFailure(
      first,
      "https://jiexi-a.example.com/?url=",
      "runtime",
      1_100,
      now + 5_000,
    );

    expect(second[0]).toEqual(expect.objectContaining({
      consecutiveHardFailures: 2,
      consecutiveSoftFailures: 0,
      quarantineUntil: now + 5_000 + VOD_PARSE_QUARANTINE_WINDOW_MS,
      lastStatus: "failed:runtime",
    }));
    expect(getVodParseHealthState(second[0], now + 5_001)).toBe("quarantined");
  });

  it("quarantines a parser after repeated soft failures and resets on success", () => {
    const now = 1_710_000_100_000;
    const once = mergeVodParseHealthFailure([], "https://jiexi-b.example.com/?url=", "timeout", 1_400, now);
    const twice = mergeVodParseHealthFailure(
      once,
      "https://jiexi-b.example.com/?url=",
      "upstream",
      1_600,
      now + 2_000,
    );
    const thrice = mergeVodParseHealthFailure(
      twice,
      "https://jiexi-b.example.com/?url=",
      "timeout",
      1_500,
      now + 4_000,
    );
    const recovered = mergeVodParseHealthSuccess(
      thrice,
      "https://jiexi-b.example.com/?url=",
      800,
      now + 6_000,
    );

    expect(thrice[0]).toEqual(expect.objectContaining({
      consecutiveHardFailures: 0,
      consecutiveSoftFailures: 3,
    }));
    expect(getVodParseHealthState(thrice[0], now + 4_001)).toBe("quarantined");
    expect(recovered[0]).toEqual(expect.objectContaining({
      successCount: 1,
      consecutiveHardFailures: 0,
      consecutiveSoftFailures: 0,
      quarantineUntil: 0,
      lastStatus: "success",
    }));
    expect(getVodParseHealthState(recovered[0], now + 6_001)).toBe("healthy");
  });

  it("lets cooldown decay away after the parser has been quiet long enough", () => {
    const now = 1_710_000_300_000;
    const failed = mergeVodParseHealthFailure([], "https://jiexi-c.example.com/?url=", "timeout", 1_200, now);
    const decayedAt = now + VOD_PARSE_FAILURE_DECAY_WINDOW_MS + 1;
    const snapshot = getVodParseHealthSnapshot(failed[0], decayedAt);

    expect(getVodParseHealthState(failed[0], now + 1)).toBe("cooldown");
    expect(snapshot.effectiveSoftFailures).toBe(0);
    expect(getVodParseHealthState(failed[0], decayedAt)).toBe("healthy");
  });
});
