import { fetchTextResource } from "@/modules/media/services/mediaSourceLoader";
import type { NormalizedTvBoxSite } from "@/modules/media/types/tvbox.types";

interface ResolveSiteExtOptions {
  sessionKey?: string;
  policyGeneration?: number;
  forceRefresh?: boolean;
}

const remoteExtCache = new Map<string, Map<string, Promise<string>>>();

function shouldPreserveRemoteExtUrl(site: Pick<NormalizedTvBoxSite, "api" | "extKind">): boolean {
  if (site.extKind !== "url") return false;
  return /csp_(xbpq|xyqhiker)/i.test(site.api);
}

async function fetchRemoteExtText(url: string): Promise<string> {
  const response = await fetchTextResource(url);
  return typeof response === "string" ? response.trim() : "";
}

function resolveRuntimeSessionKey(options?: ResolveSiteExtOptions): string {
  return options?.sessionKey?.trim() || "__default__";
}

function resolveRemoteExtCacheKey(target: string, options?: ResolveSiteExtOptions): string {
  return `${options?.policyGeneration ?? 0}::${target}`;
}

export async function resolveSiteExtInput(
  site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">,
  options?: ResolveSiteExtOptions,
): Promise<string> {
  if (site.extKind !== "url") {
    return site.extValue;
  }

  const target = site.extValue.trim();
  if (!target) return "";
  if (shouldPreserveRemoteExtUrl(site)) {
    return target;
  }

  const sessionKey = resolveRuntimeSessionKey(options);
  let sessionCache = remoteExtCache.get(sessionKey);
  if (!sessionCache) {
    sessionCache = new Map<string, Promise<string>>();
    remoteExtCache.set(sessionKey, sessionCache);
  }

  const cacheKey = resolveRemoteExtCacheKey(target, options);
  if (options?.forceRefresh) {
    sessionCache.delete(cacheKey);
  }

  let task = sessionCache.get(cacheKey);
  if (!task) {
    task = fetchRemoteExtText(target)
      .then((result) => result || target)
      .catch(() => target);
    sessionCache.set(cacheKey, task);
  }

  return task;
}

export async function prefetchSiteExtInputs(
  sites: Array<Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">>,
  options?: ResolveSiteExtOptions,
  concurrency = 6,
): Promise<void> {
  if (!sites.length) {
    return;
  }

  const cappedConcurrency = Math.max(1, Math.min(concurrency, sites.length));
  let cursor = 0;
  const worker = async () => {
    while (cursor < sites.length) {
      const index = cursor;
      cursor += 1;
      const site = sites[index];
      await resolveSiteExtInput(site, options);
    }
  };

  await Promise.all(Array.from({ length: cappedConcurrency }, () => worker()));
}

export function clearTvBoxRuntimeCaches(sessionKey?: string): void {
  if (!sessionKey?.trim()) {
    remoteExtCache.clear();
    return;
  }
  remoteExtCache.delete(sessionKey.trim());
}
