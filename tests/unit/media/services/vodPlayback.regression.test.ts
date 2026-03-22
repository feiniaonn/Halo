import { beforeEach, describe, expect, it, vi } from "vitest";

import { vodPlaybackRegressionFixtures } from "@/../tests/fixtures/media/vodPlaybackRegressionFixtures";

const { invokeMock, invokeSpiderPlayerV2Mock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  invokeSpiderPlayerV2Mock: vi.fn(),
}));
const { listVodParseRankingsMock, recordVodParseSuccessMock } = vi.hoisted(() => ({
  listVodParseRankingsMock: vi.fn(),
  recordVodParseSuccessMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/modules/media/services/spiderV2", () => ({
  invokeSpiderPlayerV2: invokeSpiderPlayerV2Mock,
}));

vi.mock("@/modules/media/services/vodParseRanking", () => ({
  listVodParseRankings: listVodParseRankingsMock,
  recordVodParseSuccess: recordVodParseSuccessMock,
}));

import { clearVodPlaybackResolutionCache } from "@/modules/media/services/vodPlaybackResolutionCache";
import { clearVodParseHealthCache } from "@/modules/media/services/vodParseInsights";
import {
  clearVodParseRankingCache,
  clearSpiderPlayerPayloadCache,
  getVodPlaybackDiagnostics,
  resolveEpisodePlayback,
} from "@/modules/media/services/vodPlayback";

function mockProbeResult(url: string, overrides: Partial<Record<"kind" | "reason" | "content_type" | "final_url", string | null>> = {}) {
  return {
    kind: "hls",
    reason: null,
    content_type: "application/vnd.apple.mpegurl",
    final_url: url,
    ...overrides,
  };
}

describe("vodPlayback regression fixtures", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeSpiderPlayerV2Mock.mockReset();
    listVodParseRankingsMock.mockReset();
    recordVodParseSuccessMock.mockReset();
    clearSpiderPlayerPayloadCache();
    clearVodParseRankingCache();
    clearVodParseHealthCache();
    clearVodPlaybackResolutionCache();
    listVodParseRankingsMock.mockResolvedValue([]);
    recordVodParseSuccessMock.mockResolvedValue(undefined);
  });

  it("replays the real AppRJ line-switch timeout regression through wrapped + jiexi recovery", async () => {
    const fixture = vodPlaybackRegressionFixtures.apprjLine2WrappedJiexiRecovery;
    let jiexiAttempt = 0;

    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: fixture.spiderPayload,
    });
    invokeMock.mockImplementation(async (command: string, args?: { cacheKey?: string; url?: string }) => {
      if (command === "load_vod_playback_resolution_cache") {
        return null;
      }
      if (command === "save_vod_playback_resolution_cache") {
        return undefined;
      }
      if (command === "list_vod_parse_health_records") {
        return [];
      }
      if (command === "record_vod_parse_health_success" || command === "record_vod_parse_health_failure") {
        return undefined;
      }
      if (command === "resolve_wrapped_media_url") {
        return fixture.wrappedResolution;
      }
      if (command === "resolve_jiexi") {
        const next = fixture.jiexiResults[Math.min(jiexiAttempt, fixture.jiexiResults.length - 1)];
        jiexiAttempt += 1;
        return next;
      }
      if (command === "probe_stream_kind") {
        if ((args?.url ?? "").includes("token=image")) {
          return mockProbeResult(args?.url ?? "", {
            kind: "unknown",
            reason: "stream_probe_hls_image_manifest",
            content_type: "text/plain;charset=UTF-8",
          });
        }
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback(
      fixture.context,
      fixture.episode,
      fixture.routeName,
    );
    const diagnostics = getVodPlaybackDiagnostics(result);

    expect(fixture.source.excerpt.join(" ")).toContain("episode playback resolve timeout");
    expect(result).toEqual({
      url: "https://media.example.com/final/index.m3u8?token=recovered",
      headers: {
        Referer: "https://page.example.com/detail/1",
      },
      resolvedBy: "jiexi",
    });
    expect(diagnostics?.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "wrapped_url", status: "skip" }),
      expect.objectContaining({ stage: "parse_attempt", status: "miss" }),
      expect.objectContaining({ stage: "parse_attempt", status: "success" }),
      expect.objectContaining({ stage: "final", status: "success" }),
    ]));
    expect(jiexiAttempt).toBe(2);
  });
});
