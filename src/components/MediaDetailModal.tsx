import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Film, Loader2, Play, Search } from "lucide-react";

import { VodProxyImage } from "@/components/VodProxyImage";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

interface MediaDetailModalProps {
  vodId: string;
  site: NormalizedTvBoxSite;
  spider: string;
  onClose: () => void;
  onPlay: (flag: string, id: string, title: string) => void;
  onPlayWithDetail?: (
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx: number,
    epIdx: number,
    extInput: string,
  ) => void;
  onSearchOnlyPlay?: (keyword: string, fallbackTitle: string) => Promise<void> | void;
}

function extractMsearchKeyword(url: string): string {
  if (!url.startsWith("msearch:")) return "";
  const raw = url.slice("msearch:".length).trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

export function MediaDetailModal({
  vodId,
  site,
  spider,
  onClose,
  onPlay,
  onPlayWithDetail,
  onSearchOnlyPlay,
}: MediaDetailModalProps) {
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [resolvedExt, setResolvedExt] = useState("");
  const [routes, setRoutes] = useState<VodRoute[]>([]);
  const [activeRouteIdx, setActiveRouteIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playWarning, setPlayWarning] = useState<string | null>(null);
  const [searchResolving, setSearchResolving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setPlayWarning(null);

    fetchVodDetail({ site, spider }, vodId)
      .then((result) => {
        if (!mounted) return;
        setDetail(result.detail);
        setRoutes(result.routes);
        setResolvedExt(result.extInput);
        if (result.routes.length === 0) {
          setPlayWarning("当前详情已加载，但还没有可播放线路。");
        }
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message || "详情解析失败。");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [site, spider, vodId]);

  const activeRoute = useMemo(() => routes[activeRouteIdx] ?? null, [activeRouteIdx, routes]);

  const handleEpisodePlay = async (routeName: string, episodeName: string, episodeUrl: string, searchOnly: boolean) => {
    if (searchResolving) return;
    if (searchOnly) {
      const keyword = extractMsearchKeyword(episodeUrl) || detail?.vod_name || episodeName;
      if (!onSearchOnlyPlay) {
        setPlayWarning("该线路仅提供站外搜索入口，当前没有启用跨站搜索播放。");
        return;
      }
      setSearchResolving(true);
      setPlayWarning(`正在跨站搜索可播放节点：${keyword}`);
      try {
        await onSearchOnlyPlay(keyword, detail?.vod_name || episodeName);
        setPlayWarning(null);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setPlayWarning(`跨站搜索失败：${message}`);
      } finally {
        setSearchResolving(false);
      }
      return;
    }

    setPlayWarning(null);
    if (detail && onPlayWithDetail) {
      const routeIdx = routes.findIndex((route) => route.sourceName === routeName);
      const resolvedRouteIdx = routeIdx >= 0 ? routeIdx : 0;
      const episodeIdx = routes[resolvedRouteIdx]?.episodes.findIndex((episode) => episode.url === episodeUrl) ?? 0;
      onPlayWithDetail(detail, routes, resolvedRouteIdx, Math.max(episodeIdx, 0), resolvedExt);
      return;
    }

    onPlay(routeName, episodeUrl, episodeName);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[85vh] p-0 overflow-hidden rounded-[2.5rem] border-white/20 bg-background/90 shadow-2xl backdrop-blur-3xl gap-0">
        <div className="relative flex h-full w-full flex-col">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="size-12 animate-spin text-primary" />
              <span className="text-sm font-medium">正在解析详情数据...</span>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <AlertCircle className="mb-4 size-16 text-red-500/80" />
              <p className="mb-2 text-lg font-bold tracking-tight text-red-500">详情解析失败</p>
              <p className="max-w-xl text-sm text-muted-foreground">{error}</p>
            </div>
          ) : !detail ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <Film className="mb-4 size-16 text-white/20" />
              <p className="text-lg font-bold tracking-tight">未获取到影视详情</p>
            </div>
          ) : (
            <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
              <div className="relative overflow-hidden border-b border-white/10 lg:border-b-0 lg:border-r">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-cyan-500/5" />
                <ScrollArea className="h-full">
                  <div className="relative p-6 lg:p-8">
                    <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl">
                      <VodProxyImage
                        src={detail.vod_pic || ""}
                        alt={detail.vod_name}
                        className="aspect-[3/4] w-full"
                      />
                    </div>

                    <div className="mt-6 space-y-3">
                      <div>
                        <h2 className="text-2xl font-semibold tracking-tight">{detail.vod_name}</h2>
                        <p className="mt-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                          {site.name} · {site.capability.sourceKind === "spider" ? "Spider" : "CMS"}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">年份</div>
                          <div className="mt-1 text-foreground">{detail.vod_year || "未知"}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">地区</div>
                          <div className="mt-1 text-foreground">{detail.vod_area || "未知"}</div>
                        </div>
                      </div>

                      {detail.vod_actor && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">主演</div>
                          <div className="mt-1 leading-6 text-foreground/90">{detail.vod_actor}</div>
                        </div>
                      )}

                      {detail.vod_director && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">导演</div>
                          <div className="mt-1 leading-6 text-foreground/90">{detail.vod_director}</div>
                        </div>
                      )}

                      {detail.vod_content && (
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">简介</div>
                          <p className="mt-2 whitespace-pre-wrap text-foreground/80">{detail.vod_content}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </div>

              <div className="flex min-h-0 flex-col bg-black/5">
                <div className="border-b border-white/10 px-6 py-5 lg:px-8">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight">播放线路</h3>
                      <p className="mt-1 text-xs text-muted-foreground">支持 Spider 与 CMS 站点共用详情界面。</p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted-foreground">
                      共 {routes.length} 条线路
                    </div>
                  </div>

                  {playWarning && (
                    <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                      {searchResolving ? (
                        <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{playWarning}</span>
                      ) : playWarning}
                    </div>
                  )}
                </div>

                <div className="border-b border-white/10 px-6 py-4 lg:px-8">
                  <div className="flex flex-wrap gap-3">
                    {routes.map((route, index) => (
                      <button
                        key={`${route.sourceName}-${index}`}
                        onClick={() => setActiveRouteIdx(index)}
                        className={cn(
                          "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                          index === activeRouteIdx
                            ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                            : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground",
                        )}
                      >
                        {route.sourceName}
                      </button>
                    ))}
                  </div>
                </div>

                <ScrollArea className="min-h-0 flex-1 px-6 py-5 lg:px-8">
                  {!activeRoute ? (
                    <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-[2rem] border border-dashed border-white/15 bg-white/5 text-center text-muted-foreground">
                      <Film className="mb-3 size-12 text-white/20" />
                      <p>当前详情没有可用播放线路。</p>
                    </div>
                  ) : (
                    <motion.div
                      key={activeRoute.sourceName}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22 }}
                      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
                    >
                      {activeRoute.episodes.map((episode, index) => (
                        <button
                          key={`${episode.url}-${index}`}
                          onClick={() => {
                            void handleEpisodePlay(activeRoute.sourceName, episode.name, episode.url, episode.searchOnly);
                          }}
                          className={cn(
                            "group flex min-h-24 flex-col items-start justify-between rounded-[1.6rem] border px-4 py-4 text-left transition-all duration-200",
                            episode.searchOnly
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
                              : "border-white/10 bg-white/5 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/10",
                          )}
                        >
                          <div className="line-clamp-2 text-sm font-medium leading-6">{episode.name}</div>
                          <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground group-hover:text-foreground">
                            {episode.searchOnly ? <Search className="size-3.5" /> : <Play className="size-3.5" />}
                            {episode.searchOnly ? "跨站搜索" : "立即播放"}
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
