type VodPlaybackDiagnosticsSnapshot = {
  startedAt?: number;
  steps: Array<{
    stage: string;
    status: string;
    detail: string;
    elapsedMs?: number;
    budgetMs?: number;
  }>;
};

export type VodResolvedStreamSnapshot = {
  url: string;
  headers: Record<string, string> | null;
  resolvedBy: 'spider' | 'direct' | 'jiexi' | 'jiexi-webview';
  skipProbe?: boolean;
  diagnostics: VodPlaybackDiagnosticsSnapshot | null;
};

export type VodResolvedStreamLike = {
  url: string;
  headers: Record<string, string> | null;
  resolvedBy: 'spider' | 'direct' | 'jiexi' | 'jiexi-webview';
  skipProbe?: boolean;
};

const VOD_PLAYBACK_RESOLUTION_CACHE_TTL_MS = 2 * 60 * 1000;

const resolvedStreamCache = new Map<
  string,
  {
    snapshot: VodResolvedStreamSnapshot;
    expiresAt: number;
  }
>();
const inflightResolutionCache = new Map<string, Promise<VodResolvedStreamSnapshot>>();

export function clearVodPlaybackResolutionCache(): void {
  resolvedStreamCache.clear();
  inflightResolutionCache.clear();
}

function cloneHeaders(headers: Record<string, string> | null): Record<string, string> | null {
  return headers ? { ...headers } : null;
}

function cloneDiagnostics(
  diagnostics: VodPlaybackDiagnosticsSnapshot | null,
): VodPlaybackDiagnosticsSnapshot | null {
  if (!diagnostics) {
    return null;
  }
  return {
    startedAt: diagnostics.startedAt,
    steps: diagnostics.steps.map((step) => ({ ...step })),
  };
}

function readHiddenDiagnostics(stream: VodResolvedStreamLike): VodPlaybackDiagnosticsSnapshot | null {
  const carrier = stream as VodResolvedStreamLike & {
    diagnostics?: VodPlaybackDiagnosticsSnapshot;
    playbackDiagnostics?: VodPlaybackDiagnosticsSnapshot;
  };
  const diagnostics = carrier.diagnostics ?? carrier.playbackDiagnostics;
  return diagnostics?.steps ? cloneDiagnostics(diagnostics) : null;
}

export function snapshotResolvedStream(stream: VodResolvedStreamLike): VodResolvedStreamSnapshot {
  return {
    url: stream.url,
    headers: cloneHeaders(stream.headers),
    resolvedBy: stream.resolvedBy,
    skipProbe: stream.skipProbe,
    diagnostics: readHiddenDiagnostics(stream),
  };
}

export function materializeResolvedStream(
  snapshot: VodResolvedStreamSnapshot,
): VodResolvedStreamLike {
  const stream: VodResolvedStreamLike = {
    url: snapshot.url,
    headers: cloneHeaders(snapshot.headers),
    resolvedBy: snapshot.resolvedBy,
    skipProbe: snapshot.skipProbe,
  };
  if (snapshot.diagnostics) {
    Object.defineProperty(stream, 'diagnostics', {
      value: cloneDiagnostics(snapshot.diagnostics),
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return stream;
}

export function writeVodPlaybackResolutionCache(
  key: string,
  stream: VodResolvedStreamLike,
): void {
  resolvedStreamCache.set(key, {
    snapshot: snapshotResolvedStream(stream),
    expiresAt: Date.now() + VOD_PLAYBACK_RESOLUTION_CACHE_TTL_MS,
  });
}

export function readVodPlaybackResolutionCache(
  key: string,
): VodResolvedStreamLike | null {
  const cached = resolvedStreamCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    resolvedStreamCache.delete(key);
    return null;
  }
  return materializeResolvedStream(cached.snapshot);
}

export function withVodPlaybackResolutionCache<T extends VodResolvedStreamLike>(
  key: string,
  resolve: () => Promise<T>,
): Promise<T> {
  const inflight = inflightResolutionCache.get(key);
  if (inflight) {
    return inflight.then((snapshot) => materializeResolvedStream(snapshot) as T);
  }

  const pending = resolve()
    .then((stream) => {
      const snapshot = snapshotResolvedStream(stream);
      writeVodPlaybackResolutionCache(key, stream);
      return snapshot;
    })
    .finally(() => {
      inflightResolutionCache.delete(key);
    });

  inflightResolutionCache.set(key, pending);
  return pending.then((snapshot) => materializeResolvedStream(snapshot) as T);
}
