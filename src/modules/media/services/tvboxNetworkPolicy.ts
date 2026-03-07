import type {
  TvBoxHostMapping,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
} from "@/modules/media/types/vodWindow.types";

export interface TvBoxResolvedRequest {
  url: string;
  headers: Record<string, string> | null;
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function matchesTvBoxHostPattern(pattern: string, urlOrHost: string): boolean {
  const token = pattern.trim();
  if (!token) return false;

  const parsed = tryParseUrl(urlOrHost);
  const host = (parsed?.hostname ?? urlOrHost).toLowerCase();
  const haystack = `${urlOrHost} ${host}`.toLowerCase();
  const needle = token.toLowerCase();

  if (needle.includes("*") || needle.includes(".*")) {
    const escaped = needle
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\.\*/g, ".*")
      .replace(/\*/g, ".*");
    try {
      return new RegExp(escaped, "i").test(urlOrHost) || new RegExp(escaped, "i").test(host);
    } catch {
      return haystack.includes(needle.replace(/\*/g, "").replace(/\.\*/g, ""));
    }
  }

  return haystack.includes(needle);
}

function mergeHeaders(
  baseHeaders: Record<string, string> | null | undefined,
  extraHeaders: Record<string, string> | null | undefined,
): Record<string, string> | null {
  const merged = {
    ...(extraHeaders ?? {}),
    ...(baseHeaders ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : null;
}

export function matchRequestHeaders(
  rules: TvBoxRequestHeaderRule[] | undefined,
  url: string,
): Record<string, string> | null {
  const merged = (rules ?? []).reduce<Record<string, string>>((current, rule) => {
    if (!matchesTvBoxHostPattern(rule.host, url)) {
      return current;
    }
    return {
      ...current,
      ...rule.header,
    };
  }, {});

  return Object.keys(merged).length > 0 ? merged : null;
}

export function applyHostMappingsToRequest(
  url: string,
  headers: Record<string, string> | null | undefined,
  mappings: TvBoxHostMapping[] | undefined,
): TvBoxResolvedRequest {
  const parsed = tryParseUrl(url);
  if (!parsed) {
    return {
      url,
      headers: headers ?? null,
    };
  }

  const matched = (mappings ?? []).find((mapping) => matchesTvBoxHostPattern(mapping.host, parsed.hostname));
  if (!matched) {
    return {
      url,
      headers: headers ?? null,
    };
  }

  const nextUrl = new URL(parsed.toString());
  const originalHost = nextUrl.hostname;
  nextUrl.hostname = matched.target;
  return {
    url: nextUrl.toString(),
    headers: mergeHeaders(headers, { Host: originalHost }),
  };
}

export function resolveRequestPolicy(
  url: string,
  baseHeaders: Record<string, string> | null | undefined,
  requestHeaders: TvBoxRequestHeaderRule[] | undefined,
  hostMappings: TvBoxHostMapping[] | undefined,
): TvBoxResolvedRequest {
  const matchedHeaders = matchRequestHeaders(requestHeaders, url);
  return applyHostMappingsToRequest(url, mergeHeaders(baseHeaders, matchedHeaders), hostMappings);
}

export function shouldUseProxyForUrl(proxyDomains: string[] | undefined, url: string): boolean {
  return (proxyDomains ?? []).some((pattern) => matchesTvBoxHostPattern(pattern, url));
}

export function matchPlaybackRules(
  rules: TvBoxPlaybackRule[] | undefined,
  url: string,
): TvBoxPlaybackRule[] {
  return (rules ?? []).filter((rule) => {
    if (rule.hosts.length === 0) return false;
    return rule.hosts.some((pattern) => matchesTvBoxHostPattern(pattern, url));
  });
}
