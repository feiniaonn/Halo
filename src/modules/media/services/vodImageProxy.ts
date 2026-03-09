import { invoke } from "@tauri-apps/api/core";

export function normalizeVodImageUrl(url: string): string {
  const trimmed = url.trim();
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

export function shouldPreferProxyImage(url: string): boolean {
  const normalized = normalizeVodImageUrl(url).toLowerCase();
  return normalized.startsWith("http://") || normalized.startsWith("https://");
}

export async function proxyVodImage(url: string): Promise<string | null> {
  const normalized = normalizeVodImageUrl(url);
  if (!normalized) return null;

  return invoke<string>("proxy_media", { url: normalized, headers: null })
    .then((dataUrl) => {
      const resolved = typeof dataUrl === "string" ? dataUrl.trim() : "";
      return resolved || null;
    })
    .catch(() => null);
}

export function clearVodImageProxyCache(): void {
  // No-op: resolve images on demand to avoid stale cover cache.
}
