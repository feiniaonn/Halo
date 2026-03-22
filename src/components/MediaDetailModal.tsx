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
import { isVodOriginMetadataSite } from "@/modules/media/services/vodDispatchHealth";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import {
  normalizeVodImageUrl,
  proxyVodImage,
  shouldPreferProxyImage,
} from "@/modules/media/services/vodImageProxy";
import type {
  VodDispatchCandidate,
  VodDispatchBackendStatus,
  VodDispatchResolution,
} from "@/modules/media/types/vodDispatch.types";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

interface MediaDetailModalProps {
  vodId: string;
  site: NormalizedTvBoxSite;
  spider: string;
  sourceKey?: string;
  repoUrl?: string;
  runtimeSessionKey?: string;
  policyGeneration?: number;
  fallbackTitle?: string;
  onClose: () => void;
  onPlay: (flag: string, id: string, title: string) => void;
  onPlayWithDetail?: (
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx: number,
    epIdx: number,
    extInput: string,
  ) => void;
  onPlayDispatchCandidate?: (candidate: VodDispatchCandidate) => Promise<void> | void;
  onSearchOnlyPlay?: (keyword: string, fallbackTitle: string, originSiteKey: string) => Promise<void> | void;
  onResolveSearchDispatch?: (
    keyword: string,
    fallbackTitle: string,
    originSiteKey: string,
  ) => Promise<VodDispatchResolution>;
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

function describeDispatchBackendStatus(status: VodDispatchBackendStatus): string {
  switch (status.state) {
    case "cache-hit":
      return "Hit persisted dispatch cache.";
    case "attempting":
      return "Matching playable backend...";
    case "success":
      return status.message || "Resolved playable route.";
    case "no-match":
      return status.message || "No relevant title match on this backend.";
    case "no-routes":
      return status.message || "Matched detail returned no playable routes.";
    case "skipped-quarantined":
      return status.message || "Skipped due to recent repeated hard failures.";
    case "failed":
      return status.message || "Backend request failed.";
    default:
      return "Backend state unavailable.";
  }
}

export function MediaDetailModal({
  vodId,
  site,
  spider,
  sourceKey,
  repoUrl,
  runtimeSessionKey,
  policyGeneration,
  fallbackTitle = "",
  onClose,
  onPlay,
  onPlayWithDetail,
  onPlayDispatchCandidate,
  onSearchOnlyPlay,
  onResolveSearchDispatch,
}: MediaDetailModalProps) {
  const [detail, setDetail] = useState<VodDetail | null>(null);
  const [resolvedExt, setResolvedExt] = useState("");
  const [routes, setRoutes] = useState<VodRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playWarning, setPlayWarning] = useState<string | null>(null);
  const [searchResolving, setSearchResolving] = useState(false);
  const [backgroundImageSrc, setBackgroundImageSrc] = useState("");
  const [dispatchCandidates, setDispatchCandidates] = useState<VodDispatchResolution["matches"]>([]);
  const [dispatchBackendStatuses, setDispatchBackendStatuses] = useState<VodDispatchBackendStatus[]>([]);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const isDisplayOnlySite = isVodOriginMetadataSite(site);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setPlayWarning(null);

