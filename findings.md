# Findings

- `https://www.iyouhun.com/tv/dc-xs` 根地址本身不是 `sites` 配置，而是 `urls` 多分仓入口；第一仓是 `https://9877.kstore.space/AnotherDS/movie.json`。
- `dc-xs -> movie.json -> csp_AppRJ` 当前实测链路稳定可用，debug 与 release 都能跑到分类和影视列表。
- `dc-xs -> csp_Douban` 目前也可用，但依赖 `legacy-core + legacy-custom-spider + legacy-jsapi`。
- `dc-xs -> csp_Hxq` 目前只通过了 `profile/home`，没有继续产出分类和影视列表。
- `dc-xs -> csp_BiliYS` 当前失败根因是 `Spider.safeDns()` 静态方法签名不兼容，不是纯粹网络超时。
- debug 这轮 `feimao` 根入口成功从 HTML wrapper 跳转到远端 `XC.json`，得到 `81` 个站点，Spider 主包是 `Yoursmile.jar`。
- release 这轮 `feimao` 根入口出现过“根抓取失败，直接走 bundled source fallback”的情况，最终只得到 `12` 个站点，Spider 链接变成了内置 `PandaQ260228.png` 对应的快照。
- 这意味着 `feimao` 的站点序号在正式版并不稳定，同一个 `site=5` 可能因为命中了不同根配置而对应完全不同的接口。
- `feimao` 当前失败模式可以明确归类：
  - `NeedsLocalHelper`：`GuaZi`、`ConfigCenter`
  - `SiteRuntimeError`：`DouBan`、`TTian`、`CzzyAmns`
  - `Timeout`：`Jpys`
  - `ResponseShapeError`：`YGP`
- runtime 使用的 [bridge.jar](/d:/Development/Projects/Halo/src-tauri/resources/jar/bridge.jar) 仍然不包含 `com/halo/spider/SpiderProfileRunner.class`，而 [bridge.new.jar](/d:/Development/Projects/Halo/src-tauri/spider-bridge/bridge.new.jar) 包含它。这是当前 debug / release 诊断差异里最明确的环境因素之一。
- `http://fty.xxooo.cf/tv` 与 `http://tvbox.xn--4kq62z5rby2qupq9ub.top/` 当前 release 根诊断完全一致：`86` 个站点、`60` 个唯一 `apiClass`、`12` 个 jar override，根 spider 都是 `Yoursmile.jar;md5;c6aaf6a9498e1e1d07126779c687bdd8`。
- `fty.xxooo.cf/tv` 的候选跳转里，`http://cdn.qiaoji8.com/tvbox.json` 是另一套 `35` 站点配置，`http://www.xn--sss604efuw.net/tv` 与 `gh-proxy` 的 `XC.json` 都回到同一套 `86` 站 canonical 源。
- `spider-diagnostics/run-single-source-audit.ps1` 现在会为根目录输出 `summary.json`，直接记录 `apiClassDistribution`、`spiderDistribution` 和 jar override 数量。
- `csp_XBPQ` 已经不再卡在 bridge 兼容缺口，`homeContent` 在 debug / release 都能稳定出分类；当前剩余问题是 `categoryContent` 超时。
- `csp_HxqAmns` 的 `BaseSpiderAmns` delegate 初始化已经修通，当前 release 日志显示 bridge override 能把 `HxqAmns -> Hxq` 正确接起来；后续如果仍空结果，已属于站点返回本身，不再是 delegate/NPE 级错误。
- `csp_Jianpian` 的 `merge.A / merge.J / merge.b0` 兼容链路已经在 release 下打通：`homeContent` 能返回 `6` 个分类和 `5` 组筛选，`categoryContent` 能返回 `15` 条影视列表。
- `csp_Jianpian` 的内联筛选 JSON 不是 URL，而是接口直接塞进 `ext` 的 JSON 文本；这也是之前 `merge.b0.h` 会把一大段 JSON 当 URL 去请求的根因。
- `merge.J.b` / `merge.J.i` 现在已经按桌面前端需要输出标准字段：分类侧是 `type_id/type_name`，影视列表侧是 `vod_id/vod_name/vod_pic/vod_remarks`。
- 当前 `fty` / `tvbox` 单仓代表站点里，`csp_SP360` 和 `csp_Kugou` 已经在 release 下完整通过 `home + category`。
- 当前明确仍需 helper 的站点族是：`csp_ConfigCenter`、`csp_GuaZi`、`csp_Bili`。
- `http://肥猫.com` 的 release 根入口目前已经稳定在“先命中已知远端候选 `XC.json` 再解析”的路径，当前探测是 `82` 个站点，不再先回到 bundled fallback 快照。
- `build_bridge.ps1` 现在会优先使用项目内 bundled Java runtime；后续重编 bridge 不再依赖系统 `PATH` 里的 `javac` / `jar`。

---
*Last Updated: 2026-03-09 06:47 UTC*
