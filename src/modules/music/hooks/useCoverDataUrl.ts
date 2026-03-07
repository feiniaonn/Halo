import { useEffect, useState } from "react";
import { getCoverDataUrl } from "../services/musicService";

const cache = new Map<string, string>();
const COVER_CACHE_MAX_ENTRIES = 120;

function touchCacheEntry(key: string, value: string) {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size <= COVER_CACHE_MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

export function useCoverDataUrl(coverPath: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(() =>
    coverPath ? cache.get(coverPath) ?? null : null,
  );

  useEffect(() => {
    if (!coverPath) {
      setDataUrl(null);
      return;
    }
    const cached = cache.get(coverPath);
    if (cached) {
      touchCacheEntry(coverPath, cached);
      setDataUrl(cached);
      return;
    }
    let cancelled = false;
    getCoverDataUrl(coverPath).then((url) => {
      if (cancelled || !url) return;
      touchCacheEntry(coverPath, url);
      setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [coverPath]);

  return dataUrl;
}
