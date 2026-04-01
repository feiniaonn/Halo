import { useEffect } from "react";
import { AppWindow, Code2, HardDrive, Palette, RefreshCw } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BackgroundSettingsSection } from "@/modules/settings/components/BackgroundSettingsSection";
import { DeveloperSettingsSection } from "@/modules/settings/components/DeveloperSettingsSection";
import { StorageSettingsSection } from "@/modules/settings/components/StorageSettingsSection";
import { UpdateSettingsSection } from "@/modules/settings/components/UpdateSettingsSection";
import { WindowSettingsSection } from "@/modules/settings/components/WindowSettingsSection";
import { useSettingsPageController } from "@/modules/settings/hooks/useSettingsPageController";

export function SettingsPage({
  bgType = "none",
  bgFsPath,
  bgBlur = 12,
  developerMode = false,
  onBgChange,
  onBgBlurChange,
  onDeveloperModeChange,
}: {
  bgType?: "none" | "image" | "video";
  bgFsPath?: string | null;
  bgBlur?: number;
  developerMode?: boolean;
  onBgChange?: (type: "none" | "image" | "video", path: string | null) => void;
  onBgBlurChange?: (blur: number) => void;
  onDeveloperModeChange?: (enabled: boolean) => void;
}) {
  const {
    updater,
    settings,
    loading,
    bgNotice,
    setBgNotice,
    storageMessage,
    setStorageMessage,
    migrationRunning,
    imagePreviewSrc,
    videoPreviewSrc,
    isMigrating,
    handleBackgroundBlurChange,
    handleClearBackground,
    handleApplyStoredBackground,
    handleChooseBackground,
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleDeveloperMode,
    handleChooseFolder,
    handleRestoreDefaultStorage,
  } = useSettingsPageController({
    bgType,
    bgFsPath,
    bgBlur,
    onBgChange,
    onBgBlurChange,
    onDeveloperModeChange,
  });

  useEffect(() => {
    if (!bgNotice || bgNotice.kind !== "success") return;
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
          <p className="text-sm font-medium tracking-wide text-muted-foreground/80">正在加载配置…</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { value: "appearance", label: "个性外观", icon: Palette },
    { value: "window", label: "窗口行为", icon: AppWindow },
    { value: "developer", label: "开发者", icon: Code2 },
    { value: "updates", label: "检查更新", icon: RefreshCw },
    { value: "storage", label: "存储管理", icon: HardDrive },
  ] as const;

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden">
      {bgNotice && (
        <div className="pointer-events-none fixed right-6 top-16 z-[60] w-[min(480px,calc(100vw-3rem))] animate-in slide-in-from-top-4 slide-in-from-right-4 fade-in duration-500">
          <div
            className={cn(
              "pointer-events-auto relative overflow-hidden rounded-2xl border p-4 shadow-lg backdrop-blur-xl",
              bgNotice.kind === "success"
                ? "border-emerald-500/20 bg-emerald-500/10"
                : "border-red-500/20 bg-red-500/10",
            )}
            role="status"
            aria-live="polite"
          >
            <div className="relative z-10 flex items-start gap-4">
              <div
                className={cn(
                  "mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/20 text-sm font-bold shadow-inner",
                  bgNotice.kind === "success"
                    ? "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white"
                    : "bg-gradient-to-br from-red-400 to-red-600 text-white",
                )}
              >
                {bgNotice.kind === "success" ? "✓" : "!"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold tracking-tight text-foreground/90">
                  {bgNotice.title}
                </div>
                <div className="mt-1 break-all text-[13px] leading-relaxed text-muted-foreground/90">
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

      <div className="shrink-0 px-8 pb-2 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          管理应用外观、窗口行为、开发者功能、版本更新与本地存储。
        </p>
      </div>

      <Tabs defaultValue="appearance" className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 px-8 pb-2">
          <TabsList className="flex h-12 w-full justify-start gap-2 p-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="relative flex items-center justify-center gap-2 rounded-xl px-4 py-2 font-medium text-muted-foreground transition-all duration-300 ease-out hover:bg-white/5 hover:text-foreground data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="custom-scrollbar-minimal h-full min-h-0 overflow-y-auto bg-transparent px-8 py-6">
            <TabsContent value="appearance" className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <BackgroundSettingsSection
                bgType={bgType}
                bgBlur={bgBlur}
                imagePreviewSrc={imagePreviewSrc}
                videoPreviewSrc={videoPreviewSrc}
                onBackgroundBlurChange={handleBackgroundBlurChange}
                onClearBackground={handleClearBackground}
                onApplyStoredBackground={(type) => void handleApplyStoredBackground(type)}
                onChooseBackground={(type) => void handleChooseBackground(type)}
                onPreviewError={(type) => {
                  setStorageMessage(
                    type === "image"
                      ? "背景图片预览失败，可以重新选择新图片。"
                      : "背景视频预览失败，可以重新选择新视频。",
                  );
                }}
              />
            </TabsContent>

            <TabsContent value="window" className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <WindowSettingsSection
                launchAtLogin={settings.launch_at_login}
                closeBehavior={settings.close_behavior}
                onLaunchAtLoginChange={(enabled) => void handleLaunchAtLogin(enabled)}
                onCloseBehaviorChange={(behavior) => void handleCloseBehavior(behavior)}
              />
            </TabsContent>

            <TabsContent value="developer" className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <DeveloperSettingsSection
                developerMode={developerMode}
                onDeveloperModeChange={(enabled) => void handleDeveloperMode(enabled)}
              />
            </TabsContent>

            <TabsContent value="updates" className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <UpdateSettingsSection updater={updater} />
            </TabsContent>

            <TabsContent value="storage" className="m-0 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <StorageSettingsSection
                storageDisplayPath={settings.storage_display_path}
                storageMessage={storageMessage}
                isMigrating={isMigrating}
                migrationRunning={migrationRunning}
                onChooseFolder={() => void handleChooseFolder()}
                onRestoreDefaultStorage={() => void handleRestoreDefaultStorage()}
              />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
