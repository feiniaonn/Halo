# Spider Diagnostics Summary (debug)

生成时间：2026-03-09

| Case | Result | Key Facts |
|------|--------|-----------|
| `iyouhun-root` | `OK` | 多仓入口，识别出 `6` 个分仓，首仓是 `https://9877.kstore.space/AnotherDS/movie.json` |
| `iyouhun-site-01-douban` | `OK` | `class=com.github.catvod.spider.Douban`，`target=desktop-compat-pack`，`jar=62286e18...desktop.v3.jar`，`compat=legacy-core, legacy-custom-spider, legacy-jsapi`，`home=7` 类，`category=50` 条 |
| `iyouhun-site-05-apprj` | `OK` | `class=com.github.catvod.spider.AppRJ`，`target=desktop-compat-pack`，`jar=62286e18...desktop.v3.jar`，`compat=legacy-custom-spider, legacy-jsapi`，`home=10` 类，`category=12` 条 |
| `iyouhun-site-08-hxq` | `PARTIAL` | `class=com.github.catvod.spider.Hxq`，`target=desktop-compat-pack`，`compat=legacy-core, legacy-custom-spider, legacy-jsapi`，`profile/home` 通过，但 `homeContent` 没产出分类，`categoryContent` 未继续执行 |
| `iyouhun-site-28-biliys` | `FAIL` | `class=com.github.catvod.spider.BiliYS`，`target=desktop-compat-pack`，失败类型 `NeedsCompatPack`，核心报错是 `Spider.safeDns()` 静态方法签名不匹配 |
| `feimao-root` | `OK` | 当前这轮 debug 命中 HTML wrapper 解析，成功跳到 `XC.json`，识别出 `81` 个站点，Spider 主包是 `Yoursmile.jar` |
| `feimao-site-02-douban` | `FAIL` | `class=com.github.catvod.spider.DouBan`，`target=desktop-compat-pack`，失败类型 `SiteRuntimeError`，核心报错是 `merge.zz.l.a is null` |
| `feimao-site-05-guazi` | `FAIL` | `class=com.github.catvod.spider.GuaZi`，`target=desktop-helper`，需要本地 helper 端口 `1072/9966`，失败类型 `NeedsLocalHelper` |
| `feimao-site-06-ttian` | `FAIL` | `class=com.github.catvod.spider.TTian`，`target=desktop-direct`，失败类型 `SiteRuntimeError`，核心报错是 `Cannot load from short array because "<parameter1>" is null` |
| `feimao-site-07-jpys` | `FAIL` | `class=com.github.catvod.spider.Jpys`，`target=desktop-direct`，失败类型 `Timeout`，`homeContent` 90 秒超时 |
| `feimao-site-18-czzy` | `FAIL` | `class=com.github.catvod.spider.CzzyAmns`，`target=desktop-direct`，失败类型 `SiteRuntimeError`，核心报错是 `BaseSpiderAmns` 内部代理对象为空 |
| `feimao-site-49-ygp` | `FAIL` | `class=com.github.catvod.spider.YGP`，`target=desktop-direct`，失败类型 `ResponseShapeError`，`homeContent` 返回结构既不是 `class` 也不是 `list` |

## Debug 侧共性结论

- `iyouhun` 的 AnotherDS 主包准备后统一落到 `62286e18d01bd0d6699afa37c921e38b30eee16a20dc6760bba713d5c52f58ec.desktop.v3.jar`。
- `feimao` 当前远端 `XC.json` 主包准备后统一落到 `a8774196dcf36524134fe2eea1c949c71eca4e0284d23be486b2c58bf8d796fe.desktop.v3.jar`。
- 自定义 `custom_spider.jar` 覆盖站点会落到独立准备包，比如 `CzzyAmns` 使用 `99cd5d3da1699132d39884ee0cebf605dcee4d311b0dfab37782978b0e356d58.desktop.v3.jar`。
- runtime 使用的 [bridge.jar](/d:/Development/Projects/Halo/src-tauri/resources/jar/bridge.jar) 仍然不含 `SpiderProfileRunner`；诊断阶段的 profile 由 [bridge.new.jar](/d:/Development/Projects/Halo/src-tauri/spider-bridge/bridge.new.jar) 补上。
