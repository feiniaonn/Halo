import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { MigrationCompletePayload, MigrationProgress } from "@/modules/settings/services/settingsService";

export function StorageSettingsSection({
  storageDisplayPath,
  storageMessage,
  hasLegacy,
  legacyRoots,
  migrationProgress,
  migrationComplete,
  migrationRemoveSource,
  removeSource,
  isMigrating,
  migrationRunning,
  onChooseFolder,
  onRestoreDefaultStorage,
  onRemoveSourceChange,
  onStartMigration,
  onCancelMigration,
  onMigrateNow,
}: {
  storageDisplayPath: string;
  storageMessage: string | null;
  hasLegacy: boolean;
  legacyRoots: string[];
  migrationProgress: MigrationProgress | null;
  migrationComplete: MigrationCompletePayload | null;
  migrationRemoveSource: boolean | null;
  removeSource: boolean;
  isMigrating: boolean;
  migrationRunning: boolean;
  onChooseFolder: () => void;
  onRestoreDefaultStorage: () => void;
  onRemoveSourceChange: (remove: boolean) => void;
  onStartMigration: () => void;
  onCancelMigration: () => void;
  onMigrateNow: () => void;
}) {
  return (
    <Card className="glass-card border-none p-6 relative overflow-hidden group">
      <div className="z-10 relative">
        <h2 className="text-lg font-bold text-foreground/90 tracking-tight">存储管理</h2>
        <p className="mt-1 text-[13px] text-muted-foreground/80 font-medium tracking-wide">
          设置数据存储位置。会在目标目录下创建 HaloTemp，用于保存音乐记录与封面等数据。
        </p>

        <div className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-black/10 dark:bg-black/30 p-4 rounded-[16px] border border-white/5">
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold text-foreground/90 mb-1">当前存储路径</span>
              <p className="font-mono text-xs text-muted-foreground/80 bg-background/50 px-2 py-1 rounded-[8px] border border-white/5 block w-full break-all" title={storageDisplayPath}>
                {storageDisplayPath}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onChooseFolder}
                className="rounded-full bg-primary/90 px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary hover:scale-105 active:scale-95 transition-all duration-300 shadow-sm"
              >
                更改位置
              </button>
              <button
                type="button"
                onClick={onRestoreDefaultStorage}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-bold text-foreground hover:bg-white/10 hover:scale-105 active:scale-95 transition-all duration-300 shadow-sm"
              >
                恢复默认
              </button>
            </div>
          </div>

          {storageMessage && <p className="text-[13px] font-medium text-amber-500/90 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">{storageMessage}</p>}

          {hasLegacy && (
            <div className="mt-4 rounded-[20px] border border-primary/30 bg-primary/5 p-5 relative overflow-hidden group/legacy shadow-inner">
              <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent opacity-0 group-hover/legacy:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="relative z-10">
                <p className="text-sm font-bold flex items-center gap-2 text-primary">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] animate-pulse">!</span>
                  检测到旧版数据目录
                </p>
                <ul className="mt-3 list-disc space-y-1 pl-6 text-[13px] font-mono text-muted-foreground/80 max-h-[100px] overflow-y-auto no-scrollbar mask-linear-y">
                  {legacyRoots.map((path) => (
                    <li key={path} className="break-all">{path}</li>
                  ))}
                </ul>

                {migrationProgress && (migrationProgress.running || migrationProgress.done > 0) && (
                  <div className="mt-5 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                      <span className="truncate pr-4">{migrationProgress.message ?? "合并中..."} {migrationProgress.current_legacy_base ? `(${migrationProgress.current_legacy_base})` : ""}</span>
                      <span className="shrink-0">{migrationProgress.done} / {migrationProgress.total}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-black/20 dark:bg-black/40 shadow-inner">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300 relative"
                        style={{
                          width: migrationProgress.total > 0 ? `${Math.min(100, Math.floor((migrationProgress.done / migrationProgress.total) * 100))}%` : "0%",
                        }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                      </div>
                    </div>
                  </div>
                )}

                {migrationComplete && (
                  <p className={cn(
                    "mt-4 text-[13px] font-medium px-3 py-2 rounded-lg border",
                    migrationComplete.canceled ? "text-amber-500/90 bg-amber-500/10 border-amber-500/20" :
                      migrationComplete.success ? "text-emerald-500/90 bg-emerald-500/10 border-emerald-500/20" :
                        "text-red-500/90 bg-red-500/10 border-red-500/20"
                  )}>
                    {migrationComplete.canceled
                      ? "已取消合并任务。"
                      : migrationComplete.success
                        ? (migrationRemoveSource ?? removeSource)
                          ? "数据合并完成，旧目录已清理。"
                          : "数据合并完成，旧目录已保留。"
                        : `合并失败：${migrationComplete.error ?? "未知错误"}`}
                  </p>
                )}

                <div className="mt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3 rounded-[16px] bg-background/50 border border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-foreground/80">迁移后删除旧目录</span>
                    <Switch
                      checked={removeSource}
                      onCheckedChange={onRemoveSourceChange}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {migrationRunning ? (
                      <button
                        type="button"
                        onClick={onCancelMigration}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-bold hover:bg-white/10 transition-all shadow-sm"
                      >
                        取消后台合并
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={onStartMigration}
                        disabled={migrationRunning}
                        className="rounded-full bg-emerald-500/90 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 hover:scale-105 active:scale-95 transition-all shadow-sm disabled:opacity-50 disabled:hover:scale-100"
                      >
                        后台合并旧数据
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={onMigrateNow}
                      disabled={isMigrating || migrationRunning}
                      className={cn(
                        "rounded-full bg-primary/90 px-4 py-1.5 text-xs font-bold text-primary-foreground transition-all shadow-sm",
                        (isMigrating || migrationRunning) ? "opacity-50 cursor-not-allowed" : "hover:bg-primary hover:scale-105 active:scale-95"
                      )}
                    >
                      {isMigrating ? "迁移中..." : "立即迁移（可能耗时）"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
