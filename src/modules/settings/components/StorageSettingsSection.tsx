import { HardDrive, RefreshCw, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function StorageSettingsSection({
  storageDisplayPath,
  storageMessage,
  isMigrating,
  migrationRunning,
  onChooseFolder,
  onRestoreDefaultStorage,
}: {
  storageDisplayPath: string;
  storageMessage: string | null;
  isMigrating: boolean;
  migrationRunning: boolean;
  onChooseFolder: () => void;
  onRestoreDefaultStorage: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-12 pt-4">
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">存储目录</h2>
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
                <h3 className="text-sm font-medium leading-none text-foreground">当前核心数据目录</h3>
              </div>
              <p className="text-sm text-muted-foreground mt-1.5">
                应用会在目标目录下创建专用数据文件夹 (Halo)，用于持久化保存音乐配置、缓存等。
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 rounded-lg bg-card/40 backdrop-blur-xl border border-border px-3 py-2 text-sm font-mono text-muted-foreground break-all flex items-center shadow-sm">
              {storageDisplayPath}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" className="shadow-sm" onClick={onChooseFolder} disabled={isMigrating || migrationRunning}>
                <FolderOpen className="size-4 mr-2" />
                更改目录
              </Button>
              <Button variant="outline" className="shadow-sm text-muted-foreground" onClick={onRestoreDefaultStorage} disabled={isMigrating || migrationRunning}>
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
    </div>
  );
}








