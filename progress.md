# Progress

- 2026-03-09：新增 [spider_diag.rs](/d:/Development/Projects/Halo/src-tauri/src/spider_diag.rs) 与 [spider_diag.rs](/d:/Development/Projects/Halo/src-tauri/src/bin/spider_diag.rs)，支持单接口终端诊断。
- 2026-03-09：补充 [spider_cmds_profile.rs](/d:/Development/Projects/Halo/src-tauri/src/spider_cmds_profile.rs) 的 bridge 选择逻辑，使 profile 诊断优先使用 [bridge.new.jar](/d:/Development/Projects/Halo/src-tauri/spider-bridge/bridge.new.jar)。
- 2026-03-09：创建 [spider-diagnostics](/d:/Development/Projects/Halo/spider-diagnostics) 作为统一测试产物目录，并把报告分到 `reports/debug` 与 `reports/release`。
- 2026-03-09：新增 [run-source-tests.ps1](/d:/Development/Projects/Halo/spider-diagnostics/run-source-tests.ps1)，支持批量执行 `spider_diag`，提取 `report.json` 并生成汇总。
- 2026-03-09：完成 `iyouhun` 的 debug / release spot-check，确认 `AppRJ` 稳定可用，`Douban` 可用，`Hxq` 仅部分可用，`BiliYS` 仍失败。
- 2026-03-09：完成 `feimao` 的 debug / release 深测，确认 release 根入口存在“远端 wrapper 成功”和“bundled fallback 12 站点快照”两条不稳定分叉。
- 2026-03-09：扩展 [run-single-source-audit.ps1](/d:/Development/Projects/Halo/spider-diagnostics/run-single-source-audit.ps1)，新增根级 `summary.json` 和站点运行时元数据摘要。
- 2026-03-09：对 `http://fty.xxooo.cf/tv` 跑了 release 关键 Spider 家族深测，覆盖 `ConfigCenter/GuaZi/TTian/Jpys/Nox/Xdai/CzzyAmns/SaoHuo/Qiyou/XYQHiker/XBPQ/Jianpian/SP360/Hxq/YGP/Kugou/Bili`。
- 2026-03-09：对 `http://tvbox.xn--4kq62z5rby2qupq9ub.top/` 跑了 release 对照位点 `31/42/80`，确认与 `fty` 根是同源同故障。
- 2026-03-09：修改 [SpiderApi.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/crawler/SpiderApi.java)，改为反射读取 `Proxy.getHostPort()`，避免 legacy runtime 下的方法签名冲突。
- 2026-03-09：新增 [DialogInterface.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/android/content/DialogInterface.java) Android stub，并重编 [bridge.jar](/d:/Development/Projects/Halo/src-tauri/resources/jar/bridge.jar)。
- 2026-03-09：修改 [build_bridge.ps1](/d:/Development/Projects/Halo/src-tauri/spider-bridge/build_bridge.ps1)，构建后会自动同步 `bridge.jar` 到 `target/release/resources/jar`。
- 2026-03-09：复跑 `csp_Jianpian` / `csp_HxqAmns` / `csp_Bili`，确认 `Jianpian` 已越过 Android stub 缺口，`Hxq` 已越过 `Proxy.getHostPort()` 缺口。
- 2026-03-09：新增 [java_runtime.rs](/d:/Development/Projects/Halo/src-tauri/src/java_runtime.rs) 与 [sync_java_runtime.ps1](/d:/Development/Projects/Halo/src-tauri/scripts/sync_java_runtime.ps1)，把 Java runtime 打包进项目资源目录，release 运行不再依赖用户自装 Java。
- 2026-03-09：新增 [BaseSpiderAmns.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/spider/BaseSpiderAmns.java) bridge override，修复 `HxqAmns -> Hxq` delegate 初始化链路。
- 2026-03-09：新增 [AlertDialog.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/android/app/AlertDialog.java)、[Drawable.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/android/graphics/drawable/Drawable.java)、[ColorDrawable.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/android/graphics/drawable/ColorDrawable.java)，继续缩小 Android UI stub 缺口。
- 2026-03-09：修改 [h.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/spider/merge/b0/h.java)，兼容 `Jianpian` 把内联 JSON 作为 `ext` 传入的场景，避免再把 JSON 当 URL 请求。
- 2026-03-09：新增 [i.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/spider/merge/J/i.java)，并修改 [b.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/spider/merge/J/b.java)，把 `Jianpian` 的分类/影视项统一映射为标准 TVBox 字段。
- 2026-03-09：修改 [BridgeRunner.java](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/halo/spider/BridgeRunner.java)，让 `Jianpian` 优先加载新的 `merge.J.i` bridge override。
- 2026-03-09：生成新的 release 探测日志 [hxq-release-current-v4.log](/d:/Development/Projects/Halo/spider-diagnostics/probes/hxq-release-current-v4.log)、[jianpian-release-current-v6.log](/d:/Development/Projects/Halo/spider-diagnostics/probes/jianpian-release-current-v6.log)、[feimao-root-release-current-v4.log](/d:/Development/Projects/Halo/spider-diagnostics/probes/feimao-root-release-current-v4.log)。

---
*Last Updated: 2026-03-09 06:47 UTC*
