import type {
  NormalizedTvBoxSite,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";

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
  return sites.find((site) => site.key === normalizedPreferred)?.key
    ?? sites[0]?.key
    ?? "";
}
