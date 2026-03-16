import { describe, expect, it } from "vitest";

import {
  buildEffectiveSiteParses,
  normalizeRepoUrls,
  normalizeTvBoxConfig,
  parseVodDetailResponse,
  parseTvboxJsonLoose,
  parseVodResponse,
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

  it("parses obfuscated merge payloads from spider runtimes", () => {
    const payload = JSON.stringify({
      a: [
        { a: "tv_hot", b: "热播剧集" },
      ],
      b: [
        { b: "sid-1", c: "第一部", d: "https://img.example.com/poster.jpg", e: "更新至10集" },
      ],
      c: {
        tv_hot: [
          { n: "综合", v: "tv_hot" },
        ],
      },
      k: 1,
      m: 99,
      n: 120,
    });

    expect(parseVodResponse(payload)).toEqual({
      class: [
        { type_id: "tv_hot", type_name: "热播剧集" },
      ],
      list: [
        {
          vod_id: "sid-1",
          vod_name: "第一部",
          vod_pic: "https://img.example.com/poster.jpg",
          vod_remarks: "更新至10集",
        },
      ],
      pagecount: 99,
      total: 120,
    });
  });

  it("extracts nested image objects and Hxq-style fallback remarks", () => {
    const payload = JSON.stringify({
      list: [
        {
          sid: "hxq-1",
          name: "韩圈片单",
          image: {
            url: "https://cdn.example.com/hxq.jpg",
          },
          conerMemo: "独播",
        },
      ],
    });

    expect(parseVodResponse(payload).list).toEqual([
      {
        vod_id: "hxq-1",
        vod_name: "韩圈片单",
        vod_pic: "https://cdn.example.com/hxq.jpg",
        vod_remarks: "独播",
      },
    ]);
  });

  it("parses douban-style nested home payload items", () => {
    const payload = JSON.stringify({
      class: ["anime_hot"],
      filters: {
        anime_hot: [
          { name: "动漫热播", value: "anime_hot" },
        ],
      },
      list: [
        {
          card_subtitle: "更新中",
          target: {
            id: "douban-1",
            title: "成何体统 第二季",
            pic: {
              normal: "http://t11.baidu.com/it/u=1,2&fm=58&app=83&f=JPEG?w=195&h=260",
            },
          },
        },
      ],
    });

    expect(parseVodResponse(payload)).toEqual({
      class: [
        { type_id: "anime_hot", type_name: "anime_hot" },
      ],
      list: [
        {
          vod_id: "douban-1",
          vod_name: "成何体统 第二季",
          vod_pic: "http://t11.baidu.com/it/u=1,2&fm=58&app=83&f=JPEG?w=195&h=260",
          vod_remarks: "更新中",
        },
      ],
      pagecount: undefined,
      total: undefined,
    });
  });

  it("normalizes obfuscated detail payloads", () => {
    const payload = JSON.stringify({
      b: [
        {
          b: "sid-9",
          c: "热播详情",
          d: "https://img.example.com/detail.jpg",
          vod_play_from: "默认线路",
          vod_play_url: "第1集$play-1",
          vod_content: "剧情简介",
        },
      ],
    });

    expect(parseVodDetailResponse(payload)).toEqual({
      list: [
        {
          vod_id: "sid-9",
          vod_name: "热播详情",
          vod_pic: "https://img.example.com/detail.jpg",
          vod_content: "剧情简介",
          vod_play_from: "默认线路",
          vod_play_url: "第1集$play-1",
        },
      ],
    });
  });

  it("unwraps data-wrapped spider payloads", () => {
    const payload = JSON.stringify({
      code: 1,
      msg: "",
      data: {
        class: [
          { type_id: "10", type_name: "内地" },
        ],
        list: [
          { vod_id: "1", vod_name: "热播片", vod_pic: "https://img.example.com/a.jpg" },
        ],
      },
    });

    expect(parseVodResponse(payload)).toEqual({
      class: [
        { type_id: "10", type_name: "内地" },
      ],
      list: [
        {
          vod_id: "1",
          vod_name: "热播片",
          vod_pic: "https://img.example.com/a.jpg",
          vod_remarks: "",
        },
      ],
      pagecount: undefined,
      total: undefined,
    });
  });

  it("treats data-wrapped app category lists as classes", () => {
    const payload = JSON.stringify({
      code: 1,
      msg: "",
      data: {
        list: [
          { type_id: "10", type_name: "内地" },
          { type_id: "1", type_name: "电影" },
        ],
      },
    });

    expect(parseVodResponse(payload)).toEqual({
      class: [
        { type_id: "10", type_name: "内地" },
        { type_id: "1", type_name: "电影" },
      ],
      list: [],
      pagecount: undefined,
      total: undefined,
    });
  });
});
