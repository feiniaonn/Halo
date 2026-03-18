export interface TimedCacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function readTimedCache<T>(
  store: Map<string, TimedCacheEntry<T>>,
  key: string,
  now = Date.now(),
): T | null {
  const entry = store.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function writeTimedCache<T>(
  store: Map<string, TimedCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  now = Date.now(),
): T {
  store.set(key, {
    value,
    expiresAt: now + Math.max(0, ttlMs),
  });
  return value;
}

export function deleteTimedCacheByPrefix<T>(
  store: Map<string, TimedCacheEntry<T>>,
  prefix: string,
): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}
