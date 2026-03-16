import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, invokeSpiderPlayerV2Mock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  invokeSpiderPlayerV2Mock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/modules/media/services/spiderV2", () => ({
  invokeSpiderPlayerV2: invokeSpiderPlayerV2Mock,
}));

import {
  clearSpiderPlayerPayloadCache,
  extractPlayerHeaders,
  getVodPlaybackDiagnostics,
  hasResolvablePlayerPayload,
  resolveEpisodePlayback,
} from "@/modules/media/services/vodPlayback";

describe("vodPlayback resolve", () => {
  beforeEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
    invokeSpiderPlayerV2Mock.mockReset();
    clearSpiderPlayerPayloadCache();
  });

  it("prefers a direct playable spider url even when parse flags are set", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://media.example.com/live/index.m3u8?token=1",
        parse: 1,
        jx: 1,
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

  it("keeps player headers when resolving through jiexi", async () => {
    invokeSpiderPlayerV2Mock.mockResolvedValue({
      normalizedPayload: {
        url: "https://page.example.com/watch?id=42",
        parse: 1,
        jx: 1,
        header: "{\"Referer\":\"https://page.example.com/detail/42\",\"User-Agent\":\"HaloParse/1.0\"}",
      },
    });
    invokeMock.mockResolvedValue("https://media.example.com/video.flv?token=abc");

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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "resolve_wrapped_media_url") {
        return playableUrl;
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
      skipProbe: false,
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "resolve_wrapped_media_url") {
        throw new Error("Wrapped media endpoint did not return a playable URL.");
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=abc";
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "resolve_wrapped_media_url") {
        return wrapperUrl;
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=from-jiexi";
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "resolve_wrapped_media_url") {
        return wrapperUrl;
      }
      if (command === "resolve_jiexi") {
        return "https://media.example.com/stream/index.m3u8?token=stable";
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
});
