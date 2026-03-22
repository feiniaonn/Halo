import { invoke } from "@tauri-apps/api/core";

export interface VodParseRankingRecord {
  parseUrl: string;
  successCount: number;
  lastSuccessAt: number;
}

function normalizeOptionalRepoUrl(repoUrl?: string): string {
  return repoUrl?.trim() ?? "";
}

export async function listVodParseRankings(
  source: string | undefined,
  repoUrl: string | undefined,
  siteKey: string,
  apiClass: string,
  routeName: string,
): Promise<VodParseRankingRecord[]> {
  const normalizedSource = source?.trim() ?? "";
  const normalizedSiteKey = siteKey.trim();
  if (!normalizedSource || !normalizedSiteKey) {
    return [];
  }

  const records = await invoke<Array<{
    parse_url: string;
    success_count: number;
    last_success_at: number;
  }>>("list_vod_parse_rankings", {
    source: normalizedSource,
    repoUrl: normalizeOptionalRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
    apiClass: apiClass.trim(),
    routeName: routeName.trim(),
    limit: 8,
  });

  return records
    .map((record) => ({
      parseUrl: String(record.parse_url ?? "").trim(),
      successCount: Number(record.success_count ?? 0),
      lastSuccessAt: Number(record.last_success_at ?? 0),
    }))
    .filter((record) => !!record.parseUrl);
}

export async function recordVodParseSuccess(
  source: string | undefined,
  repoUrl: string | undefined,
  siteKey: string,
  apiClass: string,
  routeName: string,
  parseUrl: string,
): Promise<void> {
  const normalizedSource = source?.trim() ?? "";
  const normalizedSiteKey = siteKey.trim();
  const normalizedParseUrl = parseUrl.trim();
  if (!normalizedSource || !normalizedSiteKey || !normalizedParseUrl) {
    return;
  }

  await invoke("record_vod_parse_success", {
    source: normalizedSource,
    repoUrl: normalizeOptionalRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
    apiClass: apiClass.trim(),
    routeName: routeName.trim(),
    parseUrl: normalizedParseUrl,
  });
}
