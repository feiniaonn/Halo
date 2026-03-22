import { getVodRelayStats, type VodRelayStats } from '@/modules/media/services/vodMpvRelayClient';
import {
  getNativePlayerStatus,
  type NativePlayerEngine,
  type NativePlayerStatus,
} from '@/modules/media/services/vodNativePlayer';

const POLL_INTERVAL_MS = 350;
const WINDOW_LABEL = 'vod_player';
const RELAY_MANIFEST_ONLY_STALL_MS = 2_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function hasRelayPlaybackTraffic(stats: {
  manifestHits: number;
  segmentHits: number;
  resourceHits: number;
}): boolean {
  return stats.manifestHits > 0 && (stats.segmentHits > 0 || stats.resourceHits > 0);
}

function isManifestOnlyRelayStall(stats: {
  manifestHits: number;
  segmentHits: number;
  resourceHits: number;
  idleMs?: number;
}): boolean {
  return (
    stats.manifestHits > 0 &&
    stats.segmentHits === 0 &&
    stats.resourceHits === 0 &&
    (stats.idleMs ?? 0) >= RELAY_MANIFEST_ONLY_STALL_MS
  );
}

function formatNativeStatusSummary(status: NativePlayerStatus): string {
  return [
    `engine=${status.engine ?? 'unknown'}`,
    `state=${status.state}`,
    `first_frame=${status.firstFrameRendered ? 'yes' : 'no'}`,
    `host_attached=${status.hostAttached ? 'yes' : 'no'}`,
    `host_visible=${status.hostVisible ? 'yes' : 'no'}`,
    `host_width=${status.hostWidth ?? 'na'}`,
    `host_height=${status.hostHeight ?? 'na'}`,
    `error_code=${status.errorCode ?? 'none'}`,
  ].join(' ');
}

export function formatVodRelayStats(
  stats: Pick<VodRelayStats, 'manifestHits' | 'segmentHits' | 'resourceHits' | 'idleMs' | 'exists'>,
): string {
  return `exists=${stats.exists ? 'yes' : 'no'} manifest_hits=${stats.manifestHits} segment_hits=${stats.segmentHits} resource_hits=${stats.resourceHits} idle_ms=${stats.idleMs ?? 'na'}`;
}

export async function readVodRelayStatsSummary(sessionId: string | null): Promise<string> {
  if (!sessionId) {
    return 'relay=none';
  }
  try {
    const stats = await getVodRelayStats(sessionId);
    return formatVodRelayStats(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `relay_stats_error=${message}`;
  }
}

export async function waitForNativePlayerReady(
  engine: NativePlayerEngine,
  sessionId: string | null,
  timeoutMs: number,
): Promise<string> {
  let deadline = Date.now() + timeoutMs;
  let lastRelaySummary = 'relay=none';
  let lastNativeSummary = 'native=unknown';
  let deadlineExtended = false;

  while (Date.now() < deadline) {
    const [status, relayStats] = await Promise.all([
      getNativePlayerStatus(WINDOW_LABEL),
      sessionId ? getVodRelayStats(sessionId).catch(() => null) : Promise.resolve(null),
    ]);

    lastNativeSummary = formatNativeStatusSummary(status);
    if (status.engine && status.engine !== engine) {
      throw new Error(`native player engine mismatch (${lastNativeSummary})`);
    }
    if (status.state === 'error') {
      throw new Error(
        status.errorMessage || `native player entered error state (${lastNativeSummary})`,
      );
    }
    if (!relayStats) {
      if (!sessionId && engine === 'mpv' && status.firstFrameRendered) {
        return `${lastNativeSummary} ${lastRelaySummary}`;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    lastRelaySummary = formatVodRelayStats(relayStats);
    if (
      status.firstFrameRendered &&
      (!sessionId || hasRelayPlaybackTraffic(relayStats))
    ) {
      return `${lastNativeSummary} ${lastRelaySummary}`;
    }

    if (sessionId && status.firstFrameRendered && isManifestOnlyRelayStall(relayStats)) {
      throw new Error(
        `native player only loaded HLS manifest without media segments (${lastNativeSummary} ${lastRelaySummary})`,
      );
    }

    if (status.state === 'ended') {
      throw new Error(
        `native player ended before rendering (${lastNativeSummary} ${lastRelaySummary})`,
      );
    }

    // If mpv is actively loading segments, extend the deadline generously
    if (
      !deadlineExtended &&
      engine === 'mpv' &&
      status.state === 'loading' &&
      relayStats &&
      hasRelayPlaybackTraffic(relayStats)
    ) {
      deadline = Date.now() + 15_000;
      deadlineExtended = true;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`native player warmup timed out (${lastNativeSummary} ${lastRelaySummary})`);
}
