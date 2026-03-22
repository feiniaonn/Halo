import { describe, expect, it } from 'vitest';

import {
  buildVodKernelPlan,
  fromVodKernelDisplay,
  toVodKernelDisplay,
} from '@/modules/media/services/vodKernelStateMachine';

describe('vodKernelStateMachine', () => {
  it('maps supported kernel modes to display ids', () => {
    expect(toVodKernelDisplay('mpv')).toBe('mpv');
    expect(toVodKernelDisplay('proxy')).toBe('hls-proxy');
    expect(toVodKernelDisplay('direct')).toBe('hls-direct');
    expect(fromVodKernelDisplay('mpv')).toBe('mpv');
    expect(fromVodKernelDisplay('hls-proxy')).toBe('proxy');
    expect(fromVodKernelDisplay('hls-direct')).toBe('direct');
  });

  it('keeps non-hls playback on the requested kernel only', () => {
    expect(buildVodKernelPlan('mpv')).toEqual(['mpv']);
    expect(buildVodKernelPlan('direct')).toEqual(['hls-direct']);
    expect(buildVodKernelPlan('proxy')).toEqual(['hls-proxy']);
  });

  it('adds HLS fallbacks for browser and native kernels', () => {
    expect(buildVodKernelPlan('direct', { streamKind: 'hls' })).toEqual([
      'hls-direct',
      'hls-proxy',
      'mpv',
    ]);
    expect(buildVodKernelPlan('proxy', { streamKind: 'hls' })).toEqual([
      'hls-proxy',
      'mpv',
      'hls-direct',
    ]);
    expect(buildVodKernelPlan('mpv', { streamKind: 'hls' })).toEqual([
      'mpv',
      'hls-proxy',
      'hls-direct',
    ]);
  });
});
