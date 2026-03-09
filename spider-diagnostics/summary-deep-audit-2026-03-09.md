# Single Source Deep Audit (2026-03-09)

## Scope

- Continued automated deep testing for the remaining single-source roots:
  - `http://fty.xxooo.cf/tv`
  - `http://tvbox.xn--4kq62z5rby2qupq9ub.top/`
- Rebuilt bridge runtime and re-ran targeted site diagnostics after compatibility patches.
- Extended audit outputs with root-level `apiClass` / `spider` distribution and per-site runtime routing metadata.

## Root Conclusions

| Root | Result | Sites | Unique apiClass | Jar Overrides | Spider |
|------|--------|-------|-----------------|---------------|--------|
| `http://fty.xxooo.cf/tv` | OK | 81 | 60 | 12 | `Yoursmile.jar;md5;c6aaf6a9498e1e1d07126779c687bdd8` |
| `http://tvbox.xn--4kq62z5rby2qupq9ub.top/` | OK | 86 | 60 | 12 | `Yoursmile.jar;md5;c6aaf6a9498e1e1d07126779c687bdd8` |

Conclusion:
- These two single-source roots are currently the same canonical source set.
- Release diagnostics on identical site ids (`31`, `42`, `80`) produced the same failure classes and routing metadata.

Root inventory files:
- `reports/release/single-source-audit/fty-xxooo-cf-tv/root/summary.json`
- `reports/release/single-source-audit/tvbox-xn-4kq62z5rby2qupq9ub-top/root/summary.json`

## Candidate Link Results (`fty.xxooo.cf/tv`)

| Candidate | Result |
|-----------|--------|
| `http://cdn.qiaoji8.com/tvbox.json` | Parses, `35` sites, different spider `fix260214.jar` |
| `https://gh-proxy.net/https://raw.githubusercontent.com/yoursmile66/TVBox/refs/heads/main/XC.json` | Parses, `86` sites, same canonical spider |
| `http://www.xn--sss604efuw.net/tv` | Parses, `86` sites, same canonical spider |
| `https://gitee.com/xxoooo/fan/raw/master/in.bmp` | Probe only, did not yield a TVBox config in this round |

Candidate evidence:
- `reports/debug/single-source-audit/fty-xxooo-cf-tv/candidate-cdn-qiaoji8-com-tvbox-json`
- `reports/debug/single-source-audit/fty-xxooo-cf-tv/candidate-gh-proxy-net-https-raw-githubusercontent-com-yoursmile66-tvbox-refs-heads-main-xc-json`
- `reports/debug/single-source-audit/fty-xxooo-cf-tv/candidate-www-xn-sss604efuw-net-tv`
- `reports/debug/single-source-audit/fty-xxooo-cf-tv/candidate-gitee-com-xxoooo-fan-raw-master-in-bmp`

## Targeted Site Matrix

Release re-test on `fty.xxooo.cf/tv`:

| Site | apiClass | Result | Notes |
|------|----------|--------|-------|
| `26 永乐` | `csp_XBPQ` | Home OK, Category timeout | Bridge compatibility patch works; category still slow |
| `39 SP360` | `csp_SP360` | Home OK, Category OK | Fully usable in current desktop runtime |
| `55 Kugou` | `csp_Kugou` | Home OK, Category OK | Fully usable in current desktop runtime |
| `4 ConfigCenter` | `csp_ConfigCenter` | NeedsLocalHelper | Helper-dependent path |
| `5 GuaZi` | `csp_GuaZi` | NeedsLocalHelper | Helper-dependent path |
| `80 哔哩` | `csp_Bili` | NeedsLocalHelper | Helper-dependent path |
| `42 Hxq` | `csp_HxqAmns` | Home OK | `BaseSpiderAmns` delegate 已修到 `Hxq` 本体；当前返回为空结果而非 delegate/NPE 级错误 |
| `31 Jianpian` | `csp_Jianpian` | Home OK, Category OK | `merge.A / merge.J / merge.b0` 兼容已打通，release 下能出分类和 `15` 条列表 |
| `24 剧圈圈` | `csp_XYQHiker` | NativeMethodBlocked | Still blocked by native/runtime expectations |
| `6 TTian` | `csp_TTian` | SiteRuntimeError | Runtime null data inside site logic |
| `7 Jpys` | `csp_Jpys` | Timeout | Still hangs in current runtime |
| `12 驿站` | `csp_Xdai` | ResponseShapeError | Returned structure does not satisfy desktop response checks |

