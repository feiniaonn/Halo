import { describe, expect, it } from "vitest";

import {
  buildEffectiveSiteParses,
  normalizeRepoUrls,
  normalizeTvBoxConfig,
  parseTvboxJsonLoose,
  serializeSiteExt,
} from "@/modules/media/services/tvboxConfig";

describe("tvboxConfig", () => {
  it("parses comment-prefixed json", () => {
    const parsed = parseTvboxJsonLoose("// comment\n{\"sites\":[{\"key\":\"a\",\"api\":\"csp_A\"}]}");
    expect(parsed).toMatchObject({
      sites: [{ key: "a", api: "csp_A" }],
    });
  });

  it("normalizes repo urls from wrapper config", () => {
    const urls = normalizeRepoUrls({
      urls: [
        { url: " https://example.com/a.json ", name: "A" },
        { url: "", name: "B" },
      ],
    });
    expect(urls).toEqual([{ url: "https://example.com/a.json", name: "A" }]);
  });

  it("normalizes site capabilities, parses and metadata", () => {
    const config = normalizeTvBoxConfig({
      spider: "https://example.com/spider.jar",
      logo: " https://example.com/logo.png ",
      wallpaper: "https://example.com/wall.jpg",
      parses: [
        {
          name: "默认解析",
          type: "1",
          url: "https://example.com/jx?url=",
          ext: "{\"flag\":[\"qq\"],\"header\":{\"Referer\":\"https://example.com\"}}",
        },
      ],
      sites: [
        {
          key: "cms",
          name: "CMS站点",
          type: 1,
          api: "https://cms.example.com/api.php",
          searchable: 1,
          quickSearch: 0,
          filterable: 1,
          ext: { token: "abc" },
          categories: ["电影", "剧集"],
          playUrl: "https://example.com/parse?url=",
          click: ".btn-play",
          playerType: "2",
        },
      ],
    });

    expect(config?.parses).toHaveLength(1);
    expect(config?.logo).toBe("https://example.com/logo.png");
    expect(config?.wallpaper).toBe("https://example.com/wall.jpg");
    expect(config?.sites[0].capability.sourceKind).toBe("cms");
    expect(config?.sites[0].capability.supportsDetail).toBe(true);
    expect(config?.sites[0].capability.mayNeedParse).toBe(true);
    expect(config?.sites[0].playUrl).toBe("https://example.com/parse?url=");
    expect(config?.sites[0].click).toBe(".btn-play");
    expect(config?.sites[0].playerType).toBe("2");
    expect(config?.sites[0].extValue).toBe("{\"token\":\"abc\"}");
  });

  it("serializes object ext values", () => {
    expect(serializeSiteExt({ a: 1, b: [2] })).toBe("{\"a\":1,\"b\":[2]}");
  });

  it("prepends site playUrl ahead of global parses", () => {
    const config = normalizeTvBoxConfig({
      sites: [
        {
          key: "cms",
          name: "CMS站点",
          type: 1,
          api: "https://cms.example.com/api.php",
          playUrl: "https://example.com/site-jx?url=",
        },
      ],
      parses: [
        { name: "全局解析", type: 0, url: "https://example.com/global-jx?url=" },
      ],
    });

    const ordered = buildEffectiveSiteParses(config!.sites[0], config!.parses);
    expect(ordered.map((item) => item.name)).toEqual(["CMS站点 站点解析", "全局解析"]);
  });

  it("normalizes root request and playback policy fields", () => {
    const config = normalizeTvBoxConfig({
      headers: [
        {
          host: "miguvideo.com",
          header: {
            "User-Agent": "okHttp/Mod-1.5.0.0",
            Referer: "https://app.example.com",
          },
        },
      ],
      rules: [
        {
          name: "量子去广告",
          hosts: ["lz", "example.com"],
          regex: ["#EXT-X-DISCONTINUITY\\n"],
          script: ["console.log('noop')"],
        },
      ],
      doh: [
        {
          name: "dnspod",
          url: "https://1.12.12.12/dns-query",
          ips: ["1.12.12.12", "120.53.53.53"],
        },
      ],
      proxy: ["googlevideo.com", "bfzycdn.com"],
      hosts: ["media.example.com=mirror.example.net"],
      ads: ["ads.example.net", "tracker.cdn.example"],
      sites: [
        {
          key: "cms",
          api: "https://cms.example.com/api.php",
        },
      ],
    });

    expect(config?.headers).toEqual([
      {
        host: "miguvideo.com",
        header: {
          "User-Agent": "okHttp/Mod-1.5.0.0",
          Referer: "https://app.example.com",
        },
      },
    ]);
    expect(config?.rules[0]).toMatchObject({
      name: "量子去广告",
      hosts: ["lz", "example.com"],
      regex: ["#EXT-X-DISCONTINUITY\\n"],
      script: ["console.log('noop')"],
    });
    expect(config?.doh).toEqual([
      {
        name: "dnspod",
        url: "https://1.12.12.12/dns-query",
        ips: ["1.12.12.12", "120.53.53.53"],
      },
    ]);
    expect(config?.proxy).toEqual(["googlevideo.com", "bfzycdn.com"]);
    expect(config?.hosts).toEqual([{ host: "media.example.com", target: "mirror.example.net" }]);
    expect(config?.ads).toEqual(["ads.example.net", "tracker.cdn.example"]);
  });
});
