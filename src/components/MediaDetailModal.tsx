import { useEffect, useState } from "react";
import { AlertCircle, Film, Loader2, X } from "lucide-react";

import { VodProxyImage } from "@/components/VodProxyImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import {
  normalizeVodImageUrl,
  proxyVodImage,
  shouldPreferProxyImage,
} from "@/modules/media/services/vodImageProxy";
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

function MetaBlock({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value?.trim()) return null;
  return (
    <div className="rounded-2xl border border-border/60 bg-background/72 p-3.5 shadow-[0_16px_34px_-28px_rgba(var(--primary),0.32)]">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm leading-6 text-foreground/90 whitespace-pre-wrap break-all">{value}</div>
    </div>
  );
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playWarning, setPlayWarning] = useState<string | null>(null);
  const [searchResolving, setSearchResolving] = useState(false);
  const [backgroundImageSrc, setBackgroundImageSrc] = useState("");

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
          setPlayWarning("当前详情已加载，但没有可播放的线路。");
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

  useEffect(() => {
    let mounted = true;
    const nextSrc = normalizeVodImageUrl(detail?.vod_pic ?? "");
    setBackgroundImageSrc(shouldPreferProxyImage(nextSrc) ? "" : nextSrc);

    if (!nextSrc || !shouldPreferProxyImage(nextSrc)) {
      return () => {
        mounted = false;
      };
    }

    void proxyVodImage(nextSrc).then((resolved) => {
      if (!mounted || !resolved) return;
      setBackgroundImageSrc(resolved);
    });

    return () => {
      mounted = false;
    };
  }, [detail?.vod_pic]);

  const handleEpisodePlay = async (routeName: string, episodeName: string, episodeUrl: string, searchOnly: boolean) => {
    if (searchResolving) return;

    if (searchOnly) {
      const keyword = extractMsearchKeyword(episodeUrl) || detail?.vod_name || episodeName;
      if (!onSearchOnlyPlay) {
        setPlayWarning("这条线路只提供跨站搜索入口，当前没有启用自动搜索播放。");
        return;
      }

      setSearchResolving(true);
      setPlayWarning(`正在跨站搜索可播放节点：${keyword}`);
      try {
        await onSearchOnlyPlay(keyword, detail?.vod_name || episodeName);
        setPlayWarning(null);
      } catch (reason: unknown) {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88vh,900px)] w-[min(1120px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-[28px] border-border/55 bg-background/92 p-0 shadow-[0_38px_120px_-56px_rgba(15,23,42,0.72)] backdrop-blur-2xl"
      >
        <DialogTitle className="sr-only">{detail?.vod_name || "影视详情"}</DialogTitle>

        <button
          onClick={onClose}
          className="absolute right-5 top-5 z-50 flex size-10 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground shadow-md backdrop-blur-xl transition-all hover:bg-accent hover:text-foreground hover:scale-110 active:scale-95"
          title="关闭窗口"
        >
          <X className="size-4.5" />
          <span className="sr-only">关闭</span>
        </button>

        {backgroundImageSrc && (
          <div
            className="pointer-events-none absolute inset-0 z-0 opacity-10 blur-3xl transition-opacity duration-1000"
            style={{
              backgroundImage: `url(${backgroundImageSrc})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}

        <div className="relative z-10 flex h-full min-h-0 flex-col">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <Loader2 className="size-10 animate-spin text-primary" />
              <span className="text-sm font-medium">正在加载详情…</span>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <AlertCircle className="mb-4 size-16 text-destructive/80" />
              <p className="mb-2 text-xl font-bold text-foreground">详情解析失败</p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground break-all">{error}</p>
            </div>
          ) : !detail ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <Film className="mb-4 size-16 text-muted-foreground/30" />
              <p className="text-xl font-bold text-muted-foreground">未获取到影视详情</p>
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-6 p-5 md:p-7">
                <div className="rounded-[30px] border border-border/55 bg-[linear-gradient(145deg,rgba(var(--primary),0.08),rgba(var(--background),0.82)_45%,rgba(var(--primary),0.03))] p-5 shadow-[0_24px_56px_-38px_rgba(var(--primary),0.74)]">
                  <div className="grid gap-5 sm:grid-cols-[130px_minmax(0,1fr)] lg:grid-cols-[150px_minmax(0,1fr)]">
                    <div className="overflow-hidden rounded-[20px] border border-white/55 bg-background/80 shadow-[0_18px_36px_-26px_rgba(15,23,42,0.52)] self-start">
                      <VodProxyImage
                        src={detail.vod_pic || ""}
                        alt={detail.vod_name}
                        className="aspect-[0.72] w-full object-cover"
                      />
                    </div>

                    <div className="min-w-0 space-y-4">
                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary/70">Selected Title</div>
                        <h2 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground whitespace-pre-wrap break-words md:text-[1.7rem]">
                          {detail.vod_name}
                        </h2>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Badge variant="outline" className="bg-background/70 shadow-sm">{site.name}</Badge>
                          <Badge variant="secondary" className="shadow-sm">
                            {site.capability.sourceKind === "spider" ? "Spider" : "CMS"}
                          </Badge>
                          {detail.vod_year && <Badge variant="outline" className="bg-background/40">{detail.vod_year}</Badge>}
                          {detail.vod_area && <Badge variant="outline" className="bg-background/40">{detail.vod_area}</Badge>}
                        </div>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-2">
                        <MetaBlock label="导演" value={detail.vod_director} />
                        <MetaBlock label="演员" value={detail.vod_actor} />
                      </div>
                    </div>
                  </div>
                </div>

                <MetaBlock label="剧情简介" value={detail.vod_content?.replace(/<[^>]*>?/gm, '').trim() || "暂无剧情简介"} />

                {playWarning && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 shadow-sm dark:text-amber-200">
                    {searchResolving ? <Loader2 className="mt-0.5 size-4 animate-spin" /> : <AlertCircle className="mt-0.5 size-4" />}
                    <span className="leading-6 break-all">{playWarning}</span>
                  </div>
                )}

                <Separator className="bg-border/55" />

                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/70">Routes</div>
                    <h3 className="text-base font-semibold text-foreground">播放线路</h3>
                    <p className="text-[13px] text-muted-foreground">选择线路及剧集进行播放。</p>
                  </div>

                  {routes.length > 0 ? (
                    <Tabs defaultValue={routes[0]?.sourceName || ""} className="w-full gap-4">
                      <ScrollArea className="w-full pb-2">
                        <TabsList className="mb-1 h-auto min-w-max gap-2 rounded-2xl border border-border/55 bg-background/74 p-1.5">
                          {routes.map((route) => (
                            <TabsTrigger
                              key={route.sourceName}
                              value={route.sourceName}
                              className="h-auto min-h-9 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-background"
                            >
                              {route.sourceName}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        <ScrollBar orientation="horizontal" className="h-1.5" />
                      </ScrollArea>

                      {routes.map((route) => (
                        <TabsContent key={route.sourceName} value={route.sourceName} className="mt-0 outline-none">
                          {route.episodes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/55 bg-background/56 p-12 text-center">
                              <Film className="mb-2 size-8 text-muted-foreground/30" />
                              <p className="text-sm font-medium text-muted-foreground">这条线路暂无可播放剧集</p>
                            </div>
                          ) : (
                            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                              {route.episodes.map((episode, index) => (
                                <Button
                                  key={`${episode.url}-${index}`}
                                  variant={episode.searchOnly ? "outline" : "secondary"}
                                  className={cn(
                                    "h-auto min-h-10 justify-start rounded-xl px-2.5 py-2 text-left whitespace-normal shadow-sm",
                                    episode.searchOnly && "border-amber-500/25 bg-amber-500/6 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300",
                                    !episode.searchOnly && "hover:bg-primary hover:text-primary-foreground",
                                  )}
                                  onClick={() => handleEpisodePlay(route.sourceName, episode.name, episode.url, episode.searchOnly)}
                                >
                                  <div className="flex w-full items-start gap-1.5">
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                      <span className="block text-[13px] font-medium leading-tight whitespace-pre-wrap break-all">{episode.name}</span>
                                      {episode.searchOnly && (
                                        <span className="block text-[10px] leading-tight text-muted-foreground whitespace-pre-wrap break-all line-clamp-1">
                                          跨站搜索播放
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </Button>
                              ))}
                            </div>
                          )}
                        </TabsContent>
                      ))}
                    </Tabs>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/55 bg-background/56 p-12 text-center">
                      <Film className="mb-2 size-8 text-muted-foreground/30" />
                      <p className="text-sm font-medium text-muted-foreground">没有任何线路数据</p>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
