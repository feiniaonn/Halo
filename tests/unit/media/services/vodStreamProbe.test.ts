import { describe, expect, it } from "vitest";

import { inferVodStreamKind } from "@/modules/media/services/vodStreamProbe";

describe("vodStreamProbe", () => {
  it("infers obvious stream kinds from url", () => {
    expect(inferVodStreamKind("https://example.com/live/index.m3u8")).toBe("hls");
    expect(inferVodStreamKind("https://example.com/live/index.mpd")).toBe("dash");
    expect(inferVodStreamKind("https://example.com/file.flv?token=1")).toBe("flv");
    expect(inferVodStreamKind("https://example.com/live/index.ts")).toBe("mpegts");
    expect(inferVodStreamKind("https://example.com/video.mp4")).toBe("mp4");
    expect(inferVodStreamKind("https://example.com/play?id=123")).toBe("unknown");
  });
});
