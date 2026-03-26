import { useMemo, useState } from "react";
import { ChevronRight, LoaderCircle, Settings2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  getSpiderRuntimeLabel,
  getSpiderRuntimeTone,
} from "@/modules/media/services/spiderRuntime";
import type {
  NormalizedTvBoxSite,
  SpiderSiteRuntimeState,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";

type MediaMode = "vod" | "live";

interface MediaSourceOverviewProps {
  mode: MediaMode;
  repoUrls: TvBoxRepoUrl[];
  activeRepoUrl: string;
  sites: NormalizedTvBoxSite[];
  activeSiteKey: string;
  siteRuntimeStates: Record<string, SpiderSiteRuntimeState>;
  loadingConfig: boolean;
  onSelectRepo: (repo: TvBoxRepoUrl) => void;
  onSelectSite: (siteKey: string) => void;
}

function RuntimeDot({ state }: { state: SpiderSiteRuntimeState | null | undefined }) {
  const tone = getSpiderRuntimeTone(state);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        tone === "success" && "border-emerald-400/24 bg-emerald-400/10 text-emerald-200",
        tone === "warning" && "border-amber-400/24 bg-amber-400/10 text-amber-100",
        tone === "error" && "border-rose-500/24 bg-rose-500/10 text-rose-100",
        tone === "neutral" && "border-white/10 bg-white/[0.04] text-muted-foreground",
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
  siteRuntimeStates,
  loadingConfig,
  onSelectRepo,
  onSelectSite,
}: MediaSourceOverviewProps) {
  const [sitePickerOpen, setSitePickerOpen] = useState(false);

  const activeSite = useMemo(() => sites.find((s) => s.key === activeSiteKey), [sites, activeSiteKey]);

  return (
    <>
      <button
        type="button"
        onClick={() => setSitePickerOpen(true)}
        className="halo-media-source-trigger halo-interactive halo-focusable group relative flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm font-medium text-foreground/90 shadow-[var(--halo-shadow-soft)]"
        aria-label={mode === "vod" ? "切换点播接口" : "切换直播源"}
      >
        {loadingConfig ? (
          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Settings2 className="size-3.5 text-primary" />
        )}
        <span className="max-w-[140px] truncate">
          {loadingConfig ? "加载中..." : activeSite?.name ?? (mode === "vod" ? "切换接口" : "切换直播源")}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>

      <Dialog open={sitePickerOpen} onOpenChange={setSitePickerOpen}>
        <DialogContent className="flex h-[82vh] max-w-[920px] flex-col overflow-hidden p-0">
          <div className="flex shrink-0 flex-col gap-4 border-b border-white/8 px-5 py-5">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">
                {mode === "vod" ? "切换点播接口" : "切换直播源"}
              </DialogTitle>
            </DialogHeader>

            {repoUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {repoUrls.map((repo) => (
                  <button
                    key={repo.url}
                    type="button"
                    onClick={() => onSelectRepo(repo)}
                    className={cn(
                      "halo-interactive halo-focusable shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                      activeRepoUrl === repo.url
                        ? "border-primary/20 bg-primary/12 text-primary shadow-[var(--halo-shadow-glow)]"
                        : "border-white/8 bg-white/[0.04] text-muted-foreground hover:border-primary/16 hover:text-foreground",
                    )}
                  >
                    {repo.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-1.5 px-3 py-3">
              {sites.map((site) => {
                const runtime = siteRuntimeStates[site.key];
                const isActive = activeSiteKey === site.key;
                return (
                  <button
                    key={site.key}
                    type="button"
                    onClick={() => {
                      onSelectSite(site.key);
                      setSitePickerOpen(false);
                    }}
                    className={cn(
                      "halo-interactive flex w-full items-center gap-3 rounded-[calc(var(--radius-xl)-4px)] border px-4 py-3 text-left transition-all duration-200",
                      isActive
                        ? "border-primary/18 bg-primary/10 text-foreground shadow-[var(--halo-shadow-glow)]"
                        : "border-transparent bg-transparent text-foreground/82 hover:border-white/8 hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        isActive ? "bg-primary shadow-[0_0_10px_rgba(82,214,236,0.9)]" : "bg-muted-foreground/30",
                      )}
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{site.name}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {site.type === 3 ? "Spider 接口" : `类型 ${site.type}`}
                      </span>
                    </span>

                    <RuntimeDot state={runtime} />
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