    fetchVodDetail({ site, spider, sourceKey, repoUrl, runtimeSessionKey, policyGeneration }, vodId)
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
  }, [policyGeneration, repoUrl, runtimeSessionKey, site, sourceKey, spider, vodId]);

  useEffect(() => {
    const keyword = fallbackTitle.trim() || detail?.vod_name?.trim() || "";
    const shouldResolveDispatch = Boolean(keyword)
      && Boolean(onResolveSearchDispatch)
      && !loading
      && (Boolean(error) || !detail || routes.length === 0);

    if (!shouldResolveDispatch) {
      setDispatchCandidates([]);
      setDispatchBackendStatuses([]);
      setDispatchLoading(false);
      setDispatchError(null);
      return;
    }

    let cancelled = false;
    setDispatchLoading(true);
    setDispatchError(null);
    setPlayWarning(
      isDisplayOnlySite
        ? `正在为 [${site.name}] 匹配资源接口：${keyword}`
        : `Dispatch lookup in progress: ${keyword}`,
    );

    void onResolveSearchDispatch!(keyword, fallbackTitle || keyword, site.key)
      .then((resolution) => {
        if (cancelled) return;
        setDispatchCandidates(resolution.matches);
        setDispatchBackendStatuses(resolution.backendStatuses);
        if (resolution.matches.length > 0) {
          setPlayWarning(null);
        } else {
          setDispatchError("No playable dispatch results were found.");
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setDispatchCandidates([]);
        setDispatchBackendStatuses([]);
        setDispatchError(message || "Dispatch lookup failed.");
      })
      .finally(() => {
        if (cancelled) return;
        setDispatchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detail, error, fallbackTitle, isDisplayOnlySite, loading, onResolveSearchDispatch, routes.length, site.key, site.name]);

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

  useEffect(() => {
    if (!loading && isDisplayOnlySite && detail && routes.length === 0) {
      setPlayWarning(`当前接口 [${site.name}] 只展示影视信息，播放会切换到其他资源接口。`);
    }
  }, [detail, isDisplayOnlySite, loading, routes.length, site.name]);

  const handleEpisodePlay = async (routeName: string, episodeName: string, episodeUrl: string, searchOnly: boolean) => {
    if (searchResolving) return;

    if (searchOnly) {
      const keyword = extractMsearchKeyword(episodeUrl) || detail?.vod_name || episodeName;
      if (onResolveSearchDispatch) {
        setSearchResolving(true);
        setDispatchLoading(true);
        setDispatchError(null);
        setPlayWarning(
          isDisplayOnlySite
            ? `正在为 [${site.name}] 匹配资源接口：${keyword}`
            : `Dispatch lookup in progress: ${keyword}`,
        );
        try {
          const resolution = await onResolveSearchDispatch(keyword, detail?.vod_name || episodeName, site.key);
          setDispatchCandidates(resolution.matches);
          setDispatchBackendStatuses(resolution.backendStatuses);
          if (resolution.matches.length > 0) {
            setPlayWarning(null);
          } else {
            setDispatchError("No playable dispatch results were found.");
          }
        } catch (reason: unknown) {
          const message = reason instanceof Error ? reason.message : String(reason);
          setDispatchCandidates([]);
          setDispatchBackendStatuses([]);
          setDispatchError(message || "Dispatch lookup failed.");
        } finally {
          setDispatchLoading(false);
          setSearchResolving(false);
        }
        return;
      }
      if (!onSearchOnlyPlay) {
        setPlayWarning("Current route only provides dispatch search.");
        return;
      }

      setSearchResolving(true);
      setPlayWarning(
        isDisplayOnlySite
          ? `正在为 [${site.name}] 匹配资源接口：${keyword}`
          : `Dispatch lookup in progress: ${keyword}`,
      );
      try {
        await onSearchOnlyPlay(keyword, detail?.vod_name || episodeName, site.key);
        setPlayWarning(null);
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setPlayWarning(`Dispatch lookup failed: ${message}`);
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

  const displayDetail: VodDetail = detail ?? {
    vod_id: vodId,
    vod_name: fallbackTitle || vodId,
    vod_pic: "",
  };
  const displayTitle = detail?.vod_name || fallbackTitle || "影视详情";
  const shouldShowDispatchFallback = Boolean(onResolveSearchDispatch)
    && !loading
    && (Boolean(error) || !detail || routes.length === 0);
  const recommendedDispatchCandidate = dispatchCandidates[0] ?? null;

  const handleDispatchPlayback = async (candidate: VodDispatchResolution["matches"][number]) => {
    if (
      onPlayDispatchCandidate
      && (
        candidate.requiresDetailResolve
        || !candidate.detail
        || !candidate.extInput
        || !candidate.routes?.length
      )
    ) {
      await onPlayDispatchCandidate(candidate);
      return;
    }

    if (!onPlayWithDetail || !candidate.detail || !candidate.extInput || !candidate.routes?.length) {
      return;
    }

    onPlayWithDetail(candidate.detail, candidate.routes, 0, 0, candidate.extInput);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(88vh,900px)] w-[min(1120px,94vw)] max-w-none flex-col gap-0 overflow-hidden rounded-[28px] border-border/55 bg-background/92 p-0 shadow-[0_38px_120px_-56px_rgba(15,23,42,0.72)] backdrop-blur-2xl"
      >
        <DialogTitle className="sr-only">{displayTitle}</DialogTitle>

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
          ) : error && !shouldShowDispatchFallback ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <AlertCircle className="mb-4 size-16 text-destructive/80" />
              <p className="mb-2 text-xl font-bold text-foreground">详情解析失败</p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground break-all">{error}</p>
            </div>
          ) : !detail && !shouldShowDispatchFallback ? (
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
                        src={displayDetail.vod_pic || ""}
                        alt={displayDetail.vod_name}
                        className="aspect-[0.72] w-full object-cover"
                      />
                    </div>

                    <div className="min-w-0 space-y-4">
                      <div className="space-y-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-primary/70">Selected Title</div>
                        <h2 className="text-[1.5rem] font-semibold leading-tight tracking-tight text-foreground whitespace-pre-wrap break-words md:text-[1.7rem]">
                          {displayDetail.vod_name}
                        </h2>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Badge variant="outline" className="bg-background/70 shadow-sm">{site.name}</Badge>
                          <Badge variant="secondary" className="shadow-sm">
                            {site.capability.sourceKind === "spider" ? "Spider" : "CMS"}
                          </Badge>
                          {isDisplayOnlySite && (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                              仅展示
                            </Badge>
                          )}
                          {displayDetail.vod_year && <Badge variant="outline" className="bg-background/40">{displayDetail.vod_year}</Badge>}
                          {displayDetail.vod_area && <Badge variant="outline" className="bg-background/40">{displayDetail.vod_area}</Badge>}
                        </div>
                      </div>

                      <div className="grid gap-3 xl:grid-cols-2">
                        <MetaBlock label="导演" value={displayDetail.vod_director} />
                        <MetaBlock label="演员" value={displayDetail.vod_actor} />
                      </div>
                    </div>
                  </div>
                </div>

                <MetaBlock label="剧情简介" value={displayDetail.vod_content?.replace(/<[^>]*>?/gm, '').trim() || "暂无剧情简介"} />

                {playWarning && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 shadow-sm dark:text-amber-200">
                    {searchResolving ? <Loader2 className="mt-0.5 size-4 animate-spin" /> : <AlertCircle className="mt-0.5 size-4" />}
                    <span className="leading-6 break-all">{playWarning}</span>
                  </div>
                )}

                {isDisplayOnlySite && (
                  <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-sm text-sky-800 shadow-sm dark:text-sky-200">
                    <div className="font-medium">当前接口只负责展示影视信息</div>
                    <div className="mt-1 leading-6 text-sky-900/80 dark:text-sky-100/80">
                      这里显示的是片单、分类和简介，真正播放会切换到同源里的资源接口。
                    </div>
                  </div>
                )}


                {shouldShowDispatchFallback && (
                  <div className="space-y-3 rounded-2xl border border-border/60 bg-background/72 p-4 shadow-sm">
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/70">Successful Interfaces</div>
                      <h3 className="text-base font-semibold text-foreground">Dispatch Results</h3>
                      <p className="text-[13px] text-muted-foreground">
                        {isDisplayOnlySite
                          ? "当前条目来自元数据接口，播放前会优先匹配已验证过的资源接口。"
                          : "Playable results discovered from other searchable interfaces in the same source."}
                      </p>
                    </div>

                    {dispatchLoading ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span>Searching playable interfaces...</span>
                      </div>
                    ) : dispatchCandidates.length > 0 ? (
                      <div className="space-y-3">
                        {recommendedDispatchCandidate && onPlayWithDetail && (
                          <Button
                            variant="default"
                            className="h-auto w-full justify-between rounded-2xl px-4 py-3 text-left shadow-sm"
                            onClick={() => {
                              void handleDispatchPlayback(recommendedDispatchCandidate);
                            }}
                          >
                            <div className="space-y-1">
                              <div className="text-sm font-semibold">换接口播放</div>
                              <div className="text-xs text-primary-foreground/80">
                                推荐接口：{recommendedDispatchCandidate.siteName} / {recommendedDispatchCandidate.matchTitle}
                              </div>
                            </div>
                            <div className="text-xs text-primary-foreground/80">
                              {recommendedDispatchCandidate.routes?.length
                                ? `${recommendedDispatchCandidate.routes.length} 条线路`
                                : "点击后解析线路"}
                            </div>
                          </Button>
                        )}

                        <div className="grid gap-2 md:grid-cols-2">
                          {dispatchCandidates.map((candidate) => (
                            <Button
                              key={`${candidate.siteKey}:${candidate.vodId}`}
                              variant="outline"
                              className="h-auto justify-start rounded-xl px-3 py-3 text-left"
                              onClick={() => {
                                void handleDispatchPlayback(candidate);
                              }}
                            >
                              <div className="space-y-1">
                                <div className="text-sm font-semibold text-foreground">切到 {candidate.siteName} 播放</div>
                                <div className="text-xs text-muted-foreground break-all">{candidate.matchTitle}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {candidate.routes?.length
                                    ? `${candidate.routes.length} routes`
                                    : "Click to resolve detail"}
                                  {candidate.remarks ? ` / ${candidate.remarks}` : ""}
                                </div>
                              </div>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/55 bg-muted/10 px-3 py-4 text-sm text-muted-foreground">
                        {dispatchError || 'No playable dispatch results were found.'}
                      </div>
                    )}

                    {dispatchBackendStatuses.length > 0 && (
                      <div className="space-y-2 rounded-xl border border-border/50 bg-muted/15 px-3 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Dispatch Diagnostics
                        </div>
                        <div className="space-y-2">
                          {dispatchBackendStatuses.map((status) => (
                            <div
                              key={`${status.targetSiteKey}:${status.order}`}
                              className="flex items-start justify-between gap-3 rounded-lg border border-border/45 bg-background/65 px-3 py-2 text-xs"
                            >
                              <div className="min-w-0 space-y-1">
                                <div className="font-medium text-foreground">{status.targetSiteName}</div>
                                <div className="text-muted-foreground break-all">{describeDispatchBackendStatus(status)}</div>
                              </div>
                              <Badge variant="outline" className="shrink-0 bg-background/70">
                                {status.state}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
