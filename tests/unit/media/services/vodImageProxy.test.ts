import { describe, expect, it } from "vitest";

import {
  normalizeVodImageUrl,
  shouldPreferProxyImage,
} from "@/modules/media/services/vodImageProxy";

describe("vodImageProxy", () => {
  it("strips appended header directives from image urls", () => {
    const url =
      "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg@Referer=https://api.douban.com/@User-Agent=test-agent";

    expect(normalizeVodImageUrl(url)).toBe(
      "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg",
    );
  });

  it("still prefers proxy for hosts with appended header directives", () => {
    const url =
      "https://hqres.51touxiang.com/poster.jpg@Referer=https://www.51touxiang.com/";

    expect(shouldPreferProxyImage(url)).toBe(true);
  });

  it("does not force proxy-first for ordinary remote hosts", () => {
    expect(shouldPreferProxyImage("https://img.example.com/poster.jpg")).toBe(false);
  });

  it("prefers proxy-first for known tencent image hosts", () => {
    expect(shouldPreferProxyImage("https://puui.qpic.cn/vcover_vt_pic/0/example.jpg")).toBe(true);
    expect(shouldPreferProxyImage("https://vfiles.gtimg.cn/example.jpg")).toBe(true);
  });
});
