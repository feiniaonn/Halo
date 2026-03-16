import { getVodRelayStats, type VodRelayStats } from '@/modules/media/services/vodMpvRelayClient';
import {
  getNativePlayerStatus,
  type NativePlayerEngine,
  type NativePlayerStatus,
} from '@/modules/media/services/vodNativePlayer';

const POLL_INTERVAL_MS = 350;
const WINDOW_LABEL = 'vod_player';

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
  const deadline = Date.now() + timeoutMs;
  let lastRelaySummary = 'relay=none';
  let lastNativeSummary = 'native=unknown';

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
    if (
      status.firstFrameRendered &&
      (!sessionId || (relayStats && hasRelayPlaybackTraffic(relayStats)))
    ) {
      return `${lastNativeSummary} ${lastRelaySummary}`;
    }

    if (!relayStats) {
      if (engine === 'mpv' && status.firstFrameRendered) {
        return `${lastNativeSummary} ${lastRelaySummary}`;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    lastRelaySummary = formatVodRelayStats(relayStats);
    if (hasRelayPlaybackTraffic(relayStats) && status.firstFrameRendered) {
      return `${lastNativeSummary} ${lastRelaySummary}`;
    }

    if (status.state === 'ended') {
      throw new Error(
        `native player ended before rendering (${lastNativeSummary} ${lastRelaySummary})`,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`native player warmup timed out (${lastNativeSummary} ${lastRelaySummary})`);
}
