import type { ReactNode } from "react";
import { Info, Play, Search, X } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { NormalizedTvBoxSite, TvBoxClass, TvBoxVodItem } from "@/modules/media/types/tvbox.types";

interface VodBrowsePanelProps {
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
  onVodSearchKeywordChange: (value: string) => void;
  onClassClick: (id: string) => void;
  onSearchSubmit: () => void;
  onSearchReset: () => void;
  onLoadMore: () => void;
  onSelectVod: (id: string) => void;
  renderVodImage: (item: TvBoxVodItem) => ReactNode;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full flex flex-col items-center gap-4 py-20 text-center text-sm text-muted-foreground">
      <Info className="size-10 text-muted-foreground/30" />
      {text}
    </div>
  );
}

export function VodBrowsePanel({
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
}: VodBrowsePanelProps) {
  const canSearch = activeSite?.capability.canSearch ?? false;
  const canCategory = activeSite?.capability.canCategory ?? false;
  const isSearchOnly = activeSite?.capability.searchOnly ?? false;
  const isSearchMode = !!activeSearchKeyword;

  return (
    <div className="flex h-full w-full animate-in fade-in duration-500 overflow-hidden">
      {canCategory && !isSearchMode && (
        <div className="custom-scrollbar mr-6 flex w-60 shrink-0 flex-col overflow-y-auto rounded-3xl border border-white/5 bg-black/20 p-3 backdrop-blur-xl">
          <div className="mb-4 px-2 pt-2">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                value={classFilterKeyword}
                onChange={(event) => onClassFilterChange(event.target.value)}
                placeholder="快速筛选分类..."
                disabled={!canCategory || isSearchMode}
                className="w-full rounded-2xl border border-white/5 bg-white/5 py-2.5 pl-9 pr-4 text-sm outline-none transition-all placeholder:text-muted-foreground/40 focus:bg-white/10 focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>
          
          <div className="flex flex-col gap-1.5">
            {filteredVodClasses.length > 0 && filteredVodClasses.map((cls) => (
              <button
                key={cls.type_id}
                onClick={() => onClassClick(cls.type_id)}
                className={cn(
                  "group relative flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-all duration-300",
                  activeClassId === cls.type_id
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_rgba(var(--primary),0.2)]"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
                )}
              >
                <span className="relative z-10 block truncate font-semibold tracking-wide">{cls.type_name}</span>
                {activeClassId === cls.type_id && (
                   <div className="size-1.5 rounded-full bg-primary-foreground/50" />
                )}
                {activeClassId !== cls.type_id && (
                   <div className="size-1.5 rounded-full bg-white/5 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </button>
            ))}
          </div>
          
          {filteredVodClasses.length === 0 && !loadingVod && (
            <div className="mt-8 flex flex-col items-center justify-center px-4 text-center">
               <Info className="mb-2 size-6 text-muted-foreground/20" />
               <div className="text-xs text-zinc-500">无匹配分类喵~</div>
            </div>
          )}

          {loadingVod && (
            <div className="mt-2 flex flex-col gap-2 p-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-12 w-full shrink-0 animate-pulse rounded-2xl bg-white/5" />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="custom-scrollbar flex flex-1 flex-col gap-6 overflow-y-auto pb-10 pr-2">
        <div className="rounded-3xl border border-white/5 bg-black/40 p-5 backdrop-blur-md shadow-2xl">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <input
                value={vodSearchKeyword}
                onChange={(event) => onVodSearchKeywordChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSearchSubmit();
                }}
                placeholder={canSearch ? "输入片名、演员或内容关键词..." : "当前站点不支持搜索喵~"}
                disabled={!canSearch}
                className="w-full rounded-2xl border border-white/5 bg-white/5 py-3 pl-12 pr-4 text-base outline-none transition-all placeholder:text-muted-foreground/30 focus:bg-white/10 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={onSearchSubmit}
                disabled={!canSearch || !vodSearchKeyword.trim()}
                className="rounded-2xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-105 hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:scale-100"
              >
                全网搜
              </button>
              {isSearchMode && (
                <button
                  onClick={onSearchReset}
                  className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold transition-all hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 active:scale-95"
                >
                  <X className="size-4" />
                  重置
                </button>
              )}
            </div>
          </div>
          {isSearchMode && (
            <div className="mt-4 flex items-center gap-2 px-1">
              <div className="size-1.5 rounded-full bg-primary animate-pulse" />
              <div className="text-xs font-medium text-muted-foreground">
                正在展示 <span className="text-foreground underline decoration-primary/30 underline-offset-4">“{activeSearchKeyword}”</span> 的结果喵~
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {!loadingVod && vodList.length > 0 && vodList.map((item) => (
          <Card
            key={item.vod_id}
            onClick={() => detailEnabled && onSelectVod(item.vod_id)}
            className={cn(
              "relative flex aspect-[3/4.2] flex-col items-center justify-center overflow-hidden rounded-[2rem] border-none p-0 transition-all duration-500",
              detailEnabled
                ? "group cursor-pointer hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)]"
                : "cursor-not-allowed opacity-60",
            )}
          >
            <div className="absolute inset-0 bg-white/5" />
            
            <div className="h-full w-full grayscale-[0.2] transition-all duration-700 group-hover:scale-110 group-hover:grayscale-0">
               {renderVodImage(item)}
            </div>

            <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent opacity-80 transition-opacity duration-500 group-hover:opacity-100" />

            <div className="absolute right-3 top-3 overflow-hidden rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-[10px] font-bold text-white/90 shadow-2xl backdrop-blur-xl transition-all duration-300 group-hover:bg-primary/90 group-hover:text-primary-foreground group-hover:border-primary/50 group-hover:scale-105">
              {item.vod_remarks || "正片"}
            </div>

            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-500 group-hover:opacity-100 group-hover:scale-100 scale-75">
               <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/20 backdrop-blur-2xl border border-primary/30 text-primary shadow-[0_0_30px_rgba(var(--primary),0.3)]">
                 <Play className="size-8 ml-1 fill-primary drop-shadow-2xl" />
               </div>
            </div>

            <div className="absolute bottom-6 left-5 right-5 z-20 flex flex-col gap-1 transition-transform duration-500 group-hover:-translate-y-1">
              <span className="truncate text-lg font-black tracking-tight text-white drop-shadow-2xl group-hover:text-primary transition-colors">
                {item.vod_name}
              </span>
              <div className="h-0.5 w-8 rounded-full bg-primary/0 transition-all duration-500 group-hover:bg-primary group-hover:w-12" />
            </div>

            {!detailEnabled && (
              <div className="absolute inset-x-4 bottom-16 rounded-2xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-center text-[10px] font-bold text-red-400 backdrop-blur-md">
                此节点暂不支持详情喵~
              </div>
            )}
            
            <div className="absolute inset-0 rounded-[2rem] border border-white/5 pointer-events-none group-hover:border-primary/30 transition-colors duration-500" />
          </Card>
        ))}

        {loadingVod && Array.from({ length: 10 }).map((_, index) => (
          <Card key={index} className="aspect-[3/4] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ))}

        {!loadingVod && vodList.length === 0 && isSearchOnly && !isSearchMode && (
          <EmptyState text="该站点属于搜索型入口，请先输入关键词后再获取结果。" />
        )}
        {!loadingVod && vodList.length === 0 && !isSearchOnly && isSearchMode && (
          <EmptyState text="这次搜索没有返回结果，可以换关键词或切换站点继续试。" />
        )}
        {!loadingVod && vodList.length === 0 && !isSearchOnly && !isSearchMode && activeSite && (
          <EmptyState text={canCategory ? "该分类下暂无内容，或需要手动切换其他分类。" : "当前站点没有返回可展示内容。"} />
        )}
      </div>

      {activeClassId && !isSearchMode && !loadingVod && canCategory && (
        <div className="mt-4 flex w-full justify-center">
          {hasMore ? (
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm font-medium backdrop-blur transition-all hover:bg-white/10 hover:text-primary active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </button>
          ) : (
            vodList.length > 0 && <span className="text-xs text-muted-foreground/50">没有更多内容了。</span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
