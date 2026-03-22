export const vodPlaybackRegressionFixtures = {
  apprjLine2WrappedJiexiRecovery: {
    source: {
      document: "docs/日志.md",
      lineRange: "56-66",
      excerpt: [
        "[SpiderDaemon:Log] DEBUG: invokeMethod result value: [text chars=222]",
        "[Frontend Error] [VodPlayer] playback_resolve_failed route=线路二 (点击换线) episode=1 reason=episode playback resolve timeout (12000ms) diagnostics=none",
      ],
    },
    routeName: "线路二 (点击换线)",
    episode: {
      name: "1",
      url: "apprj-episode-1",
      searchOnly: false,
    },
    context: {
      sourceKey: "source-regression",
      repoUrl: "https://repo.example.com",
      sourceKind: "spider" as const,
      spiderUrl: "https://spider.example.com/app.jar",
      siteName: "AppRJ",
      siteKey: "apprj",
      apiClass: "csp_apprj",
      ext: "",
      parses: [
        { name: "主解析", type: 0, url: "https://jiexi-a.example.com/?url=" },
        { name: "兜底解析", type: 0, url: "https://jiexi-b.example.com/?url=" },
      ],
    },
    spiderPayload: {
      url: "http://43.248.100.143:9090/nby/m3u8/getM3u8?name=jx.91by.top&time=1&url=NBY-demo.m3u8",
      parse: 1,
      jx: 0,
      header: {
        Referer: "https://page.example.com/detail/1",
      },
    },
    wrappedResolution:
      "http://43.248.100.143:9090/nby/m3u8/getM3u8?name=jx.91by.top&time=1&url=NBY-demo.m3u8",
    jiexiResults: [
      "https://media.example.com/fake/index.m3u8?token=image",
      "https://media.example.com/final/index.m3u8?token=recovered",
    ],
  },
} as const;