Representative report files:
- `reports/release/single-source-audit/fty-xxooo-cf-tv/26-csp-xbpq/summary.json`
- `reports/release/single-source-audit/fty-xxooo-cf-tv/39-csp-sp360/summary.json`
- `reports/release/single-source-audit/fty-xxooo-cf-tv/55-csp-kugou/summary.json`
- `reports/release/single-source-audit/fty-xxooo-cf-tv/31-csp-jianpian/report.json`
- `reports/release/single-source-audit/fty-xxooo-cf-tv/42-csp-hxqamns/report.json`
- `reports/release/single-source-audit/fty-xxooo-cf-tv/80-csp-bili/report.json`

## Bridge / Spider Runtime Changes Applied

### 1. SpiderApi host port lookup

File:
- `src-tauri/spider-bridge/src/com/github/catvod/crawler/SpiderApi.java`

Change:
- `SpiderApi()` no longer hard-links to `Proxy.getHostPort()`.
- It now reflects `com.github.catvod.spider.Proxy` at runtime and falls back to `http://127.0.0.1:9966`.

Effect:
- Fixed the `NoSuchMethodError: Proxy.getHostPort()` failure that was still breaking `Hxq` compat execution.

### 2. Android UI stubs

File:
- `src-tauri/spider-bridge/src/android/content/DialogInterface.java`
- `src-tauri/spider-bridge/src/android/app/AlertDialog.java`
- `src-tauri/spider-bridge/src/android/graphics/drawable/Drawable.java`
- `src-tauri/spider-bridge/src/android/graphics/drawable/ColorDrawable.java`

Change:
- Added minimal `DialogInterface`, `AlertDialog`, `Drawable`, and `ColorDrawable` shims.

Effect:
- Cleared the previous missing-class cascade in `Jianpian` far enough that `invokeGlobalInit` no longer blocks `home/category`.

### 3. Jianpian merge/runtime compatibility

Files:
- `src-tauri/spider-bridge/src/com/github/catvod/spider/merge/b0/h.java`
- `src-tauri/spider-bridge/src/com/github/catvod/spider/merge/J/b.java`
- `src-tauri/spider-bridge/src/com/github/catvod/spider/merge/J/i.java`
- `src-tauri/spider-bridge/src/com/halo/spider/BridgeRunner.java`

Change:
- `merge.b0.h` now detects inline JSON payloads and returns them directly instead of treating them as request URLs.
- `merge.J.b` now emits standard category fields `type_id/type_name`.
- `merge.J.i` now emits standard TVBox item/detail fields such as `vod_id/vod_name/vod_pic/vod_remarks/vod_play_from/vod_play_url`.
- `BridgeRunner` now prefers the bridge-side `merge.J.i` override for `Jianpian`.

Effect:
- `csp_Jianpian` now passes `homeContent` and `categoryContent` in release mode.
- Latest probe shows `6` categories, `5` filter groups, first category `电影`, and `15` list items.

### 4. Audit output enrichment

File:
- `spider-diagnostics/run-single-source-audit.ps1`

Change:
- Root summaries now include `uniqueApiClassCount`, `jarOverrideCount`, `apiClassDistribution`, and `spiderDistribution`.
- Site summaries now include `artifactKind`, `requiredRuntime`, `executionTarget`, `missingDependency`, `requiredCompatPacks`, `helperPorts`, and `routingReason`.

Effect:
- Spider/JAR routing can now be read directly from `summary.json` without opening the full `report.json`.

## Current State

Resolved in this round:
- `XBPQ` no longer dies on missing `SpiderApi` / legacy spider base classes; `homeContent` is now stable.
- `Hxq` no longer dies on bridge-level `Proxy.getHostPort()` incompatibility or `BaseSpiderAmns` delegate init.
- `Jianpian` no longer dies on missing Android stub classes or `merge` constructor/signature mismatches.
- `fty` and `tvbox` alias roots are confirmed to be the same source tree in current release diagnostics.
- `肥猫` release 根入口已经稳定为“已知远端候选 -> `XC.json`”链路，当前探测为 `82` 站点。

Still unresolved:
- `Hxq`: 当前 `homeContent` 返回空壳对象，属于站点返回/业务语义问题，不再是 bridge/runtime 级兼容错误。
- `Jianpian`: `invokeGlobalInit` 仍会打出 runtime 内部空指针噪音，但不再阻断 `home/category`。
- `Bili`, `ConfigCenter`, `GuaZi`: still depend on local helper flow.
- `Jpys`, `SaoHuo`, `XBPQ` category: still timeout-prone.

## Suggested Next Step

The next efficient move is not broad jar hunting.

Focus on:
1. `Hxq`:
   - inspect why the site returns an empty payload after delegate handoff
   - determine whether it now requires helper/bootstrap data rather than bridge fixes
2. `Jianpian`:
   - optionally tame `invokeGlobalInit` log noise if it starts masking other failures
   - verify detail/play payload semantics in the actual UI, not just `home/category` diagnostics
