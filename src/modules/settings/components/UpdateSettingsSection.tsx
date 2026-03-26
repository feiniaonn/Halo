import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Download,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { UseUpdaterResult } from "@/modules/updater/hooks/useUpdater";

export function UpdateSettingsSection({ updater }: { updater: UseUpdaterResult }) {
  const statusText = (() => {
    if (updater.status.state === "idle") return "空闲";
    if (updater.status.state === "checking") return "正在检查更新...";
    if (updater.status.state === "available") {
      return updater.status.result.version
        ? "发现新版本 " + updater.status.result.version
        : "发现可用更新";
    }
    if (updater.status.state === "up_to_date") return "当前已是最新版本";
    if (updater.status.state === "downloading") {
      const { downloaded, total } = updater.status;
      if (total && total > 0) {
        const percent = Math.round((downloaded / total) * 100);
        const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        return "正在下载 " + percent + "% (" + downloadedMB + "/" + totalMB + " MB)";
      }
      return "正在下载安装包...";
    }
    if (updater.status.state === "downloaded") return "安装包已下载，正在启动安装器";
    if (updater.status.state === "installed") return "安装器已启动，当前应用即将退出完成更新";
    return "更新失败：" + updater.status.message;
  })();

  const statusTone = (() => {
    if (updater.status.state === "error") return "text-destructive";
    if (updater.status.state === "available") return "text-primary";
    if (updater.status.state === "downloaded" || updater.status.state === "installed") {
      return "text-emerald-600 dark:text-emerald-300";
    }
    return "text-muted-foreground";
  })();

  const endpointHealthText = (() => {
    if (updater.endpointHealth.state === "idle") return "未检测";
    if (updater.endpointHealth.state === "checking") return "检测中...";
    if (updater.endpointHealth.state === "ok") {
      const elapsed = updater.endpointHealth.result.elapsed_ms;
      return "可用" + (typeof elapsed === "number" ? " (" + elapsed + "ms)" : "");
    }
    return updater.endpointHealth.message ?? "不可用";
  })();

  const latestVersion =
    updater.status.state === "available"
      ? updater.status.result.version ?? updater.lastCheck?.version ?? null
      : updater.lastCheck?.version ?? null;

  const canDownload =
    updater.status.state !== "checking" &&
    updater.status.state !== "downloading" &&
    updater.status.state !== "downloaded" &&
    updater.status.state !== "installed";

  const showUpdateButton =
    updater.status.state === "available" ||
    updater.status.state === "idle" ||
    updater.status.state === "up_to_date" ||
    updater.status.state === "error";

  const showInstallerHint =
    updater.status.state === "downloaded" || updater.status.state === "installed";

  return (
    <div className="space-y-6">
      <Card className="rounded-[var(--radius-3xl)] border border-border bg-card/40 backdrop-blur-xl p-6 shadow-sm">
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                  版本更新
                </h2>
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                  检查应用的新版本并获取更新内容。
                </p>
              </div>

              <div
                className={cn(
                  "rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold shadow-sm",
                  statusTone,
                )}
              >
                {statusText}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <StatusCard
                icon={<Sparkles className="size-5" />}
                title="当前版本"
                value={updater.currentVersion}
                description="本地应用当前运行的版本号。"
              />
              <StatusCard
                icon={<ArrowUpRight className="size-5" />}
                title="最新版本"
                value={latestVersion ?? "--"}
                description="来自最近一次检查或当前可用更新。"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                className="h-11 rounded-xl shadow-sm"
                onClick={() => void updater.checkAndPrompt()}
                disabled={updater.status.state === "checking"}
              >
                <RefreshCw
                  className={cn(
                    "size-4 mr-2",
                    updater.status.state === "checking" && "animate-spin",
                  )}
                />
                {updater.status.state === "checking" ? "检查中..." : "检查更新"}
              </Button>

              {showUpdateButton && (
                <Button
                  className="h-11 rounded-xl shadow-sm"
                  onClick={() => void updater.downloadAndInstall()}
                  disabled={!canDownload}
                >
                  <Download className="size-4 mr-2" />
                  {updater.status.state === "downloading" ? "下载中..." : "下载并安装"}
                </Button>
              )}
            </div>

            {showInstallerHint && (
              <div className="rounded-xl border border-amber-500/22 bg-amber-500/10 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-amber-700 dark:text-amber-600">
                      安装器接管后将退出当前应用
                    </div>
                    <div className="text-[13px] leading-6 text-amber-700/85 dark:text-amber-600/85">
                      如果安装器窗口已经出现，请按安装向导完成更新，不需要再点“立即重启”。更新完成后从新的 Halo 图标启动即可。
                    </div>
                  </div>
                </div>
              </div>
            )}

            {updater.status.state === "available" && updater.status.result?.body && (
              <div className="rounded-xl border border-border bg-card/40 backdrop-blur-xl p-4 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/70">
                  Release Notes
                </div>
                <div className="mt-3 max-h-[260px] overflow-y-auto pr-2 text-[13px] leading-7 text-muted-foreground custom-scrollbar">
                  <pre className="whitespace-pre-wrap font-sans">{updater.status.result.body}</pre>
                </div>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-4">
            <div>
              <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
                更新源配置
              </h3>
              <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                使用完整地址配置更新源。
              </p>
            </div>

            <div className="space-y-3">
              <Input
                value={updater.endpoint}
                onChange={(event) => updater.setEndpoint(event.target.value)}
                placeholder="例如：http://192.168.1.120:1421/latest.json"
                className="h-12 rounded-xl font-mono text-sm bg-background border-border shadow-sm"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="text-muted-foreground">节点状态：</span>
                  <span
                    className={cn(
                      "font-semibold",
                      updater.endpointHealth.state === "ok" && "text-emerald-600 dark:text-emerald-300",
                      updater.endpointHealth.state === "error" && "text-destructive",
                      updater.endpointHealth.state !== "ok" &&
                        updater.endpointHealth.state !== "error" &&
                        "text-muted-foreground",
                    )}
                  >
                    {endpointHealthText}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="shadow-sm"
                    onClick={() => void updater.probeEndpoint()}
                  >
                    检测连接
                  </Button>
                  <Button size="sm" className="shadow-sm" onClick={() => void updater.saveEndpoint()}>
                    保存设置
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function StatusCard({
  icon,
  title,
  value,
  description,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-background text-primary shadow-sm">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-muted-foreground">{title}</div>
          <div className="mt-1 break-all text-[18px] font-semibold tracking-tight text-foreground">
            {value}
          </div>
          <div className="mt-2 text-[12px] leading-6 text-muted-foreground">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}


