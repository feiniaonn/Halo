# Spider Diagnostics

这个目录专门存放点播单接口 Spider 深测脚本、终端原始日志、结构化 JSON 报告和人工整理后的汇总文档，避免继续污染项目根目录和业务目录。

## 目录结构

- [run-source-tests.ps1](/d:/Development/Projects/Halo/spider-diagnostics/run-source-tests.ps1)
  用于批量执行 `spider_diag`，支持 `debug` / `release` 两种构建档位，并把测试结果落到对应子目录。
- [summary-2026-03-09.md](/d:/Development/Projects/Halo/spider-diagnostics/summary-2026-03-09.md)
  当前这轮人工整理后的总汇，包含关键 Spider/JAR 命中信息和失败样式。
- [summary-debug-2026-03-09.md](/d:/Development/Projects/Halo/spider-diagnostics/summary-debug-2026-03-09.md)
  批量脚本生成的 debug 汇总。
- [summary-release-2026-03-09.md](/d:/Development/Projects/Halo/spider-diagnostics/summary-release-2026-03-09.md)
  批量脚本生成的 release 汇总。
- `reports/debug/<case>/raw.log`
  debug 诊断的完整终端输出。
- `reports/debug/<case>/report.json`
  从 `raw.log` 中提取出的结构化诊断结果。
- `reports/debug/<case>/parse-error.log`
  如果提取失败，会记录解析原因。
- `reports/release/<case>/raw.log`
  release 诊断的完整终端输出。
- `reports/release/<case>/report.json`
  release 结构化诊断结果。

## 当前覆盖用例

- `iyouhun-root`
- `iyouhun-site-01-douban`
- `iyouhun-site-05-apprj`
- `iyouhun-site-08-hxq`
- `iyouhun-site-28-biliys`
- `feimao-root`
- `feimao-site-02-douban`
- `feimao-site-05-guazi`
- `feimao-site-06-ttian`
- `feimao-site-07-jpys`
- `feimao-site-18-czzy`
- `feimao-site-49-ygp`

## 用法

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File spider-diagnostics\run-source-tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File spider-diagnostics\run-source-tests.ps1 -Profile release
powershell -NoProfile -ExecutionPolicy Bypass -File spider-diagnostics\run-source-tests.ps1 -Profile release -CaseIds iyouhun-site-05-apprj,feimao-site-05-guazi,feimao-site-06-ttian
```
