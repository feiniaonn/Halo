import { beforeEach, describe, expect, it, vi } from "vitest";

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
  extractPlayerHeaders,
  getVodPlaybackDiagnostics,
  hasResolvablePlayerPayload,
  resolveEpisodePlayback,
} from "@/modules/media/services/vodPlayback";

function mockProbeResult(url: string, overrides: Partial<Record<"kind" | "reason" | "content_type" | "final_url", string | null>> = {}) {
  return {
    kind: url.includes(".m3u8") ? "hls" : "unknown",
    reason: null,
    content_type: url.includes(".m3u8") ? "application/vnd.apple.mpegurl" : null,
    final_url: url,
    ...overrides,
  };
}

let persistedPlaybackCache = new Map<string, string>();

describe("vodPlayback resolve", () => {
  beforeEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
    invokeSpiderPlayerV2Mock.mockReset();
    listVodParseRankingsMock.mockReset();
    recordVodParseSuccessMock.mockReset();
    clearSpiderPlayerPayloadCache();
    clearVodParseRankingCache();
    clearVodParseHealthCache();
    clearVodPlaybackResolutionCache();
    persistedPlaybackCache = new Map();
    listVodParseRankingsMock.mockResolvedValue([]);
    recordVodParseSuccessMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation(async (command: string, args?: { cacheKey?: string; payloadJson?: string; url?: string }) => {
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      if (command === "load_vod_playback_resolution_cache") {
        const payloadJson = persistedPlaybackCache.get(args?.cacheKey ?? "");
        if (!payloadJson) {
          return null;
        }
        return {
          payload_json: payloadJson,
          updated_at: Date.now(),
          expires_at: Date.now() + 60_000,
        };
      }
      if (command === "save_vod_playback_resolution_cache") {
        if (args?.cacheKey && args?.payloadJson) {
          persistedPlaybackCache.set(args.cacheKey, args.payloadJson);
        }
        return undefined;
      }
      if (command === "list_vod_parse_health_records") {
        return [];
      }
      if (command === "record_vod_parse_health_success" || command === "record_vod_parse_health_failure") {
        return undefined;
      }
      throw new Error(`unexpected invoke: ${command}`);
    });
  });

  it("prefers a direct playable spider url when parse flags are not set", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=1",
        parse: 0,
        jx: 0,
        header: {
          Referer: "https://page.example.com/watch/1",
          "User-Agent": "HaloTest/1.0",
        },
      },
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "retry-test",
      apiClass: "csp_RetryTest",
      ext: "",
    }, {
      name: "第1集",
      url: "retry-episode-id-1",
      searchOnly: false,
    }, "默认线路");

    expect(result).toEqual({
      url: "https://media.example.com/live/index.m3u8?token=1",
      headers: {
        Referer: "https://page.example.com/watch/1",
        "User-Agent": "HaloTest/1.0",
      },
      resolvedBy: "spider",
    });
    expect(getVodPlaybackDiagnostics(result)?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "spider_payload", status: "success" }),
        expect.objectContaining({ stage: "final", status: "success" }),
      ]),
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("honors parse=1 even when spider payload also carries a direct-looking url", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=direct-but-parse",
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/watch/2",
        },
      },
    });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        return "https://media.example.com/live/index.m3u8?token=direct-but-parse";
      }
      if (command === "resolve_jiexi") {
        return "https://jiexi.example.com/final/index.m3u8?token=parsed";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "parse-priority-test",
      apiClass: "csp_ParsePriorityTest",
      ext: "",
      playUrl: "https://jiexi.example.com/?url=",
    }, {
      name: "第1集",
      url: "parse-priority-episode-1",
      searchOnly: false,
    }, "默认线路");

    expect(invokeMock).toHaveBeenCalledWith("resolve_jiexi", expect.objectContaining({
      jiexiPrefix: "https://jiexi.example.com/?url=",
      videoUrl: "https://media.example.com/live/index.m3u8?token=direct-but-parse",
    }));
    expect(result).toEqual({
      url: "https://jiexi.example.com/final/index.m3u8?token=parsed",
      headers: {
        Referer: "https://page.example.com/watch/2",
      },
      resolvedBy: "jiexi",
    });
  });

  it("keeps player headers when resolving through jiexi", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://page.example.com/watch?id=42",
        parse: 1,
        jx: 1,
        header: "{\"Referer\":\"https://page.example.com/detail/42\",\"User-Agent\":\"HaloParse/1.0\"}",
      },
    });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not a wrapped media url");
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/video.flv?token=abc";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "cache-test",
      apiClass: "csp_CacheTest",
      ext: "",
      playUrl: "https://jiexi.example.com/?url=",
    }, {
      name: "第1集",
      url: "cache-episode-id-1",
      searchOnly: false,
    }, "默认线路");

    expect(invokeMock).toHaveBeenCalledWith("resolve_jiexi", expect.objectContaining({
      extraHeaders: expect.objectContaining({
        Referer: "https://page.example.com/detail/42",
        "User-Agent": "HaloParse/1.0",
      }),
    }));
    expect(result).toEqual({
      url: "https://media.example.com/video.flv?token=abc",
      headers: {
        Referer: "https://page.example.com/detail/42",
        "User-Agent": "HaloParse/1.0",
      },
      resolvedBy: "jiexi",
    });
  });

  it("normalizes player headers from multiple payload fields", () => {
    expect(extractPlayerHeaders({
      header: "{\"Referer\":\"https://page.example.com\"}",
      ua: "HaloUA/1.0",
    })).toEqual({
      Referer: "https://page.example.com",
      "User-Agent": "HaloUA/1.0",
    });
  });

  it("retries once when spider player payload is initially empty", async () => {
    vi.useFakeTimers();
    const wrapperUrl =
      "http://wrapper.example.com/getM3u8?name=test&url=wrapped-video.m3u8";
    const playableUrl = "https://media.example.com/live/index.m3u8?token=retry";
    invokeSpiderPlayerV2Mock
      .mockResolvedValueOnce({
        normalizedPayload: [],
      })
      .mockResolvedValueOnce({
        normalizedPayload: {
          url: wrapperUrl,
          parse: 1,
          jx: 0,
          header: {
            Referer: "https://page.example.com/detail/42",
          },
        },
      });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        return playableUrl;
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const playbackPromise = resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "test",
      apiClass: "csp_Test",
      ext: "",
    }, {
      name: "第一集",
      url: "episode-id-1",
      searchOnly: false,
    }, "默认线路");

    await vi.advanceTimersByTimeAsync(350);
    const result = await playbackPromise;

    expect(invokeSpiderPlayerV2Mock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      url: playableUrl,
      headers: {
        Referer: "https://page.example.com/detail/42",
      },
      resolvedBy: "spider",
    });
  });

  it("marks only payloads with url or parse flags as resolvable", () => {
    expect(hasResolvablePlayerPayload({})).toBe(false);
    expect(hasResolvablePlayerPayload({ parse: 1 })).toBe(true);
    expect(hasResolvablePlayerPayload({ jx: 1 })).toBe(true);
    expect(hasResolvablePlayerPayload({ url: " https://media.example.com/live/index.m3u8 " })).toBe(
      true,
    );
  });

  it("unwraps nested getM3u8 media targets before invoking wrapper or parse services", async () => {
    const wrapperUrl =
      "http://43.248.100.143:9090/nby/m3u8/getM3u8?name=jx.91by.top&time=1&url=https%3A%2F%2Fmedia.example.com%2Fstream%2Findex.m3u8%3Ftoken%3Dnested";
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: wrapperUrl,
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/nested",
        },
      },
    });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "nested-wrapper-test",
      apiClass: "csp_NestedWrapperTest",
      ext: "",
    }, {
      name: "episode 1",
      url: "episode-nested-wrapper-1",
      searchOnly: false,
    }, "default-route");

    expect(result).toEqual({
      url: "https://media.example.com/stream/index.m3u8?token=nested",
      headers: {
        Referer: "https://page.example.com/detail/nested",
      },
      resolvedBy: "spider",
    });
    expect(invokeMock.mock.calls.some(([command]) => command === "resolve_wrapped_media_url")).toBe(false);
    expect(invokeMock.mock.calls.some(([command]) => command === "resolve_jiexi")).toBe(false);
  });

  it("attaches diagnostics to playback resolution failures", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {},
    });

    try {
      await resolveEpisodePlayback({
        sourceKind: "spider",
        spiderUrl: "https://spider.example.com/app.jar",
        siteKey: "diag-failure",
        apiClass: "csp_DiagFailure",
        ext: "",
      }, {
        name: "第1集",
        url: "diag-episode-id-1",
        searchOnly: false,
      }, "默认线路");
      throw new Error("expected resolveEpisodePlayback to fail");
    } catch (error) {
      const diagnostics = getVodPlaybackDiagnostics(error);
      expect(diagnostics?.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stage: "spider_payload" }),
          expect.objectContaining({ stage: "final", status: "error" }),
        ]),
      );
    }
  });

  it("falls back to configured parse services when a wrapped spider url is not directly playable", async () => {
    const wrapperUrl =
      "http://wrapper.example.com/getM3u8?name=test&time=1&url=wrapped-video.m3u8";
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: wrapperUrl,
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/42",
        },
      },
    });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("Wrapped media endpoint did not return a playable URL.");
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=abc";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "test",
      apiClass: "csp_Test",
      ext: "",
      playUrl: "https://jiexi.example.com/?url=",
      parses: [
        {
          name: "聚合",
          type: 3,
          url: "Web",
        },
        {
          name: "线路解析",
          type: 0,
          url: "https://jiexi.example.com/?url=",
        },
      ],
    }, {
      name: "第1集",
      url: "episode-id-1",
      searchOnly: false,
    }, "默认线路");

    expect(invokeMock).toHaveBeenCalledWith("resolve_jiexi", expect.objectContaining({
      jiexiPrefix: "https://jiexi.example.com/?url=",
      videoUrl: wrapperUrl,
    }));
    expect(result).toEqual({
      url: "https://media.example.com/stream/index.m3u8?token=abc",
      headers: {
        Referer: "https://page.example.com/detail/42",
      },
      resolvedBy: "jiexi",
    });
  });

  it("prefers configured parse services when wrapped probing only confirms the same parse-required url", async () => {
    const wrapperUrl =
      "http://wrapper.example.com/getM3u8?name=test&time=1&url=wrapped-video.m3u8";
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: wrapperUrl,
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/42",
        },
      },
    });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        return wrapperUrl;
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=from-jiexi";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "test",
      apiClass: "csp_Test",
      ext: "",
      playUrl: "https://jiexi.example.com/?url=",
    }, {
      name: "第1集",
      url: "episode-id-1",
      searchOnly: false,
    }, "默认线路");

    expect(result).toEqual({
      url: "https://media.example.com/stream/index.m3u8?token=from-jiexi",
      headers: {
        Referer: "https://page.example.com/detail/42",
      },
      resolvedBy: "jiexi",
    });
  });

  it("reuses the last cached spider payload when a kernel switch gets an empty player response", async () => {
    const wrapperUrl =
      "http://wrapper.example.com/getM3u8?name=test&time=1&url=wrapped-video.m3u8";
    invokeSpiderPlayerV2Mock
      .mockResolvedValueOnce({
        normalizedPayload: {
          url: wrapperUrl,
          parse: 1,
          jx: 0,
          header: {
            Referer: "https://page.example.com/detail/42",
          },
        },
      })
      .mockResolvedValueOnce({
        normalizedPayload: [],
      });
    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        return wrapperUrl;
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=stable";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const context = {
      sourceKind: "spider" as const,
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "test",
      apiClass: "csp_Test",
      ext: "",
      playUrl: "https://jiexi.example.com/?url=",
    };
    const episode = {
      name: "第1集",
      url: "episode-id-1",
      searchOnly: false,
    };

    const first = await resolveEpisodePlayback(context, episode, "默认线路");
    const second = await resolveEpisodePlayback(context, episode, "默认线路");

    expect(invokeSpiderPlayerV2Mock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      url: "https://media.example.com/stream/index.m3u8?token=stable",
      headers: {
        Referer: "https://page.example.com/detail/42",
      },
      resolvedBy: "jiexi",
    });
    expect(second).toEqual(first);
  });

  it("keeps trying later HTTP parses before entering browser fallback", async () => {
    const commands: string[] = [];
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=needs-parse",
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/77",
        },
      },
    });

    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      commands.push(command);
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not wrapped");
      }
      if (command === "resolve_jiexi") {
        const count = commands.filter((entry) => entry === "resolve_jiexi").length;
        if (count === 1) {
          throw new Error("jiexi_needs_browser");
        }
        return "https://media.example.com/parsed/index.m3u8?token=second-http";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      if (command === "resolve_jiexi_webview") {
        throw new Error("browser fallback should not be reached");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "parse-order-test",
      apiClass: "csp_ParseOrderTest",
      ext: "",
      parses: [
        { name: "first", type: 0, url: "https://jiexi-a.example.com/?url=" },
        { name: "second", type: 0, url: "https://jiexi-b.example.com/?url=" },
      ],
    }, {
      name: "第一集",
      url: "episode-order-1",
      searchOnly: false,
    }, "默认线路");

    expect(commands.filter((entry) => entry === "resolve_jiexi")).toHaveLength(2);
    expect(commands).not.toContain("resolve_jiexi_webview");
    expect(result.url).toBe("https://media.example.com/parsed/index.m3u8?token=second-http");
    expect(result.resolvedBy).toBe("jiexi");
  });

  it("prioritizes remembered successful parsers for the same route", async () => {
    const jiexiPrefixes: string[] = [];
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://wrapper.example.com/watch?id=route-memory",
        parse: 1,
        jx: 0,
      },
    });
    listVodParseRankingsMock.mockResolvedValue([
      {
        parseUrl: "https://jiexi-b.example.com/?url=",
        successCount: 3,
        lastSuccessAt: 123456,
      },
    ]);

    invokeMock.mockImplementation(async (command: string, args?: { cacheKey?: string; jiexiPrefix?: string; payloadJson?: string; url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not wrapped");
      }
      if (command === "resolve_jiexi") {
        jiexiPrefixes.push(args?.jiexiPrefix ?? "");
        return "https://media.example.com/final/index.m3u8?token=memory";
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "");
      }
      if (command === "load_vod_playback_resolution_cache") {
        const payloadJson = persistedPlaybackCache.get(args?.cacheKey ?? "");
        if (!payloadJson) {
          return null;
        }
        return {
          payload_json: payloadJson,
          updated_at: Date.now(),
          expires_at: Date.now() + 60_000,
        };
      }
      if (command === "save_vod_playback_resolution_cache") {
        if (args?.cacheKey && args?.payloadJson) {
          persistedPlaybackCache.set(args.cacheKey, args.payloadJson);
        }
        return undefined;
      }
      if (command === "list_vod_parse_health_records") {
        return [];
      }
      if (command === "record_vod_parse_health_success" || command === "record_vod_parse_health_failure") {
        return undefined;
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKey: "source-a",
      repoUrl: "https://repo.example.com",
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "parse-memory-test",
      apiClass: "csp_ParseMemoryTest",
      ext: "",
      parses: [
        { name: "first", type: 0, url: "https://jiexi-a.example.com/?url=" },
        { name: "second", type: 0, url: "https://jiexi-b.example.com/?url=" },
      ],
    }, {
      name: "第1集",
      url: "episode-memory-1",
      searchOnly: false,
    }, "线路一");

    expect(result.url).toBe("https://media.example.com/final/index.m3u8?token=memory");
    expect(jiexiPrefixes[0]).toBe("https://jiexi-b.example.com/?url=");
    expect(recordVodParseSuccessMock).toHaveBeenCalledWith(
      "source-a",
      "https://repo.example.com",
      "parse-memory-test",
      "csp_ParseMemoryTest",
      "线路一",
      "https://jiexi-b.example.com/?url=",
    );
  });

  it("reuses inflight and cached playback resolution for the same episode", async () => {
    let releasePayload: ((value: { normalizedPayload: Record<string, unknown> }) => void) | null = null;
    invokeSpiderPlayerV2Mock.mockImplementation(() => new Promise((resolve) => {
      releasePayload = resolve;
    }));

    const context = {
      sourceKey: "source-cache",
      repoUrl: "https://repo.example.com",
      sourceKind: "spider" as const,
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "shared-cache-test",
      apiClass: "csp_SharedCache",
      ext: "",
    };
    const episode = {
      name: "绗?闆?",
      url: "episode-shared-cache-1",
      searchOnly: false,
    };

    const first = resolveEpisodePlayback(context, episode, "榛樿绾胯矾");
    const second = resolveEpisodePlayback(context, episode, "榛樿绾胯矾");

    await vi.waitFor(() => {
      expect(invokeSpiderPlayerV2Mock).toHaveBeenCalledTimes(1);
    });

    releasePayload?.({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=shared-cache",
        parse: 0,
        jx: 0,
      },
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    const thirdResult = await resolveEpisodePlayback(context, episode, "榛樿绾胯矾");

    expect(invokeSpiderPlayerV2Mock).toHaveBeenCalledTimes(1);
    expect(firstResult.url).toBe("https://media.example.com/live/index.m3u8?token=shared-cache");
    expect(secondResult.url).toBe(firstResult.url);
    expect(thirdResult.url).toBe(firstResult.url);
  });

  it("restores persisted playback resolution without rerunning spider resolution", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=persisted",
        parse: 0,
        jx: 0,
      },
    });

    const context = {
      sourceKey: "source-persisted",
      repoUrl: "https://repo.example.com",
      sourceKind: "spider" as const,
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "persisted-cache-test",
      apiClass: "csp_PersistedCache",
      ext: "",
    };
    const episode = {
      name: "第 1 集",
      url: "episode-persisted-1",
      searchOnly: false,
    };

    const first = await resolveEpisodePlayback(context, episode, "默认线路");
    const firstDiagnostics = getVodPlaybackDiagnostics(first);

    clearSpiderPlayerPayloadCache();
    clearVodPlaybackResolutionCache();

    const second = await resolveEpisodePlayback(context, episode, "默认线路");
    const secondDiagnostics = getVodPlaybackDiagnostics(second);

    expect(invokeSpiderPlayerV2Mock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "save_vod_playback_resolution_cache")).toBe(true);
    expect(invokeMock.mock.calls.some(([command]) => command === "load_vod_playback_resolution_cache")).toBe(true);
    expect(second).toEqual({
      url: "https://media.example.com/live/index.m3u8?token=persisted",
      headers: null,
      resolvedBy: "spider",
    });
    expect(firstDiagnostics?.startedAt).toEqual(expect.any(Number));
    expect(secondDiagnostics?.startedAt).toBe(firstDiagnostics?.startedAt);
  });

  it("uses a bounded probe timeout when validating parsed hls candidates", async () => {
    const probeTimeouts: number[] = [];
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://wrapper.example.com/watch?id=probe-budget",
        parse: 1,
        jx: 0,
      },
    });

    invokeMock.mockImplementation(async (command: string, args?: { url?: string; timeoutMs?: number }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not wrapped");
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/final/index.m3u8?token=probe-budget";
      }
      if (command === "probe_stream_kind") {
        probeTimeouts.push(args?.timeoutMs ?? -1);
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "probe-budget-test",
      apiClass: "csp_ProbeBudgetTest",
      ext: "",
      parses: [
        { name: "first", type: 0, url: "https://jiexi-a.example.com/?url=" },
      ],
    }, {
      name: "绗?闆?",
      url: "episode-probe-budget-1",
      searchOnly: false,
    }, "榛樿绾胯矾");

    expect(result.url).toBe("https://media.example.com/final/index.m3u8?token=probe-budget");
    expect(probeTimeouts.some((value) => value > 0 && value <= 1400)).toBe(true);
  });

  it("rejects fake HLS parse results and continues to the next parser", async () => {
    const fakeHlsUrl = "https://media.example.com/fake/index.m3u8?token=image";
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: fakeHlsUrl,
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/88",
        },
      },
    });

    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not wrapped");
      }
      if (command === "resolve_jiexi") {
        const count = invokeMock.mock.calls.filter(([name]) => name === "resolve_jiexi").length;
        if (count === 1) {
          return fakeHlsUrl;
        }
        return "https://media.example.com/final/index.m3u8?token=clean";
      }
      if (command === "probe_stream_kind") {
        if ((args?.url ?? "").includes("token=image")) {
          return mockProbeResult(args?.url ?? "", {
            kind: "unknown",
            reason: "stream_probe_hls_image_manifest",
          });
        }
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "fake-hls-test",
      apiClass: "csp_FakeHlsTest",
      ext: "",
      parses: [
        { name: "first", type: 0, url: "https://jiexi-a.example.com/?url=" },
        { name: "second", type: 0, url: "https://jiexi-b.example.com/?url=" },
      ],
    }, {
      name: "第一集",
      url: "episode-fake-1",
      searchOnly: false,
    }, "默认线路");

    expect(result.url).toBe("https://media.example.com/final/index.m3u8?token=clean");
    expect(result.resolvedBy).toBe("jiexi");
  });

  it("sanitizes malformed parse urls before probing and playback handoff", async () => {
    const cleanUrl = "http://beyond.example.com/2026-03-22/play.m3u8?ts=1774177202-0-0-token";
    const dirtyUrl = `${cleanUrl}%22%20width=%22100%%22%20height=%22100%%22%3E%3C/iframe%3E%3Cscript%3Efunction%20SUIYI(url)%20{%20%20%20%20$(%27`;
    const probeUrls: string[] = [];

    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://page.example.com/detail/dirty-parse",
        parse: 1,
        jx: 0,
        header: {
          Referer: "https://page.example.com/detail/dirty-parse",
        },
      },
    });

    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("not wrapped");
      }
      if (command === "resolve_jiexi") {
        return dirtyUrl;
      }
      if (command === "probe_stream_kind") {
        probeUrls.push(args?.url ?? "");
        return mockProbeResult(args?.url ?? "");
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    const result = await resolveEpisodePlayback({
      sourceKind: "spider",
      spiderUrl: "https://spider.example.com/app.jar",
      siteKey: "dirty-parse-test",
      apiClass: "csp_DirtyParseTest",
      ext: "",
      parses: [
        { name: "cleaner", type: 0, url: "https://jiexi.example.com/?url=" },
      ],
    }, {
      name: "绗竴闆?",
      url: "episode-dirty-1",
      searchOnly: false,
    }, "榛樿绾胯矾");

    expect(result.url).toBe(cleanUrl);
    expect(result.resolvedBy).toBe("jiexi");
    expect(probeUrls).toContain(cleanUrl);
    expect(probeUrls.some((url) => url.includes("iframe") || url.includes("SUIYI"))).toBe(false);
  });

  it("treats getM3u8 wrapper endpoints as unresolved parse targets", async () => {
    const wrapperUrl =
      "http://43.248.100.143:9090/nby/m3u8/getM3u8?name=jx.91by.top&time=1&url=NBY-demo.m3u8";
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: wrapperUrl,
        parse: 1,
        jx: 0,
      },
    });

    invokeMock.mockImplementation(async (command: string, args?: { url?: string }) => {
      if (command === "resolve_wrapped_media_url") {
        return wrapperUrl;
      }
      if (command === "resolve_jiexi") {
        throw new Error("wrapper parse failed");
      }
      if (command === "resolve_jiexi_webview") {
        throw new Error("browser parse failed");
      }
      if (command === "probe_stream_kind") {
        return mockProbeResult(args?.url ?? "", {
          kind: "hls",
          reason: "stream_probe_hls_manifest_unreadable",
          content_type: "text/plain;charset=UTF-8",
        });
      }
      throw new Error(`unexpected invoke: ${command}`);
    });

    await expect(
      resolveEpisodePlayback({
        sourceKind: "spider",
        spiderUrl: "https://spider.example.com/app.jar",
        siteKey: "wrapper-parse-test",
        apiClass: "csp_WrapperParseTest",
        ext: "",
      }, {
        name: "第一集",
        url: "episode-wrapper-1",
        searchOnly: false,
      }, "默认线路"),
    ).rejects.toThrow(/真正的视频地址|解析页|直链/i);
  });
});
