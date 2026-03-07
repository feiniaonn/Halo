import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import type { UseUpdaterResult } from "@/modules/updater/hooks/useUpdater";

export function UpdateSettingsSection({ updater }: { updater: UseUpdaterResult }) {
  const [autoRelaunchCountdown, setAutoRelaunchCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (updater.status.state === "installed") {
      setAutoRelaunchCountdown(3);
      const timer = setInterval(() => {
        setAutoRelaunchCountdown((prev) => {
          if (prev === null || prev <= 1) {
            clearInterval(timer);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
    setAutoRelaunchCountdown(null);
  }, [updater.status.state]);

  const statusText = (() => {
    if (updater.status.state === "idle") return "空闲";
    if (updater.status.state === "checking") return "检查中...";
    if (updater.status.state === "available") {
      const version = updater.status.result?.version;
      return version ? `发现新版本 ${version}` : "发现更新";
    }
    if (updater.status.state === "up_to_date") return "已是最新版本";
    if (updater.status.state === "downloading") {
      const { downloaded, total } = updater.status;
      if (total && total > 0) {
        const percent = Math.round((downloaded / total) * 100);
        const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        return `下载中 ${percent}% (${downloadedMB}/${totalMB} MB)`;
      }
      return "下载中...";
    }
    if (updater.status.state === "downloaded") return "下载完成，正在安装...";
    if (updater.status.state === "installed") {
      if (autoRelaunchCountdown !== null) {
        return `安装完成！${autoRelaunchCountdown}秒后自动重启...`;
      }
      return "安装完成";
    }
    return `错误：${updater.status.message}`;
  })();

  const statusColor = (() => {
    if (updater.status.state === "available") return "text-amber-600 dark:text-amber-400";
    if (updater.status.state === "downloading") return "text-blue-600 dark:text-blue-400";
    if (updater.status.state === "downloaded" || updater.status.state === "installed") return "text-emerald-600 dark:text-emerald-400";
    if (updater.status.state === "error") return "text-red-600 dark:text-red-400";
    if (updater.status.state === "up_to_date") return "text-emerald-600 dark:text-emerald-400";
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

  const endpointHealthColor = (() => {
    if (updater.endpointHealth.state === "ok") return "text-emerald-600 dark:text-emerald-400";
    if (updater.endpointHealth.state === "error") return "text-red-600 dark:text-red-400";
    return "text-muted-foreground";
  })();

  const latestVersion = (() => {
    if (updater.status.state === "available") {
      return updater.status.result.version ?? updater.lastCheck?.version ?? null;
    }
    return updater.lastCheck?.version ?? null;
  })();

  const canDownload = updater.status.state !== "checking" && updater.status.state !== "downloading" && updater.status.state !== "downloaded";
  const canRelaunch = updater.status.state === "downloaded" || updater.status.state === "installed";
  const showUpdateButton = updater.status.state === "available" || updater.status.state === "idle" || updater.status.state === "up_to_date" || updater.status.state === "error";

  return (
    <Card className="glass-card border-none p-6 relative overflow-hidden group">
      <div className="z-10 relative">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground/90 tracking-tight">应用更新</h2>
            <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">
              当前版本：<span className="font-mono">{updater.currentVersion}</span>
            </p>
            {latestVersion && (
              <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">
                最新版本：<span className="font-mono">{latestVersion}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${statusColor} bg-black/5 dark:bg-black/20 border-current/20`}>
              {statusText}
            </span>
            <span className={`text-[11px] font-medium ${endpointHealthColor}`}>
              更新源：{endpointHealthText}
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              className="h-[40px] flex-1 rounded-[12px] border border-white/10 bg-black/10 dark:bg-black/30 px-4 text-sm font-mono focus:border-primary/50 focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner"
              value={updater.endpoint}
              onChange={(e) => updater.setEndpoint(e.target.value)}
              placeholder="更新源地址（如：http://192.168.1.120:1421/latest.json）"
            />
            <button
              className="h-[40px] rounded-[12px] border border-white/10 bg-white/5 px-5 text-sm font-bold hover:bg-white/10 transition-all shadow-sm active:scale-95"
              onClick={() => void updater.saveEndpoint()}
            >
              保存
            </button>
            <button
              className="h-[40px] rounded-[12px] border border-white/10 bg-white/5 px-5 text-sm font-bold hover:bg-white/10 transition-all shadow-sm active:scale-95"
              onClick={() => void updater.probeEndpoint()}
            >
              检测
            </button>
          </div>

          <div className="flex gap-2">
            <button
              className="h-[40px] flex-1 rounded-[12px] bg-primary/90 px-6 text-sm font-bold text-primary-foreground hover:bg-primary transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => void updater.checkAndPrompt()}
              disabled={updater.status.state === "checking"}
            >
              {updater.status.state === "checking" ? "检查中..." : "检查更新"}
            </button>
            {showUpdateButton && (
              <button
                className="h-[40px] flex-1 rounded-[12px] border border-emerald-400/35 bg-emerald-500/20 px-6 text-sm font-bold text-emerald-700 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed dark:text-emerald-300"
                onClick={() => void updater.downloadAndInstall()}
                disabled={!canDownload}
              >
                {updater.status.state === "downloading" ? "下载中..." : updater.status.state === "downloaded" ? "安装中..." : "一键更新"}
              </button>
            )}
            {canRelaunch && (
              <button
                className="h-[40px] flex-1 rounded-[12px] border border-blue-400/35 bg-blue-500/20 px-6 text-sm font-bold text-blue-700 transition-all shadow-sm active:scale-95 dark:text-blue-300"
                onClick={() => void updater.relaunch()}
              >
                立即重启
              </button>
            )}
          </div>
        </div>

        {updater.status.state === "available" && updater.status.result?.body && (
          <div className="mt-4 p-4 rounded-[12px] bg-black/5 dark:bg-black/20 border border-white/10">
            <h3 className="text-sm font-bold text-foreground/90 mb-2">更新说明</h3>
            <p className="text-xs text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">
              {updater.status.result.body}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
