import { describe, expect, it } from "vitest";

import {
  buildNoUrlMessage,
  formatPlaybackTime,
  looksLikeDirectPlayableUrl,
  normalizeVodKernelMode,
  shouldUseSpiderParseChain,
} from "@/modules/media/services/vodPlayback";

describe("vodPlayback", () => {
  it("detects direct media urls", () => {
    expect(looksLikeDirectPlayableUrl("https://example.com/demo.m3u8")).toBe(true);
    expect(looksLikeDirectPlayableUrl("https://example.com/watch?id=123")).toBe(false);
    expect(
      looksLikeDirectPlayableUrl("http://example.com/api/get?url=wrapped-video.m3u8"),
    ).toBe(false);
    expect(
      looksLikeDirectPlayableUrl("http://wrapper.example.com/getM3u8?name=test&url=wrapped-video.m3u8"),
    ).toBe(false);
    expect(
      looksLikeDirectPlayableUrl("http://43.248.100.143:9090/nby/m3u8/getM3u8?name=jx.91by.top&time=1&url=NBY-demo.m3u8"),
    ).toBe(false);
    expect(
      looksLikeDirectPlayableUrl("http://example.com/api/get?type=m3u8&token=123"),
    ).toBe(true);
  });

  it("builds parse-aware no-url messages", () => {
    const withParseCandidates = buildNoUrlMessage({ parse: 1 }, "https://example.com/page", true);
    const withoutParseCandidates = buildNoUrlMessage({ parse: 1 }, "https://example.com/page", false);

    expect(withParseCandidates).toBeTruthy();
    expect(withoutParseCandidates).toBeTruthy();
    expect(withParseCandidates).not.toBe(withoutParseCandidates);
  });

  it("treats parse=1 as parse-required even when a direct-looking url is present", () => {
    expect(
      shouldUseSpiderParseChain(
        {
          parse: 1,
          jx: 0,
          url: "http://example.com/api/get?url=wrapped-video.m3u8",
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldUseSpiderParseChain(
        {
          parse: 1,
          jx: 1,
          url: "http://example.com/api/get?url=wrapped-video.m3u8",
        },
        true,
      ),
    ).toBe(true);
    expect(
      shouldUseSpiderParseChain(
        {
          parse: 1,
          jx: 0,
        },
        false,
      ),
    ).toBe(true);
  });

  it("formats playback time and kernel mode safely", () => {
    expect(formatPlaybackTime(3661)).toBe("01:01:01");
    expect(normalizeVodKernelMode("proxy")).toBe("proxy");
    expect(normalizeVodKernelMode("vlc")).toBe("direct");
    expect(normalizeVodKernelMode("mpv")).toBe("mpv");
    expect(normalizeVodKernelMode("unknown")).toBe("direct");
  });
});
