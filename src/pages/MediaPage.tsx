import { useCallback, useEffect, useState } from 'react';
import { Check, Play, Settings2, Tv } from 'lucide-react';

import { MediaDetailModal } from '@/components/MediaDetailModal';
import { VodProxyImage } from '@/components/VodProxyImage';
import { cn } from '@/lib/utils';
import { openLivePlayerWindow } from '@/modules/live/services/livePlayerWindow';
import { LiveChannelPanel } from '@/modules/media/components/LiveChannelPanel';
import { MediaSourceOverview } from '@/modules/media/components/MediaSourceOverview';
import { MediaSourceSettingsDialog } from '@/modules/media/components/MediaSourceSettingsDialog';
import { VodWorkbenchPanel } from '@/modules/media/components/VodWorkbenchPanel';
import { useLiveSourceController } from '@/modules/media/hooks/useLiveSourceController';
import { useVodSourceController } from '@/modules/media/hooks/useVodSourceController';
import type { MediaMode, MediaNotice } from '@/modules/media/types/mediaPage.types';

export function MediaPage() {
  const [mode, setMode] = useState<MediaMode>('vod');
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

  useEffect(() => {
    if (!showSettings) return;
    vod.syncDraft();
    live.syncDraft();
  }, [live, showSettings, vod]);

  const isConfigured = mode === 'vod' ? Boolean(vod.source) : Boolean(live.source);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-[1520px] flex-col">
      {notice && (
        <div className="absolute right-0 top-0 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl',
              notice.kind === 'success' &&
                'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              notice.kind === 'warning' &&
                'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
              notice.kind === 'error' &&
                'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300',
            )}
          >
            {notice.kind === 'success' && <Check className="size-4" />}
            {notice.text}
          </div>
        </div>
      )}

      <header className="relative mb-4 flex shrink-0 items-center justify-between gap-4 px-1 py-2">
        {/* Left: Title */}
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">媒体中心</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">探索影视点播与电视直播内容。</p>
        </div>

        {/* Mode Toggle - absolutely centered so it never shifts */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative flex shrink-0 rounded-2xl border border-white/20 bg-white/20 dark:bg-black/20 p-1 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.2)] backdrop-blur-2xl">
            <div
              className="absolute top-1 bottom-1 rounded-xl bg-gradient-to-r from-primary to-blue-500 shadow-md transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ left: mode === 'vod' ? '4px' : 'calc(50% + 2px)', width: 'calc(50% - 6px)' }}
            />
            <button
              onClick={() => setMode('vod')}
              className={cn(
                'relative z-10 flex items-center gap-2 rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300',
                mode === 'vod' ? 'text-white drop-shadow-sm' : 'text-foreground/70 hover:text-foreground',
              )}
            >
              <Play className="size-4" />
              影视点播
            </button>
            <button
              onClick={() => setMode('live')}
              className={cn(
                'relative z-10 flex items-center gap-2 rounded-xl px-4 py-1.5 text-sm font-semibold transition-all duration-300',
                mode === 'live' ? 'text-white drop-shadow-sm' : 'text-foreground/70 hover:text-foreground',
              )}
            >
              <Tv className="size-4" />
              电视直播
            </button>
          </div>
        </div>

        {/* Right: Actions - flex-1 so it mirrors the left and keeps toggle centered */}
        <div className="flex flex-1 items-center justify-end gap-2">
          {isConfigured && mode === 'vod' && (
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
            onClick={() => setShowSettings(true)}
            className="z-40 inline-flex items-center justify-center rounded-xl bg-muted/60 p-2.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
            aria-label="媒体设置"
            title="配置媒体源地址"
          >
            <Settings2 className="size-5" />
          </button>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 flex-col gap-2 overflow-hidden">

        {!isConfigured ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center animate-in zoom-in-95 fade-in duration-500">
            <div className="relative mb-8 flex h-32 w-32 items-center justify-center rounded-[32px] border border-white/20 bg-gradient-to-br from-white/20 to-transparent shadow-[0_24px_54px_-16px_rgba(0,0,0,0.2)] backdrop-blur-xl">
              <div className="absolute inset-0 rounded-[32px] bg-primary/10 blur-xl pointer-events-none animate-pulse duration-3000"></div>
              {mode === 'vod' ? (
                <Play className="relative z-10 size-12 text-primary/80 drop-shadow-md" />
              ) : (
                <Tv className="relative z-10 size-12 text-primary/80 drop-shadow-md" />
              )}
            </div>
            <h2 className="mb-3 text-[28px] font-black tracking-tight text-foreground/90">
              {mode === 'vod' ? '尚未配置点播源' : '尚未配置直播源'}
            </h2>
            <p className="mb-10 max-w-[400px] text-[15px] font-medium leading-relaxed text-muted-foreground/80">
              在您开始享受极佳的观影体验之前，请先为您配置一个可用的高效媒体源地址。
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="group relative flex items-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-primary to-blue-600 px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_16px_32px_-12px_rgba(var(--primary),0.5)] transition-all duration-300 hover:scale-105 hover:shadow-[0_24px_48px_-12px_rgba(var(--primary),0.6)] active:scale-95"
            >
              <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity group-hover:opacity-100"></div>
              <Settings2 className="relative z-10 size-5" />
              <span className="relative z-10">立即开启设置</span>
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-1 flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            {mode === 'vod' && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex flex-1 overflow-hidden pt-1">
                  <VodWorkbenchPanel
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

            {mode === 'live' && (
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
                      initialGroup: live.activeGroup || live.currentGroup?.groupName || '',
                      initialChannel: channel,
                      initialLineIndex: 0,
                      initialKernelMode: 'mpv',
                    }).catch((reason: unknown) => {
                      const message = reason instanceof Error ? reason.message : String(reason);
                      showNotice({ kind: 'error', text: `打开播放窗口失败: ${message}` });
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
        onOpenChange={setShowSettings}
        onDraftChange={(target, value) => {
          if (target === 'vod') {
            vod.setDraft(value);
          } else {
            live.setDraft(value);
          }
        }}
        onClear={(target) => {
          if (target === 'vod') {
            vod.clearSource();
          } else {
            live.clearSource();
          }
        }}
        onSave={(target) => {
          if (target === 'vod') {
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
          spider={vod.config?.spider ?? ''}
          onClose={() => vod.setSelectedVodId(null)}
          onPlay={() => vod.setSelectedVodId(null)}
          onPlayWithDetail={(detail, routes, routeIdx, episodeIdx, extInput) => {
            const site = vod.activeVodSite;
            if (!site) return;
            vod.setSelectedVodId(null);
            void vod.openVodFromDetail(site, extInput, detail, routes, routeIdx, episodeIdx);
            showNotice({ kind: 'success', text: '正在启动内核播放...' });
          }}
          onSearchOnlyPlay={async (keyword) => {
            await vod.resolveMsearchAndPlay(keyword);
          }}
        />
      )}
    </div>
  );
}
