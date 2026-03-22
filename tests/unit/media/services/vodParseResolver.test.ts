import { describe, expect, it } from "vitest";

import { selectVodParses } from "@/modules/media/services/vodParseResolver";
import type { TvBoxParse } from "@/modules/media/types/vodWindow.types";

function buildParse(name: string, url: string): TvBoxParse {
  return {
    name,
    type: 0,
    url,
  };
}

describe("vodParseResolver", () => {
  it("prefers healthy parsers over quarantined parsers even when the quarantined parser was previously successful", () => {
    const result = selectVodParses([
      buildParse("slow winner", "https://jiexi-a.example.com/?url="),
      buildParse("healthy backup", "https://jiexi-b.example.com/?url="),
    ], {
      jxIndex: 0,
      routeName: "默认线路",
      pageUrl: "https://example.com/watch/1",
      rankingRecords: [
        {
          parseUrl: "https://jiexi-a.example.com/?url=",
          successCount: 5,
          lastSuccessAt: 5_000,
        },
      ],
      healthRecords: [
        {
          parseUrl: "https://jiexi-a.example.com/?url=",
          successCount: 5,
          failureCount: 2,
          lastStatus: "failed:validation",
          lastFailureKind: "validation",
          lastUsedAt: 5_200,
          lastDurationMs: 1_200,
          avgDurationMs: 1_100,
          consecutiveHardFailures: 2,
          consecutiveSoftFailures: 0,
          quarantineUntil: Date.now() + 60_000,
        },
      ],
    });

    expect(result.ordered.map((parse) => parse.name)).toEqual([
      "healthy backup",
      "slow winner",
    ]);
  });

  it("prefers remembered successful parsers when health state is the same", () => {
    const result = selectVodParses([
      buildParse("first", "https://jiexi-a.example.com/?url="),
      buildParse("second", "https://jiexi-b.example.com/?url="),
    ], {
      jxIndex: 0,
      routeName: "默认线路",
      pageUrl: "https://example.com/watch/2",
      rankingRecords: [
        {
          parseUrl: "https://jiexi-b.example.com/?url=",
          successCount: 3,
          lastSuccessAt: 9_000,
        },
      ],
      healthRecords: [
        {
          parseUrl: "https://jiexi-a.example.com/?url=",
          successCount: 1,
          failureCount: 0,
          lastStatus: "success",
          lastFailureKind: null,
          lastUsedAt: 8_000,
          lastDurationMs: 1_500,
          avgDurationMs: 1_500,
          consecutiveHardFailures: 0,
          consecutiveSoftFailures: 0,
          quarantineUntil: 0,
        },
        {
          parseUrl: "https://jiexi-b.example.com/?url=",
          successCount: 3,
          failureCount: 0,
          lastStatus: "success",
          lastFailureKind: null,
          lastUsedAt: 9_100,
          lastDurationMs: 900,
          avgDurationMs: 900,
          consecutiveHardFailures: 0,
          consecutiveSoftFailures: 0,
          quarantineUntil: 0,
        },
      ],
    });

    expect(result.ordered.map((parse) => parse.name)).toEqual([
      "second",
      "first",
    ]);
  });

  it("uses average duration to break ties between equally healthy parsers without success memory", () => {
    const result = selectVodParses([
      buildParse("slower", "https://jiexi-a.example.com/?url="),
      buildParse("faster", "https://jiexi-b.example.com/?url="),
    ], {
      jxIndex: 0,
      routeName: "默认线路",
      pageUrl: "https://example.com/watch/3",
      rankingRecords: [],
      healthRecords: [
        {
          parseUrl: "https://jiexi-a.example.com/?url=",
          successCount: 0,
          failureCount: 0,
          lastStatus: "success",
          lastFailureKind: null,
          lastUsedAt: 5_000,
          lastDurationMs: 1_300,
          avgDurationMs: 1_300,
          consecutiveHardFailures: 0,
          consecutiveSoftFailures: 0,
          quarantineUntil: 0,
        },
        {
          parseUrl: "https://jiexi-b.example.com/?url=",
          successCount: 0,
          failureCount: 0,
          lastStatus: "success",
          lastFailureKind: null,
          lastUsedAt: 4_000,
          lastDurationMs: 700,
          avgDurationMs: 700,
          consecutiveHardFailures: 0,
          consecutiveSoftFailures: 0,
          quarantineUntil: 0,
        },
      ],
    });

    expect(result.ordered.map((parse) => parse.name)).toEqual([
      "faster",
      "slower",
    ]);
  });

  it("does not let an old cooldown permanently suppress a parser after decay passes", () => {
    const now = Date.now();
    const result = selectVodParses([
      buildParse("recent fallback", "https://jiexi-a.example.com/?url="),
      buildParse("recovered parser", "https://jiexi-b.example.com/?url="),
    ], {
      jxIndex: 0,
      routeName: "默认线路",
      pageUrl: "https://example.com/watch/4",
      rankingRecords: [
        {
          parseUrl: "https://jiexi-b.example.com/?url=",
          successCount: 5,
          lastSuccessAt: now - 60_000,
        },
      ],
      healthRecords: [
        {
          parseUrl: "https://jiexi-b.example.com/?url=",
          successCount: 5,
          failureCount: 1,
          lastStatus: "failed:timeout",
          lastFailureKind: "timeout",
          lastUsedAt: now - (31 * 60_000),
          lastDurationMs: 1_100,
          avgDurationMs: 1_000,
          consecutiveHardFailures: 0,
          consecutiveSoftFailures: 1,
          quarantineUntil: 0,
        },
      ],
    });

    expect(result.ordered.map((parse) => parse.name)).toEqual([
      "recovered parser",
      "recent fallback",
    ]);
  });
});
