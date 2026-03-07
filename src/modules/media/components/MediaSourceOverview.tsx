import { useMemo, useState } from "react";
import {
  LoaderCircle,
  Search,
  Settings2,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  getSpiderRuntimeLabel,
  getSpiderRuntimeTone,
} from "@/modules/media/services/spiderRuntime";
import { getSiteCapabilityTags } from "@/modules/media/services/tvboxConfig";
import type {
  NormalizedTvBoxSite,
  SpiderSiteRuntimeState,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";

type MediaMode = "vod" | "live";
type SpiderJarStatus = "idle" | "loading" | "ready" | "error";

interface MediaSourceOverviewProps {
  mode: MediaMode;
  repoUrls: TvBoxRepoUrl[];
  activeRepoUrl: string;
  sites: NormalizedTvBoxSite[];
  activeSiteKey: string;
  activeSite: NormalizedTvBoxSite | null;
  siteRuntimeStates: Record<string, SpiderSiteRuntimeState>;
  activeSiteRuntime: SpiderSiteRuntimeState | null;
  loadingConfig: boolean;
  spiderJarStatus: SpiderJarStatus;
  onSelectRepo: (repo: TvBoxRepoUrl) => void;
  onSelectSite: (siteKey: string) => void;
}

function CapabilityTag({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function RuntimeBadge({ state }: { state: SpiderSiteRuntimeState | null | undefined }) {
  const tone = getSpiderRuntimeTone(state);
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "success" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
        tone === "warning" && "border-amber-400/30 bg-amber-500/10 text-amber-200",
        tone === "error" && "border-red-400/30 bg-red-500/10 text-red-200",
        tone === "neutral" && "border-white/10 bg-white/5 text-muted-foreground",
      )}
    >
      {getSpiderRuntimeLabel(state)}
    </span>
  );
}

export function MediaSourceOverview({
  mode,
  repoUrls,
  activeRepoUrl,
  sites,
  activeSiteKey,
  activeSite,
  siteRuntimeStates,
  activeSiteRuntime,
  loadingConfig,
  spiderJarStatus,
  onSelectRepo,
  onSelectSite,
}: MediaSourceOverviewProps) {
  const [sitePickerOpen, setSitePickerOpen] = useState(false);
  const [siteSearchKeyword, setSiteSearchKeyword] = useState("");

  const filteredSites = useMemo(() => {
    if (!siteSearchKeyword.trim()) return sites;
    const kw = siteSearchKeyword.toLowerCase();
    return sites.filter(
      (s) => s.name?.toLowerCase().includes(kw) || s.api?.toLowerCase().includes(kw)
    );
  }, [sites, siteSearchKeyword]);

  return (
    <>
      <Card className="glass-card border-none group relative overflow-hidden p-4 transition-all duration-300">
        <div className="relative z-10 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {loadingConfig ? <LoaderCircle className="size-5 animate-spin" /> : <Settings2 className="size-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-bold text-foreground/90">
                    {loadingConfig ? "加载中..." : activeSite?.name || (mode === "vod" ? "未选择接口" : "已连接直播源")}
                  </div>
                  {!loadingConfig && activeSite && <RuntimeBadge state={activeSiteRuntime} />}
                </div>
                <div className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                  {mode === "vod" ? "点播节点" : "直播节点"}
                  {spiderJarStatus === "loading" && <span className="text-yellow-400">· Spider 后台加载中</span>}
                  {spiderJarStatus === "ready" && <span className="text-emerald-400">· Spider 就绪</span>}
                  {spiderJarStatus === "error" && <span className="text-red-400">· Spider 异常</span>}
                </div>
              </div>
            </div>
            
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setSitePickerOpen(true)}
                className="group relative flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-2.5 text-xs font-bold text-primary transition-all hover:bg-primary/20 hover:shadow-lg hover:shadow-primary/10 active:scale-95"
              >
                <div className="absolute inset-0 rounded-xl border border-primary/20 opacity-50 group-hover:opacity-100" />
                切换接口 ({sites.length})
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={sitePickerOpen} onOpenChange={setSitePickerOpen}>
        <DialogContent className="max-w-4xl border-white/15 bg-background/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>切换接口</DialogTitle>
          <DialogDescription>
            全网采集接口聚合，主区域只保留当前接口。
          </DialogDescription>
        </DialogHeader>

        {repoUrls.length > 0 && (
          <div className="mb-2 mt-4 flex gap-2 overflow-x-auto rounded-2xl border border-white/5 bg-white/5 p-2 scrollbar-none">
            {repoUrls.map((repo) => (
              <button
                key={repo.url}
                onClick={() => onSelectRepo(repo)}
                className={cn(
                  "min-w-fit shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-all",
                  activeRepoUrl === repo.url
                    ? "bg-primary text-primary-foreground shadow-sm ring-1 ring-primary/20"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                {repo.name}
              </button>
            ))}
          </div>
        )}

        <div className="relative my-2">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={siteSearchKeyword}
              onChange={(e) => setSiteSearchKeyword(e.target.value)}
              placeholder="搜索接口名称或 API..."
              className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-4 text-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="custom-scrollbar max-h-[60vh] overflow-y-auto pr-2">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {filteredSites.map((site) => {
                const tags = getSiteCapabilityTags(site).slice(0, 5);
                const runtime = siteRuntimeStates[site.key];
                return (
                  <button
                    key={site.key}
                    onClick={() => {
                      onSelectSite(site.key);
                      setSitePickerOpen(false);
                    }}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition-all",
                      activeSiteKey === site.key
                        ? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/20"
                        : "border-white/10 bg-black/20 hover:bg-white/10",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{site.name}</div>
                        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{site.api}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground">
                          type {site.type}
                        </div>
                        <RuntimeBadge state={runtime} />
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <CapabilityTag key={`${site.key}-${tag}`} label={tag} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
