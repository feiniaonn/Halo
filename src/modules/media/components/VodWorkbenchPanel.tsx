import type { ReactNode } from 'react';
import { Clapperboard, Loader2, Play, RotateCcw, Search } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type {
  NormalizedTvBoxSite,
  TvBoxClass,
  TvBoxVodItem,
} from '@/modules/media/types/tvbox.types';

interface VodWorkbenchPanelProps {
  activeSite: NormalizedTvBoxSite | null;
  activeClassId: string;
  filteredVodClasses: TvBoxClass[];
  classFilterKeyword: string;
  vodSearchKeyword: string;
  activeSearchKeyword: string;
  loadingVod: boolean;
  loadingMore: boolean;
  vodList: TvBoxVodItem[];
  hasMore: boolean;
  detailEnabled: boolean;
  onClassFilterChange: (value: string) => void;
  onVodSearchKeywordChange?: (value: string) => void;
  onClassClick: (id: string) => void;
  onSearchSubmit?: () => void;
  onSearchReset?: () => void;
  onLoadMore: () => void;
  onSelectVod: (id: string) => void;
  renderVodImage: (item: TvBoxVodItem) => ReactNode;
}

function EmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Clapperboard;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center text-muted-foreground w-full">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted/50">
        <Icon className="size-6 text-muted-foreground/80" />
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-foreground text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function VodWorkbenchPanel({
  activeSite,
  activeClassId,
  filteredVodClasses,
  classFilterKeyword,
  vodSearchKeyword,
  activeSearchKeyword,
  loadingVod,
  loadingMore,
  vodList,
  hasMore,
  detailEnabled,
  onClassFilterChange,
  onVodSearchKeywordChange,
  onClassClick,
  onSearchSubmit,
  onSearchReset,
  onLoadMore,
  onSelectVod,
  renderVodImage,
}: VodWorkbenchPanelProps) {
  const canCategory = activeSite?.capability.canCategory ?? false;
  const canSearch = activeSite?.capability.canSearch ?? false;
  const isSearchOnly = activeSite?.capability.searchOnly ?? false;
  const isSearchMode = Boolean(activeSearchKeyword);

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-transparent relative overflow-hidden">
      {/* Top Bar: Title & Site badge */}
      <div className="flex-none border-b bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-3 sticky top-0 z-20">
        <h2 className="text-base font-semibold tracking-tight text-foreground shrink-0">影视资源点播</h2>
        {activeSite && (
          <span className="truncate text-xs text-muted-foreground">
            源: {activeSite.name}
          </span>
        )}
        <div className="flex shrink-0 gap-1.5 ml-auto">
          {isSearchMode && (
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              搜索中: {activeSearchKeyword}
            </span>
          )}
          {!detailEnabled && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
              接口不支持详情
            </span>
          )}
        </div>
      </div>

      {canSearch && (
        <div className="flex-none border-b bg-muted/15 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={vodSearchKeyword}
                onChange={(event) => onVodSearchKeywordChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onSearchSubmit?.();
                  }
                }}
                placeholder={isSearchOnly ? '输入片名后按回车搜索' : '搜索当前接口影视'}
                className="h-10 w-full rounded-xl border border-border/60 bg-background/86 pl-10 pr-4 text-sm outline-none transition-colors focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => onSearchSubmit?.()}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Search className="size-4" />
              搜索
            </button>
            {isSearchMode && (
              <button
                type="button"
                onClick={() => onSearchReset?.()}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-background/80 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <RotateCcw className="size-4" />
                重置
              </button>
            )}
          </div>
        </div>
      )}

      {/* Second Bar: Categories Rail */}
      {canCategory && !isSearchMode && (
        <div className="flex-none border-b bg-muted/20 px-4 py-2 flex items-center gap-3">
          {/* Quick filter for categories if there are many */}
          <div className="w-40 shrink-0 border-r pr-3">
            <input
              type="text"
              placeholder="过滤分类..."
              className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs outline-none focus:border-primary"
              value={classFilterKeyword}
              onChange={(e) => onClassFilterChange(e.target.value)}
            />
          </div>
          
          <ScrollArea className="w-full whitespace-nowrap" type="hover">
            <div className="flex w-max space-x-2 px-1 py-1">
              {filteredVodClasses.length > 0 ? (
                filteredVodClasses.map((cls) => {
                  const active = activeClassId === cls.type_id;
                  return (
                    <button
                      key={cls.type_id}
                      onClick={() => onClassClick(cls.type_id)}
                      className={cn(
                        "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                        active 
                          ? "bg-primary text-primary-foreground shadow" 
                          : "bg-transparent hover:bg-muted text-foreground"
                      )}
                    >
                      {cls.type_name}
                    </button>
                  );
                })
              ) : (
                <div className="text-xs text-muted-foreground py-1.5 px-2">
                  无匹配分类
                </div>
              )}
            </div>
            <ScrollBar orientation="horizontal" className="invisible group-hover/scroll-area:visible" />
          </ScrollArea>
        </div>
      )}

      {/* Main Content Grid Area */}
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full">
          <div className="p-3 lg:p-4 space-y-4">
            
            <div className="flex items-center justify-between outline-none">
               <h3 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                 {isSearchMode ? "相关搜索结果" : activeClassId ? "分类影片" : "推荐影片"}
                 {vodList.length > 0 && (
                   <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                     已加载 {vodList.length} 部
                   </span>
                 )}
               </h3>
            </div>

            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-x-3 gap-y-4">
              {loadingVod ? (
                Array.from({ length: 12 }).map((_, index) => (
                  <div key={index} className="flex flex-col gap-1.5">
                    <div className="aspect-[0.72] w-full animate-pulse rounded-md bg-muted" />
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  </div>
                ))
              ) : vodList.length > 0 ? (
                vodList.map((item) => (
                  <div
                    key={item.vod_id}
                    className={cn(
                      'group relative flex flex-col gap-2 outline-none',
                      detailEnabled ? 'cursor-pointer' : 'cursor-default opacity-80'
                    )}
                    onClick={() => detailEnabled && onSelectVod(item.vod_id)}
                    role="button"
                    tabIndex={detailEnabled ? 0 : -1}
                  >
                    <div className="relative aspect-[0.72] w-full overflow-hidden rounded-lg bg-muted border shadow-sm transition-all duration-300 group-hover:shadow-md">
                      <div className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105">
                        {renderVodImage(item)}
                      </div>
                      
                      {/* Overlay gradients and icons for hover interaction */}
                      {detailEnabled && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100 flex items-center justify-center">
                          <div className="flex items-center justify-center size-10 rounded-full bg-primary/90 text-primary-foreground transform scale-75 opacity-0 transition-all duration-300 group-hover:scale-100 group-hover:opacity-100 shadow-xl">
                            <Play className="size-4 ml-0.5" />
                          </div>
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-1.5 left-1.5 right-1.5 flex justify-between items-start gap-1 pointer-events-none">
                        <span className="rounded-full bg-black/60 text-white font-semibold text-[9px] px-1.5 py-0.5 leading-none">
                          {item.vod_remarks || '高清'}
                        </span>
                        {!detailEnabled && (
                          <span className="rounded-full bg-destructive text-destructive-foreground text-[9px] px-1.5 py-0.5 leading-none">
                            无详情
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-0.5 py-0.5">
                       <h4 className="font-medium text-xs leading-tight line-clamp-1 text-foreground" title={item.vod_name}>
                         {item.vod_name}
                       </h4>
                     </div>
                  </div>
                ))
              ) : isSearchOnly && !isSearchMode ? (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="等待搜索指令"
                    description="此接口需要关键词搜索，无默认内容列表。"
                    icon={Clapperboard}
                  />
                </div>
              ) : isSearchMode ? (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="没有找到结果"
                    description={`未找到关于 "${activeSearchKeyword}" 的影视资源。`}
                    icon={Clapperboard}
                  />
                </div>
              ) : (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="暂无内容"
                    description="选定的分类目前没有任何资源可显示。"
                    icon={Clapperboard}
                  />
                </div>
              )}
            </div>

            {/* Load More Section */}
            {vodList.length > 0 && hasMore && (
              <div className="pt-8 pb-4 flex justify-center w-full">
                <button
                  className="flex w-full max-w-sm items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      加载中...
                    </>
                  ) : (
                    '加载更多影片'
                  )}
                </button>
              </div>
            )}
            {vodList.length > 0 && !hasMore && !loadingVod && (
              <div className="pt-8 pb-4 text-center text-sm font-medium text-muted-foreground w-full">
                已经到底了，没有更多影片啦。
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
