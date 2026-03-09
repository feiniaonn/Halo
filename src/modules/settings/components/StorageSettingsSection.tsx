import { HardDrive, RefreshCw, ShieldCheck, FolderOpen } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  MigrationCompletePayload,
  MigrationProgress,
} from '@/modules/settings/services/settingsService';

export function StorageSettingsSection({
  storageDisplayPath,
  storageMessage,
  hasLegacy,
  legacyRoots,
  migrationProgress,
  migrationComplete,
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
  const migrationPercent =
    migrationProgress && migrationProgress.total > 0
      ? Math.min(100, Math.floor((migrationProgress.done / migrationProgress.total) * 100))
      : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">数据目录配置</h2>
          <p className="text-sm text-muted-foreground mt-1">
            管理应用核心数据的存储位置。
          </p>
        </div>
      </section>

      {/* 当前目录配置 */}
      <section className="space-y-1">
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1 pr-8">
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-primary" />
                <h3 className="text-sm font-medium leading-none">当前核心数据目录</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                应用会在目标目录下创建专用数据文件夹 (Halo)，用于持久化保存音乐配置、缓存等。
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 rounded-lg border bg-muted/50 px-3 py-2 text-sm font-mono text-muted-foreground break-all flex items-center">
              {storageDisplayPath}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" onClick={onChooseFolder}>
                <FolderOpen className="size-4 mr-2" />
                更改目录
              </Button>
              <Button variant="outline" onClick={onRestoreDefaultStorage}>
                <RefreshCw className="size-4 mr-2" />
                恢复默认
              </Button>
            </div>
          </div>
          {storageMessage && (
            <div className="mt-2 text-sm font-medium text-destructive">
              {storageMessage}
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* 旧版数据迁移 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">旧版数据迁移</h2>
          <p className="text-sm text-muted-foreground mt-1">
            检测并迁移历史版本的数据至最新目录结构。
          </p>
        </div>

        <div className="flex flex-col gap-6 py-2">
          {/* 旧目录列表 */}
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              检测结果
            </h3>
            {hasLegacy ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-2">发现以下需要迁移的旧版目录：</p>
                <div className="max-h-32 overflow-y-auto space-y-2 pr-2 custom-scrollbar-minimal">
                  {legacyRoots.map((path) => (
                    <div key={path} className="rounded border bg-background/50 px-2 py-1 flex items-center font-mono text-xs text-muted-foreground break-all">
                      {path}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">未检测到需要迁移的旧版目录。</p>
            )}
          </div>

          {/* 迁移设置 */}
          {hasLegacy && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1 flex-1 pr-8">
                  <h3 className="text-sm font-medium leading-none">迁移后清理源文件</h3>
                  <p className="text-sm text-muted-foreground">
                    迁移成功后自动删除旧目录，释放磁盘空间。
                  </p>
                </div>
                <Switch
                  checked={removeSource}
                  onCheckedChange={onRemoveSourceChange}
                />
              </div>

              {/* 迁移进度/状态提示 */}
              {(migrationProgress || migrationComplete) && (
                <div className="rounded-xl border bg-accent/30 p-4 space-y-4">
                  {migrationProgress && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-medium">
                        <span>正在迁移...</span>
                        <span>{migrationPercent}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${migrationPercent}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {migrationProgress.message}
                      </div>
                    </div>
                  )}
                  {migrationComplete && (
                    <div className={cn(
                      "text-sm font-semibold p-3 rounded-lg border",
                      migrationComplete.canceled ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                      migrationComplete.success ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" :
                      "bg-destructive/10 text-destructive border-destructive/20"
                    )}>
                      {migrationComplete.canceled ? '迁移已取消' :
                       migrationComplete.success ? '迁移已成功完成' :
                       `迁移失败：${migrationComplete.error ?? '未知错误'}`}
                    </div>
                  )}
                </div>
              )}

              {/* 迁移操作 */}
              <div className="flex items-center gap-4">
                {migrationRunning ? (
                  <Button variant="destructive" onClick={onCancelMigration} className="flex-1">
                    取消后台迁移
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={onStartMigration} disabled={isMigrating} className="flex-1">
                    <ShieldCheck className="size-4 mr-2" />
                    后台静默迁移
                  </Button>
                )}
                <Button 
                  onClick={onMigrateNow} 
                  disabled={isMigrating || migrationRunning} 
                  className="flex-1"
                >
                  <RefreshCw className={cn("size-4 mr-2", isMigrating && "animate-spin")} />
                  {isMigrating ? "正在迁移..." : "立即迁移"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
