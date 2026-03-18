export function buildVodBrowseSessionCachePrefix(runtimeSessionKey: string, siteKey = ""): string {
  const prefix = runtimeSessionKey.trim();
  return siteKey ? `${prefix}::${siteKey}` : prefix;
}

export function buildVodHomeCacheKey(runtimeSessionKey: string, siteKey: string): string {
  return `${buildVodBrowseSessionCachePrefix(runtimeSessionKey, siteKey)}::home`;
}

export function buildVodCategoryCacheKey(
  runtimeSessionKey: string,
  siteKey: string,
  classId: string,
  page: number,
): string {
  return `${buildVodBrowseSessionCachePrefix(runtimeSessionKey, siteKey)}::category::${classId}::${page}`;
}

export function buildVodAggregateCacheKey(
  runtimeSessionKey: string,
  keyword: string,
  siteKeys: string[],
): string {
  return `${buildVodBrowseSessionCachePrefix(runtimeSessionKey)}::aggregate::${keyword.trim().toLowerCase()}::${siteKeys.join(",")}`;
}
