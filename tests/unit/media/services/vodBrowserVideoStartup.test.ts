import { describe, expect, it } from 'vitest';

import { describeBrowserVideoStartupTimeout } from '@/modules/media/services/vodBrowserVideoStartup';

describe('vodBrowserVideoStartup', () => {
  it('classifies metadata-only startup as codec/render issue', () => {
    expect(
      describeBrowserVideoStartupTimeout('HLS direct playback', 9000, {
        loadedMetadata: true,
        canPlay: false,
        playing: false,
        stalled: false,
        waiting: false,
        frameRendered: false,
        currentTime: 0,
        duration: 1320,
        videoWidth: 0,
        videoHeight: 0,
        mediaErrorCode: null,
      }),
    ).toContain('no video frame was decoded');
  });

  it('classifies stalled playback with metadata as no visible frame', () => {
    expect(
      describeBrowserVideoStartupTimeout('Direct playback', 7000, {
        loadedMetadata: true,
        canPlay: true,
        playing: true,
        stalled: false,
        waiting: true,
        frameRendered: false,
        currentTime: 0,
        duration: 900,
        videoWidth: 1920,
        videoHeight: 1080,
        mediaErrorCode: null,
      }),
    ).toContain('never reached a visible frame');
  });
});
