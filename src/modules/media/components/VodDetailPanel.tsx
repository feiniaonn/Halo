import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Clapperboard,
  Loader2,
  Play,
  Search,
  Sparkles,
} from "lucide-react";

import { VodProxyImage } from "@/components/VodProxyImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

interface VodDetailPanelProps {
  vodId: string | null;
  site: NormalizedTvBoxSite | null;
  spider: string;
  onPlayWithDetail?: (
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx: number,
    episodeIdx: number,
    extInput: string,
  ) => void;
  onSearchOnlyPlay?: (keyword: string) => Promise<void> | void;
}

const sourceKindLabel = {
  cms: "CMS",
  spider: "Spider",
} as const;

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

function DetailValue({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  if (!value?.trim()) return null;

  return (
    <div className="rounded-2xl border border-border/55 bg-background/72 p-3.5 shadow-[0_16px_36px_-28px_rgba(var(--primary),0.3)]">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm leading-6 text-foreground/90 whitespace-pre-wrap break-all">
        {value}
      </div>
    </div>
  );
}

function DetailHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/70">
        {eyebrow}
      </div>
      <div className="space-y-1">
        <div className="text-[1.02rem] font-semibold text-foreground">{title}</div>
        <div className="text-[13px] leading-6 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function EmptyPanel({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Clapperboard;
}) {
  return (
    <Card className="flex h-full min-h-[430px] flex-col overflow-hidden border-border/55 bg-card/78 shadow-[0_18px_60px_-44px_rgba(var(--primary),0.38)] backdrop-blur-xl">
      <CardContent className="flex h-full flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border/55 bg-background/78 text-muted-foreground shadow-sm">
          <Icon className="size-6" />
        </div>
        <div className="space-y-2">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function VodDetailPanel({
  vodId,
  site,
  spider,
  onPlayWithDetail,
  onSearchOnlyPlay,
}: VodDetailPanelProps) {
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [resolvedExt, setResolvedExt] = useState("");
  const [routes, setRoutes] = useState<VodRoute[]>([]);
  const [activeRoute, setActiveRoute] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playWarning, setPlayWarning] = useState<string | null>(null);
  const [searchResolving, setSearchResolving] = useState(false);

  useEffect(() => {
    if (!vodId || !site) {
      setDetail(null);
      setResolvedExt("");
      setRoutes([]);
      setActiveRoute("");
      setLoading(false);
      setError(null);
      setPlayWarning(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);
    setPlayWarning(null);

    fetchVodDetail({ site, spider }, vodId)
      .then((result) => {
        if (!mounted) return;
        setDetail(result.detail);
        setResolvedExt(result.extInput);
        setRoutes(result.routes);
        setActiveRoute(result.routes[0]?.sourceName ?? "");
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

  const currentRoute = useMemo(
    () => routes.find((route) => route.sourceName === activeRoute) ?? routes[0] ?? null,
    [activeRoute, routes],
  );

  const handleEpisodePlay = async (episodeName: string, episodeUrl: string, searchOnly: boolean) => {
    if (!detail || !currentRoute || searchResolving) return;

    if (searchOnly) {
      const keyword = extractMsearchKeyword(episodeUrl) || detail.vod_name || episodeName;
      if (!onSearchOnlyPlay) {
        setPlayWarning("当前线路只提供跨站搜索入口，尚未启用自动搜索播放。");
        return;
      }

      setSearchResolving(true);
      setPlayWarning(`正在跨站搜索可播放节点：${keyword}`);
      try {
        await onSearchOnlyPlay(keyword);
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
    if (!onPlayWithDetail) return;

    const routeIdx = routes.findIndex((route) => route.sourceName === currentRoute.sourceName);
    const episodeIdx = currentRoute.episodes.findIndex((episode) => episode.url === episodeUrl);
    onPlayWithDetail(detail, routes, Math.max(routeIdx, 0), Math.max(episodeIdx, 0), resolvedExt);
  };

  if (!site) {
    return (
      <EmptyPanel
        icon={Clapperboard}
        title="暂无点播接口"
        description="请先配置可用的点播接口，然后在左侧列表中选择内容。"
      />
    );
  }

  if (!site.capability.supportsDetail) {
    return (
      <EmptyPanel
        icon={AlertCircle}
        title="当前接口不支持详情"
        description="这个接口只能返回列表信息，暂时无法在这里展开线路和剧集详情。"
      />
    );
  }

  if (!vodId) {
    return (
      <EmptyPanel
        icon={Sparkles}
        title="选择一部影视"
        description="从中间列表中选择条目后，这里会同步展示完整详情、线路和剧集。"
      />
    );
  }

  return (
    <Card className="flex h-full min-h-[460px] flex-col overflow-hidden border-border/55 bg-card/78 shadow-[0_18px_60px_-44px_rgba(var(--primary),0.38)] backdrop-blur-xl">
      <CardHeader className="gap-3 border-b border-border/55 bg-[linear-gradient(180deg,rgba(var(--primary),0.08),rgba(255,255,255,0.22))] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <DetailHeading
            eyebrow="Detail"
            title="影视详情"
            description="完整显示接口返回的元数据、线路和剧集信息。"
          />
          <Badge variant="outline" className="rounded-full bg-background/75 px-3 py-1 text-[11px] shadow-sm">
            {site.name}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        {loading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm">正在加载详情…</p>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertCircle className="size-10 text-destructive" />
            <p className="text-base font-semibold text-foreground">详情加载失败</p>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground break-all">{error}</p>
          </div>
        ) : !detail ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            暂未获取到可展示的详情信息。
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4">
              <div className="rounded-[28px] border border-border/55 bg-[linear-gradient(145deg,rgba(var(--primary),0.1),rgba(255,255,255,0.78)_45%,rgba(var(--primary),0.04))] p-4 shadow-[0_18px_48px_-38px_rgba(var(--primary),0.7)]">
                <div className="grid gap-4 sm:grid-cols-[100px_minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-[20px] border border-white/55 bg-background/80 shadow-[0_16px_34px_-26px_rgba(15,23,42,0.5)]">
                    <VodProxyImage
                      src={detail.vod_pic || ""}
                      alt={detail.vod_name}
                      className="aspect-[0.72] w-full object-cover"
                      emptyLabel="暂无封面"
                    />
                  </div>

                  <div className="min-w-0 space-y-4">
                    <div className="space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary/70">
                        Selected Title
                      </div>
                      <h2 className="text-[1.45rem] font-semibold tracking-tight text-foreground whitespace-pre-wrap break-words">
                        {detail.vod_name}
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{sourceKindLabel[site.capability.sourceKind]}</Badge>
                        {detail.vod_year && <Badge variant="outline">{detail.vod_year}</Badge>}
                        {detail.vod_area && <Badge variant="outline">{detail.vod_area}</Badge>}
                        {routes.length > 0 && <Badge variant="outline">线路 {routes.length}</Badge>}
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <DetailValue label="导演" value={detail.vod_director} />
                      <DetailValue label="演员" value={detail.vod_actor} />
                    </div>
                  </div>
                </div>
              </div>

              <DetailValue label="剧情简介" value={detail.vod_content || "暂无剧情简介"} />

              {playWarning && (
                <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
                  {searchResolving ? (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                  ) : (
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  )}
                  <span className="leading-6 break-all">{playWarning}</span>
                </div>
              )}

              {routes.length > 0 ? (
                <Tabs value={currentRoute?.sourceName ?? ""} onValueChange={setActiveRoute} className="gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <DetailHeading
                        eyebrow="Routes"
                        title="播放线路"
                        description="切换线路后可查看完整剧集列表。"
                      />
                    </div>

                    <ScrollArea className="w-full">
                      <TabsList className="h-auto min-w-max gap-2 rounded-2xl border border-border/55 bg-background/72 p-1.5">
                        {routes.map((route) => (
                          <TabsTrigger
                            key={route.sourceName}
                            value={route.sourceName}
                            className="h-auto min-h-9 rounded-xl px-3 py-2 text-xs whitespace-nowrap"
                          >
                            {route.sourceName}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </ScrollArea>
                  </div>

                  {routes.map((route) => (
                    <TabsContent key={route.sourceName} value={route.sourceName} className="mt-0">
                      {route.episodes.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/55 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                          这条线路没有返回剧集数据。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-foreground">共 {route.episodes.length} 个剧集节点</p>
                            <p className="text-xs text-muted-foreground">名称和长地址都支持完整查看。</p>
                          </div>

                          <ScrollArea className="max-h-[24rem] rounded-2xl border border-border/55 bg-background/58 p-3">
                            <div className="grid gap-2 2xl:grid-cols-2">
                              {route.episodes.map((episode, index) => (
                                <Button
                                  key={`${route.sourceName}-${episode.url}-${index}`}
                                  variant={episode.searchOnly ? "outline" : "secondary"}
                                  className={cn(
                                    "h-auto min-h-12 justify-start rounded-2xl px-3 py-3 text-left whitespace-normal shadow-sm",
                                    episode.searchOnly
                                      ? "border-amber-500/25 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-200"
                                      : "bg-secondary/72 hover:bg-primary hover:text-primary-foreground",
                                  )}
                                  onClick={() => handleEpisodePlay(episode.name, episode.url, episode.searchOnly)}
                                >
                                  <div className="flex w-full items-start gap-2">
                                    <div className="mt-0.5 shrink-0">
                                      {episode.searchOnly ? <Search className="size-4" /> : <Play className="size-4" />}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <div className="text-sm font-medium leading-5 whitespace-pre-wrap break-all">
                                        {episode.name}
                                      </div>
                                      <div className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
                                        {episode.searchOnly ? "跨站搜索播放" : episode.url}
                                      </div>
                                    </div>
                                  </div>
                                </Button>
                              ))}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/55 bg-background/60 px-4 py-8 text-center text-sm text-muted-foreground">
                  当前详情没有返回可用的播放线路。
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
