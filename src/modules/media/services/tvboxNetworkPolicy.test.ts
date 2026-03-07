import { describe, expect, it } from "vitest";

import {
  applyHostMappingsToRequest,
  matchPlaybackRules,
  matchRequestHeaders,
  matchesTvBoxHostPattern,
  resolveRequestPolicy,
  shouldUseProxyForUrl,
} from "@/modules/media/services/tvboxNetworkPolicy";

describe("tvboxNetworkPolicy", () => {
  it("matches substring and wildcard host patterns", () => {
    expect(matchesTvBoxHostPattern("example.com", "https://cdn.example.com/video.m3u8")).toBe(true);
    expect(matchesTvBoxHostPattern(".*boku.*", "https://api.boku.run/live")).toBe(true);
  });

  it("merges matching request headers and host mapping", () => {
    const resolved = resolveRequestPolicy(
      "https://media.example.com/demo.m3u8",
      { Referer: "https://app.example.com" },
      [{ host: "example.com", header: { "User-Agent": "Halo" } }],
      [{ host: "media.example.com", target: "mirror.example.net" }],
    );

    expect(resolved.url).toBe("https://mirror.example.net/demo.m3u8");
    expect(resolved.headers).toMatchObject({
      Referer: "https://app.example.com",
      "User-Agent": "Halo",
      Host: "media.example.com",
    });
  });

  it("detects proxy domains and playback rules", () => {
    expect(shouldUseProxyForUrl(["googlevideo.com"], "https://rr1---sn.googlevideo.com/videoplayback")).toBe(true);
    expect(matchPlaybackRules([
      { name: "量子", hosts: ["lz"], regex: ["ad"], script: [] },
    ], "https://vip.lzcdn.example.com/master.m3u8")).toHaveLength(1);
  });

  it("can apply host mappings directly", () => {
    const resolved = applyHostMappingsToRequest(
      "https://origin.example.com/video.ts",
      null,
      [{ host: "origin.example.com", target: "edge.example.net" }],
    );
    expect(resolved.url).toBe("https://edge.example.net/video.ts");
    expect(resolved.headers).toMatchObject({ Host: "origin.example.com" });
  });

  it("matches request headers by host", () => {
    expect(matchRequestHeaders([
      { host: "miguvideo.com", header: { "User-Agent": "okHttp/Mod-1.5.0.0" } },
    ], "https://hlsztemgsplive.miguvideo.com/live/index.m3u8")).toMatchObject({
      "User-Agent": "okHttp/Mod-1.5.0.0",
    });
  });
});
