import {
  loadPersistedVodPlaybackResolutionCache,
  savePersistedVodPlaybackResolutionCache,
} from "@/modules/media/services/vodPersistentCache";
import {
  materializeResolvedStream,
  readVodPlaybackResolutionCache,
  snapshotResolvedStream,
  withVodPlaybackResolutionCache,
  writeVodPlaybackResolutionCache,
  type VodResolvedStreamLike,
} from "@/modules/media/services/vodPlaybackResolutionCache";

export interface VodPlaybackResolutionStorageContext {
  sourceKey?: string;
  repoUrl?: string;
}

export async function readStoredVodPlaybackResolution(
  context: VodPlaybackResolutionStorageContext,
  cacheKey: string,
): Promise<VodResolvedStreamLike | null> {
  const cached = readVodPlaybackResolutionCache(cacheKey);
  if (cached) {
    return cached;
  }

  const sourceKey = context.sourceKey?.trim() ?? "";
  if (!sourceKey) {
    return null;
  }

  const persisted = await loadPersistedVodPlaybackResolutionCache(
    sourceKey,
    context.repoUrl ?? "",
    cacheKey,
  ).catch(() => null);
  if (!persisted?.stream) {
    return null;
  }

  const stream = materializeResolvedStream(persisted.stream);
  writeVodPlaybackResolutionCache(cacheKey, stream);
  return stream;
}

export async function resolveWithStoredVodPlaybackResolution<T extends VodResolvedStreamLike>(
  context: VodPlaybackResolutionStorageContext,
  cacheKey: string,
  resolve: () => Promise<T>,
): Promise<T> {
  const cached = await readStoredVodPlaybackResolution(context, cacheKey);
  if (cached) {
    return cached as T;
  }

  return withVodPlaybackResolutionCache(cacheKey, async () => {
    const stream = await resolve();
    const sourceKey = context.sourceKey?.trim() ?? "";
    if (sourceKey) {
      await savePersistedVodPlaybackResolutionCache(
        sourceKey,
        context.repoUrl ?? "",
        cacheKey,
        {
          stream: snapshotResolvedStream(stream),
        },
      ).catch(() => void 0);
    }
    return stream;
  }) as Promise<T>;
}
