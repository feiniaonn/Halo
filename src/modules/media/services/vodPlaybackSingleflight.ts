import type { VodEpisode, VodKernelMode } from "@/modules/media/types/vodWindow.types";

const PLAYBACK_LOCK_TTL_MS = 8_000;

type ActivePlaybackLock = {
  token: string;
  startedAt: number;
};

const activePlaybackLocks = new Map<string, ActivePlaybackLock>();

function nowMs(): number {
  return Date.now();
}

function makeToken(): string {
  return `${nowMs()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildVodPlaybackLockKey(
  routeName: string,
  episode: Pick<VodEpisode, "name" | "url">,
  kernelMode: VodKernelMode,
): string {
  return [routeName.trim(), episode.name.trim(), episode.url.trim(), kernelMode].join("::");
}

export function acquireVodPlaybackLock(key: string):
  | { acquired: true; token: string }
  | { acquired: false; ageMs: number } {
  const current = activePlaybackLocks.get(key);
  const now = nowMs();
  if (current) {
    const ageMs = now - current.startedAt;
    if (ageMs < PLAYBACK_LOCK_TTL_MS) {
      return { acquired: false, ageMs };
    }
  }

  const token = makeToken();
  activePlaybackLocks.set(key, { token, startedAt: now });
  return { acquired: true, token };
}

export function releaseVodPlaybackLock(key: string, token: string): void {
  const current = activePlaybackLocks.get(key);
  if (!current || current.token !== token) {
    return;
  }
  activePlaybackLocks.delete(key);
}

export function clearVodPlaybackLock(key: string): void {
  activePlaybackLocks.delete(key);
}

export function clearVodPlaybackLocksByPrefix(prefix: string): void {
  if (!prefix.trim()) {
    return;
  }
  for (const key of Array.from(activePlaybackLocks.keys())) {
    if (key.startsWith(prefix)) {
      activePlaybackLocks.delete(key);
    }
  }
}
