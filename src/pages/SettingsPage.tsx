import { useEffect } from 'react';
import { AppWindow, HardDrive, Palette, RefreshCw } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { BackgroundSettingsSection } from '@/modules/settings/components/BackgroundSettingsSection';
import { StorageSettingsSection } from '@/modules/settings/components/StorageSettingsSection';
import { UpdateSettingsSection } from '@/modules/settings/components/UpdateSettingsSection';
import { WindowSettingsSection } from '@/modules/settings/components/WindowSettingsSection';
import { useSettingsPageController } from '@/modules/settings/hooks/useSettingsPageController';
import type { MiniRestoreMode } from '@/modules/settings/types/settings.types';

export function SettingsPage({
  bgType = 'none',
  bgFsPath,
  bgBlur = 12,
  miniRestoreMode,
  miniModeWidth,
  miniModeHeight,
  onBgChange,
  onBgBlurChange,
  onMiniRestoreModeChange,
  onMiniModeWidthChange,
  onMiniModeHeightChange,
}: {
  bgType?: 'none' | 'image' | 'video';
  bgFsPath?: string | null;
  bgBlur?: number;
  miniRestoreMode?: MiniRestoreMode;
  miniModeWidth?: number;
  miniModeHeight?: number;
  onBgChange?: (type: 'none' | 'image' | 'video', path: string | null) => void;
  onBgBlurChange?: (blur: number) => void;
  onMiniRestoreModeChange?: (mode: MiniRestoreMode) => void;
  onMiniModeWidthChange?: (width: number) => void;
  onMiniModeHeightChange?: (height: number) => void;
}) {
  const {
    updater,
    settings,
    loading,
    bgNotice,
    setBgNotice,
    storageMessage,
    setStorageMessage,
    bgOptimizeHint,
    bgOptimizeStage,
    legacyRoots,
    hasLegacy,
    migrationRunning,
    imagePreviewSrc,
    videoPreviewSrc,
    migrationProgress,
    migrationComplete,
    removeSource,
    setRemoveSource,
    isMigrating,
    handleBackgroundBlurChange,
    handleAllowComponentDownload,
    handlePrepareVideoOptimizer,
    handleClearBackground,
    handleApplyStoredBackground,
    handleChooseBackground,
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleMiniRestoreMode,
    handleMiniModeSize,
    handleChooseFolder,
    handleRestoreDefaultStorage,
    handleStartMigration,
    handleCancelMigration,
    handleMigrateNow,
  } = useSettingsPageController({
    bgType,
    bgFsPath,
    bgBlur,
    miniRestoreMode,
    miniModeWidth,
    miniModeHeight,
    onBgChange,
    onBgBlurChange,
    onMiniRestoreModeChange,
    onMiniModeWidthChange,
    onMiniModeHeightChange,
  });

  // Auto-dismiss success notices after 3 s (must be before any early returns – Rules of Hooks)
  useEffect(() => {
    if (!bgNotice || bgNotice.kind !== 'success') return;
    const timer = window.setTimeout(() => setBgNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [bgNotice, setBgNotice]);

  if (loading || !settings) {
    return (
      <div className="flex flex-col gap-6 pl-4 pt-4">
        <h1 className="bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-3xl font-black tracking-tight text-transparent">
          设置
        </h1>
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium tracking-wide text-muted-foreground/80">
            加载配置中...
          </p>
        </div>
      </div>
    );
  }

  const tabs = [
    { value: 'appearance', label: '个性预览', icon: Palette, desc: '背景与外观' },
    { value: 'window', label: '窗口行为', icon: AppWindow, desc: '启动与关闭逻辑' },
    { value: 'updates', label: '检查更新', icon: RefreshCw, desc: '版本与更新源' },
    { value: 'storage', label: '存储管理', icon: HardDrive, desc: '数据目录与迁移' },
  ] as const;

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden">
      {bgNotice && (
        <div className="pointer-events-none fixed right-6 top-16 z-[60] w-[min(480px,calc(100vw-3rem))] animate-in slide-in-from-top-4 slide-in-from-right-4 fade-in duration-500">
          <div
            className={cn(
              'glass-card pointer-events-auto relative overflow-hidden rounded-[24px] border p-5 shadow-2xl backdrop-blur-xl',
              bgNotice.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 shadow-emerald-500/10'
                : 'border-red-500/30 bg-red-500/10 shadow-red-500/10',
            )}
            role="status"
            aria-live="polite"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
            <div className="relative z-10 flex items-start gap-4">
              <div
                className={cn(
                  'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 text-sm font-bold shadow-inner',
                  bgNotice.kind === 'success'
                    ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white'
                    : 'bg-gradient-to-br from-red-400 to-red-600 text-white',
                )}
              >
                {bgNotice.kind === 'success' ? '✓' : '!'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold tracking-tight text-foreground/90">
                  {bgNotice.title}
                </div>
                <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground/90 break-all">
                  {bgNotice.detail}
                </div>
                {bgNotice.fileName && (
                  <div className="mt-3 inline-block rounded-md border border-white/5 bg-black/10 px-2 py-1 text-[11px] font-mono text-muted-foreground/80 dark:bg-black/30">
                    文件: {bgNotice.fileName}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-8 pt-8 pb-4">
        <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground mt-2">
          管理应用外观、运行行为、版本更新及本地存储。
        </p>
      </div>

      <Tabs defaultValue="appearance" className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 px-8 border-b border-border/40">
          <TabsList className="flex h-12 w-full justify-start gap-8 rounded-none bg-transparent p-0">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="relative flex items-center justify-center gap-2 rounded-none border-b-2 border-transparent px-1 pb-3 pt-3 font-medium text-muted-foreground transition-none data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none hover:text-foreground"
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 overflow-y-auto px-8 py-6 custom-scrollbar-minimal">
            <TabsContent
              value="appearance"
              className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500"
            >
              <BackgroundSettingsSection
                allowComponentDownload={settings.allow_component_download}
                bgOptimizeHint={bgOptimizeHint}
                bgOptimizeStage={bgOptimizeStage}
                bgType={bgType}
                bgBlur={bgBlur}
                imagePreviewSrc={imagePreviewSrc}
                videoPreviewSrc={videoPreviewSrc}
                onBackgroundBlurChange={handleBackgroundBlurChange}
                onAllowComponentDownloadChange={(enabled) =>
                  void handleAllowComponentDownload(enabled)
                }
                onPrepareVideoOptimizer={() => void handlePrepareVideoOptimizer()}
                onClearBackground={handleClearBackground}
                onApplyStoredBackground={(type) => void handleApplyStoredBackground(type)}
                onChooseBackground={(type) => void handleChooseBackground(type)}
                onPreviewError={(type) => {
                  setStorageMessage(
                    type === 'image'
                      ? '背景图片预览失败，可重新选择新图片。'
                      : '背景视频预览失败，可重新选择新视频。',
                  );
                }}
              />
            </TabsContent>

            <TabsContent
              value="window"
              className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500"
            >
              <WindowSettingsSection
                launchAtLogin={settings.launch_at_login}
                closeBehavior={settings.close_behavior}
                miniRestoreMode={settings.mini_restore_mode}
                miniModeWidth={settings.mini_mode_width}
                miniModeHeight={settings.mini_mode_height}
                onLaunchAtLoginChange={(enabled) => void handleLaunchAtLogin(enabled)}
                onCloseBehaviorChange={(behavior) => void handleCloseBehavior(behavior)}
                onMiniRestoreModeChange={(mode) => void handleMiniRestoreMode(mode)}
                onMiniModeSizeChange={(width, height) => void handleMiniModeSize(width, height)}
              />
            </TabsContent>

            <TabsContent
              value="updates"
              className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500"
            >
              <UpdateSettingsSection updater={updater} />
            </TabsContent>

            <TabsContent
              value="storage"
              className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500"
            >
              <StorageSettingsSection
                storageDisplayPath={settings.storage_display_path}
                storageMessage={storageMessage}
                hasLegacy={hasLegacy}
                legacyRoots={legacyRoots}
                migrationProgress={migrationProgress}
                migrationComplete={migrationComplete}
                removeSource={removeSource}
                isMigrating={isMigrating}
                migrationRunning={migrationRunning}
                onChooseFolder={() => void handleChooseFolder()}
                onRestoreDefaultStorage={() => void handleRestoreDefaultStorage()}
                onRemoveSourceChange={setRemoveSource}
                onStartMigration={() => void handleStartMigration()}
                onCancelMigration={() => void handleCancelMigration()}
                onMigrateNow={() => void handleMigrateNow()}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
