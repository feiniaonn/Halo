import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/media/services/vodMpvRelayClient', () => ({
  getVodRelayStats: vi.fn(),
}));

vi.mock('@/modules/media/services/vodNativePlayer', () => ({
  getNativePlayerStatus: vi.fn(),
}));

import { getVodRelayStats } from '@/modules/media/services/vodMpvRelayClient';
import { getNativePlayerStatus } from '@/modules/media/services/vodNativePlayer';
import { waitForNativePlayerReady } from '@/modules/media/services/vodNativeKernelHealth';

const getVodRelayStatsMock = vi.mocked(getVodRelayStats);
const getNativePlayerStatusMock = vi.mocked(getNativePlayerStatus);

describe('vodNativeKernelHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-18T12:00:00.000Z'));
    vi.clearAllMocks();
    getNativePlayerStatusMock.mockResolvedValue({
      engine: 'mpv',
      state: 'playing',
      firstFrameRendered: true,
      positionMs: 0,
      durationMs: null,
      hostAttached: true,
      hostVisible: true,
      hostWidth: 1280,
      hostHeight: 720,
      errorCode: null,
      errorMessage: null,
      fullscreen: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not treat a relay stats fetch failure as mpv success when a relay session exists', async () => {
    getVodRelayStatsMock.mockRejectedValue(new Error('relay offline'));

    const pending = waitForNativePlayerReady('mpv', 'relay-session-1', 800);
    const settled = pending.then(
      () => ({ ok: true as const, error: null }),
      (error) => ({ ok: false as const, error }),
    );
    await vi.advanceTimersByTimeAsync(1_200);

    const result = await settled;
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toMatch(/warmup timed out/i);
  });

  it('fails fast when only the HLS manifest was loaded without media segments', async () => {
    getVodRelayStatsMock.mockResolvedValue({
      sessionId: 'relay-session-2',
      exists: true,
      createdAtMs: 1,
      lastAccessMs: 1,
      idleMs: 2_800,
      upstreamHost: 'example.com',
      manifestHits: 2,
      segmentHits: 0,
      resourceHits: 0,
    });

    await expect(waitForNativePlayerReady('mpv', 'relay-session-2', 800)).rejects.toThrow(
      /manifest without media segments/i,
    );
  });

  it('accepts mpv once relay traffic shows actual media fetches', async () => {
    getVodRelayStatsMock.mockResolvedValue({
      sessionId: 'relay-session-3',
      exists: true,
      createdAtMs: 1,
      lastAccessMs: 1,
      idleMs: 120,
      upstreamHost: 'example.com',
      manifestHits: 1,
      segmentHits: 2,
      resourceHits: 0,
    });

    await expect(waitForNativePlayerReady('mpv', 'relay-session-3', 800)).resolves.toContain(
      'segment_hits=2',
    );
  });
});
