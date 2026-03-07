import { describe, expect, it } from "vitest";

import {
  buildNoUrlMessage,
  formatPlaybackTime,
  looksLikeDirectPlayableUrl,
  normalizeVodKernelMode,
} from "@/modules/media/services/vodPlayback";

describe("vodPlayback", () => {
  it("detects direct media urls", () => {
    expect(looksLikeDirectPlayableUrl("https://example.com/demo.m3u8")).toBe(true);
    expect(looksLikeDirectPlayableUrl("https://example.com/watch?id=123")).toBe(false);
  });

  it("builds parse-aware no-url messages", () => {
    expect(buildNoUrlMessage({ parse: 1 }, "https://example.com/page", true)).toContain("外部解析");
    expect(buildNoUrlMessage({ parse: 1 }, "https://example.com/page", false)).toContain("没有可用解析器");
  });

  it("formats playback time and kernel mode safely", () => {
    expect(formatPlaybackTime(3661)).toBe("01:01:01");
    expect(normalizeVodKernelMode("proxy")).toBe("proxy");
    expect(normalizeVodKernelMode("unknown")).toBe("mpv");
  });
});
