import { useCallback, useEffect, useState } from "react";
import { Check, Play, Settings2, Tv } from "lucide-react";

import { MediaDetailModal } from "@/components/MediaDetailModal";
import { VodProxyImage } from "@/components/VodProxyImage";
import { cn } from "@/lib/utils";
import { openLivePlayerWindow } from "@/modules/live/services/livePlayerWindow";
import { LiveChannelPanel } from "@/modules/media/components/LiveChannelPanel";
import { MediaSourceOverview } from "@/modules/media/components/MediaSourceOverview";
import { MediaSourceSettingsDialog } from "@/modules/media/components/MediaSourceSettingsDialog";
import { VodBrowsePanel } from "@/modules/media/components/VodBrowsePanel";
import { useLiveSourceController } from "@/modules/media/hooks/useLiveSourceController";
import { useVodSourceController } from "@/modules/media/hooks/useVodSourceController";
import type { MediaMode, MediaNotice } from "@/modules/media/types/mediaPage.types";

export function MediaPage() {
  const [mode, setMode] = useState<MediaMode>("vod");
  const [notice, setNotice] = useState<MediaNotice | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const showNotice = useCallback((next: MediaNotice) => {
    setNotice(next);
    window.setTimeout(() => {
      setNotice((current) => (current?.text === next.text ? null : current));
    }, 3000);
  }, []);

  const vod = useVodSourceController({ notify: showNotice });
  const live = useLiveSourceController({ notify: showNotice });
  const syncVodDraft = vod.syncDraft;
  const syncLiveDraft = live.syncDraft;

  useEffect(() => {
    if (!showSettings) return;
    syncVodDraft();
    syncLiveDraft();
  }, [showSettings, syncLiveDraft, syncVodDraft]);

  const isConfigured = mode === "vod" ? !!vod.source : !!live.source;

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1400px] flex-col">
      {notice && (
        <div className="absolute right-0 top-0 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl",
              notice.kind === "success" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              notice.kind === "warning" && "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              notice.kind === "error" && "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300",
            )}
          >
            {notice.kind === "success" && <Check className="size-4" />}
            {notice.text}
          </div>
        </div>
      )}

      <header className="mb-4 flex shrink-0 items-center justify-between px-1 py-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">媒体中心</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">探索影视点播与电视直播内容。</p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="z-40 inline-flex items-center justify-center rounded-xl bg-muted/60 p-2.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
          aria-label="媒体设置"
          title="设置源地址"
        >
          <Settings2 className="size-5" />
        </button>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-2 overflow-y-auto pr-2">
        <div className="mb-4 flex w-full max-w-xs self-center rounded-full bg-muted/40 p-1.5 shadow-inner backdrop-blur-md">
          <button
            onClick={() => setMode("vod")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-all duration-300",
              mode === "vod" ? "scale-[1.02] bg-background text-foreground shadow-md" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Play className="size-4" />
            影视点播
          </button>
          <button
            onClick={() => setMode("live")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-all duration-300",
              mode === "live" ? "scale-[1.02] bg-background text-foreground shadow-md" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Tv className="size-4" />
            电视直播
          </button>
        </div>

        {!isConfigured ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center animate-in fade-in duration-500">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-white/10 to-transparent shadow-lg">
              {mode === "vod" ? <Play className="size-10 text-muted-foreground/60" /> : <Tv className="size-10 text-muted-foreground/60" />}
            </div>
            <h2 className="mb-2 text-xl font-semibold">{mode === "vod" ? "尚未配置点播源" : "尚未配置直播源"}</h2>
            <p className="mb-8 max-w-[340px] text-sm text-muted-foreground">开始播放前，请先配置一个媒体源地址。</p>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 hover:bg-primary/90 active:scale-95"
            >
              <Settings2 className="size-4" />
              立即前往设置
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-1 flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
            {mode === "vod" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <MediaSourceOverview
                  mode="vod"
                  repoUrls={vod.repoUrls}
                  activeRepoUrl={vod.activeRepoUrl}
                  sites={vod.config?.sites ?? []}
                  activeSiteKey={vod.activeSiteKey}
                  activeSite={vod.activeVodSite}
                  siteRuntimeStates={vod.siteRuntimeStates}
                  activeSiteRuntime={vod.activeSiteRuntime}
                  loadingConfig={vod.loadingConfig}
                  spiderJarStatus={vod.spiderJarStatus}
                  onSelectRepo={(repo) => {
                    void vod.selectRepo(repo);
                  }}
                  onSelectSite={vod.handleSiteSelect}
                />

                <div className="flex flex-1 overflow-hidden pt-4">
                  <VodBrowsePanel
                    activeSite={vod.activeVodSite}
                    activeClassId={vod.activeClassId}
                    filteredVodClasses={vod.filteredVodClasses}
                    classFilterKeyword={vod.classFilterKeyword}
                    vodSearchKeyword={vod.vodSearchKeyword}
                    activeSearchKeyword={vod.activeSearchKeyword}
                    loadingVod={vod.loadingVod}
                    loadingMore={vod.loadingMore}
                    vodList={vod.vodList}
                    hasMore={vod.hasMore}
                    detailEnabled={vod.detailEnabled}
                    onClassFilterChange={vod.setClassFilterKeyword}
                    onVodSearchKeywordChange={vod.setVodSearchKeyword}
                    onClassClick={vod.handleClassClick}
                    onSearchSubmit={() => {
                      void vod.handleVodSearch();
                    }}
                    onSearchReset={vod.handleSearchReset}
                    onLoadMore={vod.loadMore}
                    onSelectVod={vod.setSelectedVodId}
                    renderVodImage={(item) => (
                      <VodProxyImage src={item.vod_pic} alt={item.vod_name} className="h-full w-full" emptyLabel="无图" />
                    )}
                  />
                </div>
              </div>
            )}

            {mode === "live" && (
              <LiveChannelPanel
                groups={live.groups}
                activeGroup={live.activeGroup}
                currentGroup={live.currentGroup}
                loading={live.loading}
                error={live.error}
                onSelectGroup={live.setActiveGroup}
                onOpenChannel={(channel) => {
                  void openLivePlayerWindow({
                    groups: live.groups,
                    initialGroup: live.activeGroup || live.currentGroup?.groupName || "",
                    initialChannel: channel,
                    initialLineIndex: 0,
                    initialKernelMode: "mpv",
                  }).catch((reason: unknown) => {
                    const message = reason instanceof Error ? reason.message : String(reason);
                    showNotice({ kind: "error", text: `打开播放窗口失败: ${message}` });
                  });
                }}
              />
            )}
          </div>
        )}
      </main>

      <MediaSourceSettingsDialog
        open={showSettings}
        vodDraft={vod.draft}
        liveDraft={live.draft}
        onOpenChange={setShowSettings}
        onDraftChange={(target, value) => {
          if (target === "vod") {
            vod.setDraft(value);
          } else {
            live.setDraft(value);
          }
        }}
        onClear={(target) => {
          if (target === "vod") {
            vod.clearSource();
          } else {
            live.clearSource();
          }
        }}
        onSave={(target) => {
          if (target === "vod") {
            vod.saveSource();
          } else {
            live.saveSource();
          }
        }}
      />

      {vod.selectedVodId && vod.activeSiteKey && vod.activeVodSite && vod.detailEnabled && (
        <MediaDetailModal
          vodId={vod.selectedVodId}
          site={vod.activeVodSite}
          spider={vod.config?.spider ?? ""}
          onClose={() => vod.setSelectedVodId(null)}
          onPlay={() => vod.setSelectedVodId(null)}
          onPlayWithDetail={(detail, routes, routeIdx, episodeIdx, extInput) => {
            const site = vod.activeVodSite;
            if (!site) return;
            vod.setSelectedVodId(null);
            void vod.openVodFromDetail(site, extInput, detail, routes, routeIdx, episodeIdx);
            showNotice({ kind: "success", text: "正在启动内核播放..." });
          }}
          onSearchOnlyPlay={async (keyword) => {
            await vod.resolveMsearchAndPlay(keyword);
          }}
        />
      )}
    </div>
  );
}
