import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Download,
  RefreshCw,
  Server,
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
        ? `发现新版本 ${updater.status.result.version}`
        : "发现可用更新";
    }
    if (updater.status.state === "up_to_date") return "当前已是最新版本";
    if (updater.status.state === "downloading") {
      const { downloaded, total } = updater.status;
      if (total && total > 0) {
        const percent = Math.round((downloaded / total) * 100);
        const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        return `正在下载 ${percent}% (${downloadedMB}/${totalMB} MB)`;
      }
      return "正在下载安装包...";
    }
    if (updater.status.state === "downloaded") return "安装包已下载，正在启动安装器";
    if (updater.status.state === "installed") return "安装器已启动，当前应用即将退出完成更新";
    return `更新失败：${updater.status.message}`;
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
      return `可用${typeof elapsed === "number" ? ` (${elapsed}ms)` : ""}`;
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
      <Card className="glass-card border-none rounded-[30px] p-6 shadow-[0_24px_76px_-50px_rgba(var(--primary),0.42)]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary/70">
              Updates
            </div>
            <h2 className="text-[26px] font-black tracking-tight text-foreground/92">
              应用版本与更新
            </h2>
            <p className="max-w-3xl text-[14px] leading-7 text-muted-foreground/84">
              更新流程现在按 Windows 安装器模式执行。下载完成后会启动安装器并退出当前应用，不再额外手动重启旧进程。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <MetricPill label="当前版本" value={updater.currentVersion} />
            <MetricPill label="最新版本" value={latestVersion ?? "--"} />
            <MetricPill label="更新源状态" value={endpointHealthText} />
          </div>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <Card className="glass-card border-none rounded-[30px] p-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-primary/70">
                  Update Center
                </div>
                <h3 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">
                  更新状态
                </h3>
              </div>

              <div
                className={cn(
                  "rounded-full border border-white/10 bg-white/36 px-3 py-1.5 text-xs font-semibold",
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                className="h-11 rounded-2xl"
                onClick={() => void updater.checkAndPrompt()}
                disabled={updater.status.state === "checking"}
              >
                <RefreshCw
                  className={cn(
                    "size-4",
                    updater.status.state === "checking" && "animate-spin",
                  )}
                />
                {updater.status.state === "checking" ? "检查中..." : "检查更新"}
              </Button>

              {showUpdateButton && (
                <Button
                  className="h-11 rounded-2xl"
                  onClick={() => void updater.downloadAndInstall()}
                  disabled={!canDownload}
                >
                  <Download className="size-4" />
                  {updater.status.state === "downloading" ? "下载中..." : "下载并安装"}
                </Button>
              )}
            </div>

            {showInstallerHint && (
              <div className="rounded-[24px] border border-amber-500/22 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" />
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                      安装器接管后将退出当前应用
                    </div>
                    <div className="text-[13px] leading-6 text-amber-700/85 dark:text-amber-200/85">
                      如果安装器窗口已经出现，请按安装向导完成更新，不需要再点“立即重启”。更新完成后从新的 Halo 图标启动即可。
                    </div>
                  </div>
                </div>
              </div>
            )}

            {updater.status.state === "available" && updater.status.result?.body && (
              <div className="rounded-[24px] border border-white/10 bg-background/72 p-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/70">
                  Release Notes
                </div>
                <div className="mt-3 max-h-[260px] overflow-y-auto pr-2 text-[13px] leading-7 text-muted-foreground/82 custom-scrollbar">
                  <pre className="whitespace-pre-wrap font-sans">{updater.status.result.body}</pre>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="glass-card border-none rounded-[30px] p-5">
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-primary/70">
                Endpoint
              </div>
              <h3 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">
                更新源配置
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-muted-foreground/82">
                使用完整地址配置更新源。地址较长时会完整显示，不会被隐藏或裁切。
              </p>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(150deg,rgba(255,255,255,0.76),rgba(var(--primary),0.05))] p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-primary/10 text-primary">
                  <Server className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">当前更新源</div>
                  <div className="mt-2 break-all rounded-2xl border border-white/10 bg-background/72 px-3 py-2.5 text-[12px] leading-6 text-muted-foreground">
                    {updater.endpoint || "尚未设置更新源地址"}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <Input
                value={updater.endpoint}
                onChange={(event) => updater.setEndpoint(event.target.value)}
                placeholder="例如：http://192.168.1.120:1421/latest.json"
                className="h-12 rounded-2xl font-mono text-sm"
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="text-muted-foreground">节点状态：</span>
                  <span
                    className={cn(
                      "font-semibold",
                      updater.endpointHealth.state === "ok" &&
                        "text-emerald-600 dark:text-emerald-300",
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
                    onClick={() => void updater.probeEndpoint()}
                  >
                    检测连接
                  </Button>
                  <Button size="sm" onClick={() => void updater.saveEndpoint()}>
                    保存设置
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/28 px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 break-all text-sm font-semibold text-foreground">{value}</div>
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
    <div className="rounded-[24px] border border-white/10 bg-background/72 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-2xl border border-white/10 bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-muted-foreground">{title}</div>
          <div className="mt-1 break-all text-[18px] font-semibold tracking-tight text-foreground">
            {value}
          </div>
          <div className="mt-2 text-[12px] leading-6 text-muted-foreground/78">
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}
