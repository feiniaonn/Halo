import { useCallback, useEffect, useState } from "react";
import { Check, Play, Radio, Settings2, Tv2 } from "lucide-react";

import { MediaDetailModal } from "@/components/MediaDetailModal";
import { VodProxyImage } from "@/components/VodProxyImage";
import { cn } from "@/lib/utils";
import { openLivePlayerWindow } from "@/modules/live/services/livePlayerWindow";
import { LiveChannelPanel } from "@/modules/media/components/LiveChannelPanel";
import { MediaSourceOverview } from "@/modules/media/components/MediaSourceOverview";
import { MediaSourceSettingsDialog } from "@/modules/media/components/MediaSourceSettingsDialog";
import { VodWorkbenchPanel } from "@/modules/media/components/VodWorkbenchPanel";
import { useLiveSourceController } from "@/modules/media/hooks/useLiveSourceController";
import { useVodSourceController } from "@/modules/media/hooks/useVodSourceController";
import { ensureMediaBootstrap } from "@/modules/media/services/mediaBootstrap";
import type { MediaMode, MediaNotice } from "@/modules/media/types/mediaPage.types";

export function MediaPage() {
  const [mode, setMode] = useState<MediaMode>("vod");
  const [notice, setNotice] = useState<MediaNotice | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);

  const showNotice = useCallback((next: MediaNotice) => {
    setNotice(next);
    window.setTimeout(() => {
      setNotice((current) => (current?.text === next.text ? null : current));
    }, 3000);
  }, []);

  const vod = useVodSourceController({ notify: showNotice });
  const live = useLiveSourceController({ notify: showNotice });

  useEffect(() => {
    let cancelled = false;
    void ensureMediaBootstrap().finally(() => {
      if (!cancelled) {
        setBootstrapReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setShowSettings(open);
      if (!open) return;
      vod.syncDraft();
      live.syncDraft();
    },
    [live, vod],
  );

  const isConfigured = mode === "vod" ? Boolean(vod.source) : Boolean(live.source);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1580px] flex-col">
      {notice && (
        <div className="halo-notice-pop pointer-events-none fixed left-1/2 top-20 z-[70] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2">
          <div
            className={cn(
              "halo-media-notice flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-md backdrop-blur-xl",
            )}
            data-kind={notice.kind}
          >
            {notice.kind === "success" && <Check className="size-4" />}
            {notice.text}
          </div>
        </div>
      )}

      <header className="flex-none flex items-center justify-between pb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {mode === "vod" ? "影视媒体" : "电视直播"}
          </h1>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 backdrop-blur-xl p-1">
            <button
              type="button"
              onClick={() => setMode("vod")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                mode === "vod"
                  ? "bg-background/60 backdrop-blur-md text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Play className="size-3.5" />
              点播
            </button>
            <button
              type="button"
              onClick={() => setMode("live")}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                mode === "live"
                  ? "bg-background/60 backdrop-blur-md text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Tv2 className="size-3.5" />
              直播
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isConfigured && mode === "vod" && (
            <MediaSourceOverview
              mode="vod"
              repoUrls={vod.repoUrls}
              activeRepoUrl={vod.activeRepoUrl}
              sites={vod.config?.sites ?? []}
              activeSiteKey={vod.activeSiteKey}
              siteRuntimeStates={vod.siteRuntimeStates}
              loadingConfig={vod.loadingConfig}
              onSelectRepo={(repo) => void vod.selectRepo(repo)}
              onSelectSite={vod.handleSiteSelect}
            />
          )}

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="halo-media-settings-trigger inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-muted/30 backdrop-blur-md px-3 text-[13px] font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            aria-label="媒体设置"
            title="配置媒体源地址"
          >
            <Settings2 className="size-4" />
            媒体设置
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-2 overflow-hidden">
        {!bootstrapReady ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-xl border border-border bg-card/40 backdrop-blur-xl px-5 py-3 text-sm font-medium tracking-wide text-muted-foreground shadow-sm">
              正在初始化媒体运行时...
            </div>
          </div>
        ) : !isConfigured ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex w-full max-w-[500px] flex-col items-center rounded-2xl border border-border bg-card/40 backdrop-blur-xl px-8 py-10 text-center shadow-sm">
              <div className="flex size-14 items-center justify-center rounded-xl bg-muted text-primary/80">
                {mode === "vod" ? <Play className="size-6" /> : <Radio className="size-6" />}
              </div>
              <div className="mt-6 text-[10px] font-bold tracking-[0.2em] uppercase text-primary/80">{mode === "vod" ? "Vod Source" : "Live Source"}</div>
              <h2 className="mt-2 text-[20px] font-bold tracking-tight text-foreground">
                {mode === "vod" ? "尚未配置点播源" : "尚未配置直播源"}
              </h2>
              <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                {mode === "vod"
                  ? "先配置一个可用的点播接口与站点，之后才能浏览分类、搜索影片和拉起播放器。"
                  : "先配置一个可用的直播源地址，之后才能浏览频道分组并打开独立直播窗口。"}
              </p>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="mt-8 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-primary-foreground transition-all hover:opacity-90 shadow-sm"
              >
                <Settings2 className="size-4" />
                立即配置
              </button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-1 flex-col overflow-hidden">
            {mode === "vod" && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-1 overflow-hidden pt-1">
                  <VodWorkbenchPanel
                    activeSite={vod.activeVodSite}
                    browseMode={vod.browseMode}
                    supportsAggregateBrowse={vod.supportsAggregateBrowse}
                    aggregateSessionState={vod.aggregateSessionState}
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
                    onBrowseModeChange={vod.setBrowseMode}
                    onSearchSubmit={() => {
                      void vod.handleVodSearch();
                    }}
                    onSearchReset={vod.handleSearchReset}
                    onLoadMore={vod.loadMore}
                    onSelectVod={vod.selectVodItem}
                    renderVodImage={(item) => (
                      <VodProxyImage
                        src={item.vod_pic}
                        alt={item.vod_name}
                        className="h-full w-full"
                        emptyLabel="暂无图片"
                      />
                    )}
                  />
                </div>
              </div>
            )}

            {mode === "live" && (
              <div className="flex flex-1 min-h-0 overflow-hidden">
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
                      showNotice({ kind: "error", text: `打开播放器窗口失败: ${message}` });
                    });
                  }}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <MediaSourceSettingsDialog
        open={showSettings}
        vodDraft={vod.draft}
        liveDraft={live.draft}
        onOpenChange={handleSettingsOpenChange}
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

      {vod.selectedVodId && vod.activeSiteKey && (vod.selectedVodSite ?? vod.activeVodSite) && (
        <MediaDetailModal
          vodId={vod.selectedVodId}
          site={vod.selectedVodSite ?? vod.activeVodSite!}
          spider={vod.config?.spider ?? ""}
          sourceKey={vod.source}
          repoUrl={vod.activeRepoUrl}
          runtimeSessionKey={vod.runtimeSessionKey}
          policyGeneration={vod.networkPolicyGeneration}
          fallbackTitle={vod.selectedVodTitle ?? ""}
          onClose={vod.clearSelectedVod}
          onPlay={() => vod.clearSelectedVod()}
          onPlayWithDetail={(detail, routes, routeIdx, episodeIdx, extInput) => {
            const site = vod.selectedVodSite ?? vod.activeVodSite;
            if (!site) return;
            vod.clearSelectedVod();
            void vod.openVodFromDetail(site, extInput, detail, routes, routeIdx, episodeIdx);
            showNotice({ kind: "success", text: "正在启动内核播放..." });
          }}
          onPlayDispatchCandidate={async (candidate) => {
            await vod.playDispatchCandidate(candidate);
          }}
          onSearchOnlyPlay={async (keyword, fallbackTitle, originSiteKey) => {
            await vod.resolveMsearchAndPlay(keyword, fallbackTitle, originSiteKey);
          }}
          onResolveSearchDispatch={async (keyword, fallbackTitle, originSiteKey) => {
            return vod.resolveMsearchMatches(keyword, fallbackTitle, 4, originSiteKey);
          }}
        />
      )}
    </div>
  );
}
