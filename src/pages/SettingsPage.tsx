import { cn } from "@/lib/utils";
import { BackgroundSettingsSection } from "@/modules/settings/components/BackgroundSettingsSection";
import { StorageSettingsSection } from "@/modules/settings/components/StorageSettingsSection";
import { UpdateSettingsSection } from "@/modules/settings/components/UpdateSettingsSection";
import { WindowSettingsSection } from "@/modules/settings/components/WindowSettingsSection";
import { useSettingsPageController } from "@/modules/settings/hooks/useSettingsPageController";
import type { MiniRestoreMode } from "@/modules/settings/types/settings.types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Palette, AppWindow, RefreshCw, HardDrive } from "lucide-react";

export function SettingsPage({
  bgType = "none",
  bgFsPath,
  bgBlur = 12,
  onBgChange,
  onBgBlurChange,
  onMiniRestoreModeChange,
}: {
  bgType?: "none" | "image" | "video";
  bgFsPath?: string | null;
  bgBlur?: number;
  onBgChange?: (type: "none" | "image" | "video", path: string | null) => void;
  onBgBlurChange?: (blur: number) => void;
  onMiniRestoreModeChange?: (mode: MiniRestoreMode) => void;
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
    migrationRemoveSource,
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
    handleChooseFolder,
    handleRestoreDefaultStorage,
    handleStartMigration,
    handleCancelMigration,
    handleMigrateNow,
  } = useSettingsPageController({
    bgType,
    bgFsPath,
    bgBlur,
    onBgChange,
    onBgBlurChange,
    onMiniRestoreModeChange,
  });

  if (loading || !settings) {
    return (
      <div className="flex flex-col gap-6 pl-4 pt-4">
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent">
          设置
        </h1>
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground/80 tracking-wide">加载配置中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      {bgNotice && (
        <div className="pointer-events-none fixed right-6 top-16 z-[60] w-[min(480px,calc(100vw-3rem))] animate-in slide-in-from-top-4 slide-in-from-right-4 fade-in duration-500">
          <div
            className={cn(
              "pointer-events-auto rounded-[24px] border p-5 shadow-2xl backdrop-blur-xl relative overflow-hidden group",
              "glass-card",
              bgNotice.kind === "success" ? "border-emerald-500/30 bg-emerald-500/10 shadow-emerald-500/10" : "border-red-500/30 bg-red-500/10 shadow-red-500/10",
            )}
            role="status"
            aria-live="polite"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
            <div className="flex items-start gap-4 relative z-10">
              <div
                className={cn(
                  "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-inner border border-white/20",
                  bgNotice.kind === "success" ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white" : "bg-gradient-to-br from-red-400 to-red-600 text-white",
                )}
              >
                {bgNotice.kind === "success" ? "✓" : "!"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold tracking-tight text-foreground/90 drop-shadow-sm">{bgNotice.title}</div>
                <div className="mt-1 text-[13px] font-medium text-muted-foreground/90 break-all leading-relaxed">{bgNotice.detail}</div>
                {bgNotice.fileName && <div className="mt-3 inline-block rounded-md bg-black/10 dark:bg-black/30 px-2 py-1 text-[11px] font-mono text-muted-foreground/80 border border-white/5">文件: {bgNotice.fileName}</div>}
                {bgNotice.path && <div className="mt-2 text-[10px] font-mono text-muted-foreground/60 break-all line-clamp-2 hover:line-clamp-none transition-all">路径: {bgNotice.path}</div>}
              </div>
              <button
                type="button"
                onClick={() => setBgNotice(null)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold transition-all hover:bg-white/20 hover:scale-105 active:scale-95 shadow-sm"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header - Fixed */}
      <div className="px-1 mt-2 mb-6 shrink-0">
        <h1 className="text-[32px] sm:text-[40px] font-black tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-foreground/50 bg-clip-text text-transparent drop-shadow-sm">
          设置
        </h1>
        <p className="mt-2 text-[14px] font-medium tracking-wide text-muted-foreground/80 bg-muted/30 inline-block px-3 py-1 rounded-full border border-white/5 backdrop-blur-sm">
          系统配置与外观管理
        </p>
      </div>

      <Tabs defaultValue="appearance" className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Tabs List - Fixed at Top */}
        <div className="px-1 pb-6 shrink-0">
          <TabsList className="bg-white/5 dark:bg-black/10 border border-white/10 p-1 rounded-2xl h-auto w-fit flex gap-1">
            <TabsTrigger value="appearance" className="gap-2 px-6 py-2.5 rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all">
              <Palette className="size-4" />
              个性预览
            </TabsTrigger>
            <TabsTrigger value="window" className="gap-2 px-6 py-2.5 rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all">
              <AppWindow className="size-4" />
              窗口行为
            </TabsTrigger>
            <TabsTrigger value="updates" className="gap-2 px-6 py-2.5 rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all">
              <RefreshCw className="size-4" />
              检查更新
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-2 px-6 py-2.5 rounded-xl data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all">
              <HardDrive className="size-4" />
              存储管理
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content Area - Independent Scroll */}
        <div className="flex-1 min-h-0 min-w-0 relative group/content">
          <div className="absolute inset-0 overflow-y-auto custom-scrollbar-minimal pr-4 pb-[30vh]">
            <TabsContent value="appearance" className="m-0 focus-visible:outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
              <BackgroundSettingsSection
                allowComponentDownload={settings.allow_component_download}
                bgOptimizeHint={bgOptimizeHint}
                bgOptimizeStage={bgOptimizeStage}
                bgType={bgType}
                bgBlur={bgBlur}
                imagePreviewSrc={imagePreviewSrc}
                videoPreviewSrc={videoPreviewSrc}
                onBackgroundBlurChange={handleBackgroundBlurChange}
                onAllowComponentDownloadChange={(enabled) => void handleAllowComponentDownload(enabled)}
                onPrepareVideoOptimizer={() => void handlePrepareVideoOptimizer()}
                onClearBackground={handleClearBackground}
                onApplyStoredBackground={(type) => void handleApplyStoredBackground(type)}
                onChooseBackground={(type) => void handleChooseBackground(type)}
                onPreviewError={(type) => {
                  setStorageMessage(
                    type === "image"
                      ? "背景图片预览失败，可重新选择新图片。"
                      : "背景视频预览失败，可重新选择新视频。",
                  );
                }}
              />
            </TabsContent>

            <TabsContent value="window" className="m-0 focus-visible:outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
              <WindowSettingsSection
                launchAtLogin={settings.launch_at_login}
                closeBehavior={settings.close_behavior}
                miniRestoreMode={settings.mini_restore_mode}
                onLaunchAtLoginChange={(enabled) => void handleLaunchAtLogin(enabled)}
                onCloseBehaviorChange={(behavior) => void handleCloseBehavior(behavior)}
                onMiniRestoreModeChange={(mode) => void handleMiniRestoreMode(mode)}
              />
            </TabsContent>

            <TabsContent value="updates" className="m-0 focus-visible:outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
              <UpdateSettingsSection updater={updater} />
            </TabsContent>

            <TabsContent value="storage" className="m-0 focus-visible:outline-none animate-in fade-in slide-in-from-bottom-2 duration-500">
              <StorageSettingsSection
                storageDisplayPath={settings.storage_display_path}
                storageMessage={storageMessage}
                hasLegacy={hasLegacy}
                legacyRoots={legacyRoots}
                migrationProgress={migrationProgress}
                migrationComplete={migrationComplete}
                migrationRemoveSource={migrationRemoveSource}
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

          {/* Smooth mask at the bottom to indicate more content */}
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background/40 to-transparent pointer-events-none z-10" />
        </div>
      </Tabs>
    </div>
  );
}
