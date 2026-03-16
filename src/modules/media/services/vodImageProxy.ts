import { invoke } from "@tauri-apps/api/core";

const PROXY_FIRST_HOSTS = [
  "doubanio.com",
  "douban.com",
  "baidu.com",
  "bdimg.com",
  "mgtv.com",
  "mgtvimg.com",
  "imgo.tv",
  "hunantv.com",
  "iqiyipic.com",
  "qiyipic.com",
  "iqiyi.com",
  "hdslb.com",
  "biliimg.com",
  "bilivideo.com",
  "qpic.cn",
  "gtimg.com",
  "gtimg.cn",
  "qlogo.cn",
  "myqcloud.com",
  "51touxiang.com",
  "itc.cn",
  "ykimg.com",
];

function splitVodImageHeaderSegments(url: string): { url: string; headers: Record<string, string> | null } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { url: "", headers: null };
  }

  const segments = trimmed.split(/@(?=[A-Za-z-]+=)/g);
  const baseUrl = segments[0]?.trim() ?? "";
  if (!baseUrl) {
    return { url: "", headers: null };
  }

  const headers = Object.fromEntries(
    segments
      .slice(1)
      .map((segment) => {
        const splitAt = segment.indexOf("=");
        if (splitAt <= 0) return null;
        const key = segment.slice(0, splitAt).trim();
        const value = segment.slice(splitAt + 1).trim();
        if (!key || !value) return null;
        return [key, value] as const;
      })
      .filter((entry): entry is readonly [string, string] => !!entry),
  );

  return {
    url: baseUrl,
    headers: Object.keys(headers).length > 0 ? headers : null,
  };
}

export function normalizeVodImageUrl(url: string): string {
  const trimmed = splitVodImageHeaderSegments(url).url;
  if (!trimmed) return "";

  let normalized = trimmed
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");

  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }

  if (normalized.startsWith("http:/") && !normalized.startsWith("http://")) {
    normalized = normalized.replace(/^http:\//i, "http://");
  }

  if (normalized.startsWith("https:/") && !normalized.startsWith("https://")) {
    normalized = normalized.replace(/^https:\//i, "https://");
  }

  return normalized;
}

function resolveVodImageRequest(url: string): { url: string; headers: Record<string, string> | null } {
  const { url: baseUrl, headers } = splitVodImageHeaderSegments(url);
  return {
    url: normalizeVodImageUrl(baseUrl),
    headers,
  };
}

export function shouldPreferProxyImage(url: string): boolean {
  const normalized = normalizeVodImageUrl(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    return PROXY_FIRST_HOSTS.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
  } catch {
    return false;
  }
}

export async function proxyVodImage(url: string): Promise<string | null> {
  const request = resolveVodImageRequest(url);
  if (!request.url) return null;

  return invoke<string>("proxy_media", request)
    .then((dataUrl) => {
      const resolved = typeof dataUrl === "string" ? dataUrl.trim() : "";
      return resolved || null;
    })
    .catch(() => null);
}

export function clearVodImageProxyCache(): void {
  // No-op: resolve images on demand to avoid stale cover cache.
}
