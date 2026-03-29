import type { ReactNode } from "react";
import { Clapperboard, Loader2, Play, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  NormalizedTvBoxSite,
  TvBoxClass,
  VodAggregateSessionState,
  VodBrowseItem,
  VodBrowseMode,
} from "@/modules/media/types/tvbox.types";

interface VodWorkbenchPanelProps {
  activeSite: NormalizedTvBoxSite | null;
  browseMode: VodBrowseMode;
  supportsAggregateBrowse: boolean;
  aggregateSessionState: VodAggregateSessionState | null;
  activeClassId: string;
  filteredVodClasses: TvBoxClass[];
  classFilterKeyword: string;
  vodSearchKeyword: string;
  activeSearchKeyword: string;
  loadingVod: boolean;
  loadingMore: boolean;
  vodList: VodBrowseItem[];
  hasMore: boolean;
  detailEnabled: boolean;
  onClassFilterChange: (value: string) => void;
  onVodSearchKeywordChange?: (value: string) => void;
  onClassClick: (id: string) => void;
  onBrowseModeChange?: (mode: VodBrowseMode) => void;
  onSearchSubmit?: () => void;
  onSearchReset?: () => void;
  onLoadMore: () => void;
  onSelectVod: (item: VodBrowseItem) => void;
  renderVodImage: (item: VodBrowseItem) => ReactNode;
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
    <div className="flex w-full flex-col items-center justify-center gap-4 py-18 text-center">
      <div className="flex size-14 items-center justify-center rounded-[calc(var(--radius-2xl)-4px)] border border-border bg-muted/30 text-muted-foreground shadow-sm">
        <Icon className="size-6" />
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PanelTag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "danger";
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "halo-media-panel-tag inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "primary" && "border-primary/18 bg-primary/10 text-primary",
        tone === "danger" && "border-rose-500/20 bg-rose-500/10 text-rose-500",
        tone === "neutral" && "border-border bg-muted/30 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function VodWorkbenchPanel({
  activeSite,
  browseMode,
  supportsAggregateBrowse,
  aggregateSessionState,
  activeClassId,
  filteredVodClasses,
  vodSearchKeyword,
  activeSearchKeyword,
  loadingVod,
  loadingMore,
  vodList,
  hasMore,
  detailEnabled,
  onVodSearchKeywordChange,
  onClassClick,
  onBrowseModeChange,
  onSearchSubmit,
  onSearchReset,
  onLoadMore,
  onSelectVod,
  renderVodImage,
}: VodWorkbenchPanelProps) {
  const canCategory = activeSite?.capability.canCategory ?? false;
  const canSearch = activeSite?.capability.canSearch ?? false;
  const isSearchOnly = activeSite?.capability.searchOnly ?? false;
  const isDisplayOnlySite = activeSite?.capability.dispatchRole === "origin-metadata";
  const desktopUnsupportedReason = activeSite?.capability.desktopUnsupportedReason?.trim() ?? "";
  const isSearchMode = Boolean(activeSearchKeyword);
  const isAggregateMode = browseMode === "aggregate";
  const aggregateProgressText = aggregateSessionState
    ? `${aggregateSessionState.completedCount}/${aggregateSessionState.siteCount}`
    : null;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-3xl)] border border-border bg-card/40 backdrop-blur-xl shadow-sm">
      <div className="relative flex-none border-b border-border px-5 py-3">
        <div className="relative flex flex-col gap-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap items-center gap-2">
              {activeSite && (
                <PanelTag>{isAggregateMode ? `优先：${activeSite.name}` : `当前：${activeSite.name}`}</PanelTag>
              )}
              {isDisplayOnlySite && <PanelTag tone="primary">仅展示</PanelTag>}
              {isAggregateMode && aggregateProgressText && <PanelTag>搜索进度：{aggregateProgressText}</PanelTag>}
              {isSearchMode && <PanelTag tone="primary">搜索：{activeSearchKeyword}</PanelTag>}
              {desktopUnsupportedReason && <PanelTag tone="danger">桌面端不支持</PanelTag>}
              {!detailEnabled && <PanelTag tone="danger">不支持详情</PanelTag>}
            </div>

            <div className="flex items-center gap-4">
              {canSearch && (
                <div className="flex items-center gap-2">
                  <div className="relative w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="text"
                      value={vodSearchKeyword}
                      onChange={(event) => onVodSearchKeywordChange?.(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onSearchSubmit?.();
                      }}
                      placeholder={isAggregateMode ? "搜索全仓..." : "搜索本站..."}
                      className="h-8 border-border/50 bg-background/40 pl-9 text-xs shadow-sm backdrop-blur-xl"
                    />
                  </div>
                  <Button
                    onClick={() => onSearchSubmit?.()}
                    size="sm"
                    className="h-8 bg-primary/80 px-4 text-xs backdrop-blur-md"
                  >
                    搜索
                  </Button>
                  {isSearchMode && (
                    <Button variant="ghost" onClick={() => onSearchReset?.()} size="sm" className="h-8 px-3 text-xs">
                      <RotateCcw className="mr-2 size-3" />
                      重置
                    </Button>
                  )}
                </div>
              )}

              {supportsAggregateBrowse && (
                <div className="inline-flex rounded-lg border border-border bg-background p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => onBrowseModeChange?.("site")}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200",
                      !isAggregateMode
                        ? "bg-muted text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    单站
                  </button>
                  <button
                    type="button"
                    onClick={() => onBrowseModeChange?.("aggregate")}
                    className={cn(
                      "rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200",
                      isAggregateMode
                        ? "bg-muted text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    聚合
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {canCategory && !isSearchMode && (
        <div className="flex-none border-b border-border px-5 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <ScrollArea className="w-full whitespace-nowrap" type="hover">
              <div className="flex w-max items-center gap-2 px-1 py-1">
                {filteredVodClasses.length > 0 ? (
                  filteredVodClasses.map((cls) => {
                    const active = activeClassId === cls.type_id;
                    return (
                      <button
                        key={cls.type_id}
                        type="button"
                        onClick={() => onClassClick(cls.type_id)}
                        className={cn(
                          "halo-interactive halo-focusable rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-200",
                          active
                            ? "bg-muted text-foreground shadow-sm ring-1 ring-border"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        {cls.type_name}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 text-xs text-muted-foreground">没有匹配的分类</div>
                )}
              </div>
              <ScrollBar orientation="horizontal" className="invisible group-hover/scroll-area:visible" />
            </ScrollArea>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="space-y-5 p-4 lg:p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-[0.04em] text-foreground/82">
                {isSearchMode
                  ? isAggregateMode
                    ? "聚合搜索结果"
                    : "搜索结果"
                  : activeClassId
                    ? "当前分类内容"
                    : "推荐内容"}
              </h3>

              {vodList.length > 0 && <PanelTag>已加载 {vodList.length} 项</PanelTag>}
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
              {loadingVod && vodList.length === 0 ? (
                Array.from({ length: 12 }).map((_, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <div className="halo-skeleton aspect-[0.72] rounded-[calc(var(--radius-xl)-6px)]" />
                    <div className="halo-skeleton h-3 w-3/4 rounded-full" />
                  </div>
                ))
              ) : vodList.length > 0 ? (
                vodList.map((item) => (
                  <div
                    key={"aggregateSource" in item ? `${item.aggregateSource.siteKey}::${item.vod_id}` : item.vod_id}
                    className="group outline-none"
                    onClick={() => onSelectVod(item)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="relative aspect-[0.72] overflow-hidden rounded-[calc(var(--radius-2xl)-6px)] border border-border bg-muted shadow-sm transition-transform duration-300 group-hover:-translate-y-1">
                        <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]">
                          {renderVodImage(item)}
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          <div className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--halo-shadow-glow)]">
                            <Play className="ml-0.5 size-4" />
                          </div>
                        </div>

                        <div className="absolute left-2 right-2 top-2 flex items-start justify-between gap-2">
                          <div className="flex flex-wrap gap-1">
                            {isDisplayOnlySite && !("aggregateSource" in item) && (
                              <span className="rounded-full bg-sky-500/90 px-2 py-0.5 text-[9px] font-semibold text-white">
                                仅展示
                              </span>
                            )}
                            {"aggregateSource" in item && (
                              <span className="rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-semibold text-primary-foreground">
                                {item.aggregateSource.siteName}
                              </span>
                            )}
                          </div>

                          <span className="rounded-full bg-black/58 px-2 py-0.5 text-[9px] font-semibold text-white">
                            {item.vod_remarks || "高清"}
                          </span>
                        </div>

                        {!detailEnabled && (
                          <div className="absolute bottom-2 left-2">
                            <span className="rounded-full bg-rose-500/90 px-2 py-0.5 text-[9px] font-semibold text-white">
                              无详情
                            </span>
                          </div>
                        )}
                      </div>

                      <div>
                        <h4 className="line-clamp-2 text-[13px] font-semibold leading-5 text-foreground" title={item.vod_name}>
                          {item.vod_name}
                        </h4>
                      </div>
                    </div>
                  </div>
                ))
              ) : desktopUnsupportedReason ? (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="桌面端暂不支持该接口"
                    description={desktopUnsupportedReason}
                    icon={Clapperboard}
                  />
                </div>
              ) : isSearchOnly && !isSearchMode ? (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="等待搜索指令"
                    description="当前接口没有默认内容列表，请输入片名后再进行搜索。"
                    icon={Clapperboard}
                  />
                </div>
              ) : isSearchMode ? (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="没有找到匹配结果"
                    description={
                      isAggregateMode
                        ? `当前分仓的聚合结果中没有找到“${activeSearchKeyword}”。`
                        : `当前接口没有返回与“${activeSearchKeyword}”相关的结果。`
                    }
                    icon={Clapperboard}
                  />
                </div>
              ) : (
                <div className="col-span-full py-10">
                  <EmptyState
                    title="当前分类暂无内容"
                    description="换一个分类试试，或者切到搜索模式获取目标片源。"
                    icon={Clapperboard}
                  />
                </div>
              )}
            </div>

            {vodList.length > 0 && hasMore && (
              <div className="flex justify-center pb-2 pt-6">
                <Button variant="outline" size="lg" className="w-full max-w-sm" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      正在加载...
                    </>
                  ) : (
                    "加载更多"
                  )}
                </Button>
              </div>
            )}

            {vodList.length > 0 && !hasMore && !loadingVod && (
              <div className="pb-2 pt-4 text-center text-sm font-medium text-muted-foreground">
                已经到底了，没有更多内容。
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
