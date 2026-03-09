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
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "success" && "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" && "border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "error" && "border-red-400/30 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "neutral" && "border-border bg-muted text-muted-foreground",
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
        onClick={() => setSitePickerOpen(true)}
        className="group relative flex h-9 items-center gap-2 rounded-full border border-white/10 bg-background/55 px-3 text-sm font-medium text-foreground/90 shadow-sm backdrop-blur-md transition-all hover:bg-accent hover:text-accent-foreground active:scale-95"
        aria-label={mode === "vod" ? "切换点播接口" : "切换直播源"}
      >
        {loadingConfig ? (
          <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Settings2 className="size-3.5 text-primary" />
        )}
        <span className="max-w-[120px] truncate">
          {loadingConfig ? "加载中..." : activeSite?.name ?? (mode === "vod" ? "切换接口" : "切换直播源")}
        </span>
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>

      <Dialog open={sitePickerOpen} onOpenChange={setSitePickerOpen}>
        <DialogContent className="flex h-[80vh] max-w-[860px] flex-col overflow-hidden rounded-2xl border bg-background/95 p-0 shadow-2xl backdrop-blur-2xl">
          {/* Header */}
          <div className="flex shrink-0 flex-col gap-3 border-b px-5 py-4">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">
                {mode === "vod" ? "切换点播接口" : "切换直播源"}
              </DialogTitle>
            </DialogHeader>

            {/* Repo tabs */}
            {repoUrls.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                {repoUrls.map((repo) => (
                  <button
                    key={repo.url}
                    onClick={() => onSelectRepo(repo)}
                    className={cn(
                      "shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold transition-all",
                      activeRepoUrl === repo.url
                        ? "border-primary/40 bg-primary text-primary-foreground shadow"
                        : "border-border bg-muted/60 text-muted-foreground hover:border-primary/25 hover:text-foreground",
                    )}
                  >
                    {repo.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sites list */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-3 py-2">
              {sites.map((site) => {
                const runtime = siteRuntimeStates[site.key];
                const isActive = activeSiteKey === site.key;
                return (
                  <button
                    key={site.key}
                    onClick={() => {
                      onSelectSite(site.key);
                      setSitePickerOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {/* Active indicator */}
                    <span className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      isActive ? "bg-primary" : "bg-muted-foreground/30"
                    )} />

                    {/* Name */}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {site.name}
                    </span>

                    {/* Type */}
                    <span className="shrink-0 text-[10px] text-muted-foreground uppercase tracking-wide">
                      {site.type === 3 ? "Spider" : `T${site.type}`}
                    </span>

                    {/* Runtime badge */}
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
