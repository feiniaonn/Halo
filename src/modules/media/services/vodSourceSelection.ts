import type {
  NormalizedTvBoxSite,
  SpiderSiteRuntimeState,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";
import {
  shouldDeprioritizeRuntimeSite,
  shouldHideRuntimeSite,
} from "@/modules/media/services/spiderRuntime";

const MEDIA_VOD_SELECTION_KEY = "halo_media_vod_selection_v2";
const MEDIA_VOD_SELECTION_VERSION = 1;

export interface VodSourceSelectionSnapshot {
  version: number;
  source: string;
  repoUrl: string;
  siteKey: string;
  savedAt: number;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPreferredVodDefaultSite(sites: NormalizedTvBoxSite[]): NormalizedTvBoxSite | null {
  if (sites.length === 0) return null;

  const ranked = [...sites].sort((left, right) => {
    const score = (site: NormalizedTvBoxSite) => {
      if (site.capability.desktopUnsupportedReason) {
        return 6;
      }
      if (
        site.capability.dispatchRole === "resource-backend"
        && site.capability.supportsDetail
        && site.capability.supportsPlay
      ) {
        return 0;
      }
      if (site.capability.supportsDetail && site.capability.dispatchRole !== "origin-metadata") {
        return 1;
      }
      if (site.capability.canSearch && site.capability.dispatchRole !== "origin-metadata") {
        return 2;
      }
      if (site.capability.supportsDetail) {
        return 3;
      }
      if (site.capability.dispatchRole === "origin-metadata") {
        return 5;
      }
      return 4;
    };

    return score(left) - score(right);
  });

  return ranked[0] ?? null;
}

export function filterRuntimeVisibleSites(
  sites: NormalizedTvBoxSite[],
  runtimeStates: Record<string, SpiderSiteRuntimeState | null | undefined>,
): NormalizedTvBoxSite[] {
  const runtimeVisibleSites = sites.filter((site) => !shouldHideRuntimeSite(runtimeStates[site.key]));
  const visibleSites = runtimeVisibleSites.length > 0 ? runtimeVisibleSites : sites;
  const desktopBrowsableSites = visibleSites.filter((site) => !site.capability.desktopUnsupportedReason);
  return desktopBrowsableSites.length > 0 ? desktopBrowsableSites : visibleSites;
}

export function sortRuntimeAwareSites(
  sites: NormalizedTvBoxSite[],
  runtimeStates: Record<string, SpiderSiteRuntimeState | null | undefined>,
  activeSiteKey = "",
): NormalizedTvBoxSite[] {
  const visibleSites = filterRuntimeVisibleSites(sites, runtimeStates);
  const originalOrder = new Map(visibleSites.map((site, index) => [site.key, index]));

  return [...visibleSites].sort((left, right) => {
    if (left.key === activeSiteKey && right.key !== activeSiteKey) {
      return -1;
    }
    if (right.key === activeSiteKey && left.key !== activeSiteKey) {
      return 1;
    }

    const leftPenalty = shouldDeprioritizeRuntimeSite(runtimeStates[left.key]) ? 1 : 0;
    const rightPenalty = shouldDeprioritizeRuntimeSite(runtimeStates[right.key]) ? 1 : 0;
    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }

    return (originalOrder.get(left.key) ?? 0) - (originalOrder.get(right.key) ?? 0);
  });
}

export function readVodSourceSelectionSnapshot(): VodSourceSelectionSnapshot | null {
  try {
    const raw = localStorage.getItem(MEDIA_VOD_SELECTION_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<VodSourceSelectionSnapshot>;
    const source = normalizeText(parsed.source);
    if (!source) return null;

    return {
      version: typeof parsed.version === "number" ? parsed.version : MEDIA_VOD_SELECTION_VERSION,
      source,
      repoUrl: normalizeText(parsed.repoUrl),
      siteKey: normalizeText(parsed.siteKey),
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeVodSourceSelectionSnapshot(input: {
  source: string;
  repoUrl?: string;
  siteKey?: string;
}): void {
  const source = normalizeText(input.source);
  if (!source) return;

  const snapshot: VodSourceSelectionSnapshot = {
    version: MEDIA_VOD_SELECTION_VERSION,
    source,
    repoUrl: normalizeText(input.repoUrl),
    siteKey: normalizeText(input.siteKey),
    savedAt: Date.now(),
  };

  localStorage.setItem(MEDIA_VOD_SELECTION_KEY, JSON.stringify(snapshot));
}

export function clearVodSourceSelectionSnapshot(): void {
  localStorage.removeItem(MEDIA_VOD_SELECTION_KEY);
}

export function pickStoredRepoUrl(
  repoUrls: TvBoxRepoUrl[],
  preferredRepoUrl: string,
): string {
  const normalizedPreferred = normalizeText(preferredRepoUrl);
  return repoUrls.find((repo) => repo.url === normalizedPreferred)?.url
    ?? repoUrls[0]?.url
    ?? "";
}

export function pickStoredSiteKey(
  sites: NormalizedTvBoxSite[],
  preferredSiteKey: string,
): string {
  const normalizedPreferred = normalizeText(preferredSiteKey);
  const preferredSite = sites.find((site) => site.key === normalizedPreferred) ?? null;
  const fallbackSite = getPreferredVodDefaultSite(sites);

  if (
    preferredSite
    && !(
      (preferredSite.capability.dispatchRole === "origin-metadata"
      || !!preferredSite.capability.desktopUnsupportedReason)
      && !preferredSite.capability.supportsDetail
      && fallbackSite
      && fallbackSite.key !== preferredSite.key
    )
  ) {
    return preferredSite.key;
  }

  return fallbackSite?.key ?? sites[0]?.key ?? "";
}

export function pickRuntimeVisibleSiteKey(
  sites: NormalizedTvBoxSite[],
  runtimeStates: Record<string, SpiderSiteRuntimeState | null | undefined>,
  preferredSiteKey: string,
): string {
  return pickStoredSiteKey(sortRuntimeAwareSites(sites, runtimeStates), preferredSiteKey);
}
