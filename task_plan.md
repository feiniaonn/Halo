# Task Plan

## Goal
为单仓源点播接口建立独立的 Spider 深度诊断流程，并把测试产物集中放到项目根目录的独立文件夹中，避免污染业务目录。

## Phases
- [completed] 建立 `spider_diag` 终端诊断入口，支持 `source -> repo -> site -> spider/jar -> profile -> home/category`
- [completed] 补充 bridge/profile runner/Spider/JAR 诊断信息
- [completed] 创建根目录独立测试产物目录 `spider-diagnostics`
- [completed] 深测 `https://www.iyouhun.com/tv/dc-xs`
- [completed] 深测 `http://xn--z7x900a.com`
- [completed] 汇总失败模式、Spider/JAR 命中、可复现命令与报告索引
- [completed] 深测其余单仓根 `http://fty.xxooo.cf/tv` 与 `http://tvbox.xn--4kq62z5rby2qupq9ub.top/`
- [completed] 为 bridge 兼容层补 `SpiderApi` / `DialogInterface`，缩小 `Hxq` / `Jianpian` 的运行时缺口
- [completed] 修复 `HxqAmns` 的 `BaseSpiderAmns` delegate 初始化链路
- [completed] 修复 `Jianpian` 的 `merge.A / merge.J / merge.b0` 兼容链路，打通 release 下的分类与列表
- [completed] 让 bridge 构建脚本优先使用项目内 bundled Java runtime，不依赖系统 PATH

## Notes
- 诊断产物统一放在 [spider-diagnostics](/d:/Development/Projects/Halo/spider-diagnostics)。
- debug 与 release 报告分开放在 `reports/debug` 和 `reports/release`。
- 这轮重点不是直接修所有 Spider，而是先把“接口本身坏”“Spider/JAR 路由错”“helper 缺失”“根入口不稳定”拆开。
- `fty` 与 `tvbox` 别名根在当前 release 诊断里是同一套 `86` 站点 canonical 源。
- `spider-diagnostics/run-single-source-audit.ps1` 现在会额外生成根级 `summary.json`，包含 `apiClass` / `spider` 分布和 jar override 统计。
- 当前 `肥猫` release 根入口已稳定优先命中已知远端候选 `XC.json`，不再先落回 bundled 12 站点快照。
- 项目内 Java runtime 已同步到 [src-tauri/resources/java](/d:/Development/Projects/Halo/src-tauri/resources/java)，bridge 重编默认使用 bundled `javac.exe` / `jar.exe`。

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `TVBox config did not contain a sites array` when testing `dc-xs` root | 1 | 已识别为多仓入口，诊断工具新增 `urls` 分仓识别与 `--repo` 支持 |
| `SpiderProfileRunner` missing from runtime `bridge.jar` | 1 | 已确认 runtime `bridge.jar` 缺类，profile 诊断改由 `bridge.new.jar` 补齐 |
| PowerShell summary parsing kept producing false failures | 1 | 已修正脚本对当前 JSON 结构的读取方式，并避开 `$Profile` / `$HOME` 变量名冲突 |
| `feimao` root produced different site counts in debug and release | 1 | 已记录为核心发现：debug 这轮命中远端 `XC.json` 81 站点，release 这轮有一次直接回退到 bundled 12 站点快照 |
| `SpiderApi()` crashed on `Proxy.getHostPort()` for legacy runtimes | 1 | 已改成反射取值并回退到 `http://127.0.0.1:9966` |
| `csp_Jianpian` missed `android.content.DialogInterface$OnClickListener` | 1 | 已补 `DialogInterface` stub；现在前进到更深层的 `merge` 签名冲突 |
| `csp_Jianpian` treated inline filter JSON as a request URL | 1 | 已在 [merge.b0.h](/d:/Development/Projects/Halo/src-tauri/spider-bridge/src/com/github/catvod/spider/merge/b0/h.java) 兼容内联 JSON 响应，home/category 已通过 |
| `build_bridge.ps1` silently depended on system `javac/jar` | 1 | 已改成优先解析项目内 bundled Java toolchain，缺失时才提示同步 runtime |

---
*Last Updated: 2026-03-09 06:47 UTC*
