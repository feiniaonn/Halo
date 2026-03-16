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

  it('builds a single-kernel plan only', () => {
    expect(buildVodKernelPlan('mpv')).toEqual(['mpv']);
    expect(buildVodKernelPlan('direct')).toEqual(['hls-direct']);
    expect(buildVodKernelPlan('proxy')).toEqual(['hls-proxy']);
  });
});
