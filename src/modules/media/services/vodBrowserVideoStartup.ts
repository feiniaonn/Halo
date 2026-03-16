type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime?: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface BrowserVideoStartupSnapshot {
  loadedMetadata: boolean;
  canPlay: boolean;
  playing: boolean;
  stalled: boolean;
  waiting: boolean;
  frameRendered: boolean;
  currentTime: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  mediaErrorCode?: number | null;
}

interface WaitForBrowserVideoStartupOptions {
  label: string;
  timeoutMs: number;
  isAttemptCurrent: () => boolean;
}

function describeMediaError(code?: number | null): string {
  switch (code) {
    case 1:
      return 'media aborted';
    case 2:
      return 'network error while loading media';
    case 3:
      return 'decode error';
    case 4:
      return 'media source not supported';
    default:
      return 'unknown media error';
  }
}

export function describeBrowserVideoStartupTimeout(
  label: string,
  timeoutMs: number,
  snapshot: BrowserVideoStartupSnapshot,
): string {
  if (snapshot.mediaErrorCode) {
    return `${label} failed: ${describeMediaError(snapshot.mediaErrorCode)}`;
  }
  if (snapshot.frameRendered || snapshot.currentTime > 0.05) {
    return `${label} startup state changed after timeout`;
  }
  if (snapshot.loadedMetadata) {
    if (snapshot.duration > 0 && snapshot.videoWidth <= 0 && snapshot.videoHeight <= 0) {
      return `${label} loaded duration only, but no video frame was decoded (possible codec/render unsupported)`;
    }
    if (snapshot.canPlay || snapshot.playing || snapshot.waiting) {
      return `${label} buffered media metadata, but playback never reached a visible frame`;
    }
    return `${label} loaded metadata, but playback never reached the first frame`;
  }
  if (snapshot.stalled || snapshot.waiting) {
    return `${label} stalled before metadata was ready`;
  }
  return `${label} startup timeout (${timeoutMs}ms)`;
}

export async function waitForBrowserVideoStartup(
  video: HTMLVideoElement,
  options: WaitForBrowserVideoStartupOptions,
): Promise<void> {
  const { label, timeoutMs, isAttemptCurrent } = options;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: number | null = null;
    let frameHandle: number | null = null;
    const frameVideo = video as VideoElementWithFrameCallback;
    const snapshot: BrowserVideoStartupSnapshot = {
      loadedMetadata: false,
      canPlay: false,
      playing: false,
      stalled: false,
      waiting: false,
      frameRendered: false,
      currentTime: 0,
      duration: 0,
      videoWidth: 0,
      videoHeight: 0,
      mediaErrorCode: null,
    };

    const syncSnapshot = () => {
      snapshot.currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      snapshot.duration = Number.isFinite(video.duration) ? video.duration : 0;
      snapshot.videoWidth = Number.isFinite(video.videoWidth) ? video.videoWidth : 0;
      snapshot.videoHeight = Number.isFinite(video.videoHeight) ? video.videoHeight : 0;
      snapshot.mediaErrorCode = video.error?.code ?? null;
    };

    const cleanup = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
      if (frameHandle !== null && frameVideo.cancelVideoFrameCallback) {
        frameVideo.cancelVideoFrameCallback(frameHandle);
      }
    };

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const succeedIfRenderable = () => {
      if (!isAttemptCurrent()) {
        finish(new Error('playback request superseded'));
        return;
      }
      syncSnapshot();
      if (snapshot.frameRendered || snapshot.currentTime > 0.05) {
        finish();
      }
    };

    const onLoadedMetadata = () => {
      snapshot.loadedMetadata = true;
      syncSnapshot();
    };
    const onCanPlay = () => {
      snapshot.canPlay = true;
      syncSnapshot();
    };
    const onPlaying = () => {
      snapshot.playing = true;
      syncSnapshot();
      succeedIfRenderable();
    };
    const onTimeUpdate = () => {
      syncSnapshot();
      succeedIfRenderable();
    };
    const onStalled = () => {
      snapshot.stalled = true;
      syncSnapshot();
    };
    const onWaiting = () => {
      snapshot.waiting = true;
      syncSnapshot();
    };
    const onError = () => {
      syncSnapshot();
      finish(new Error(`${label} failed: ${describeMediaError(snapshot.mediaErrorCode)}`));
    };

    timer = window.setTimeout(() => {
      syncSnapshot();
      finish(new Error(describeBrowserVideoStartupTimeout(label, timeoutMs, snapshot)));
    }, timeoutMs);

    if (frameVideo.requestVideoFrameCallback) {
      frameHandle = frameVideo.requestVideoFrameCallback(() => {
        snapshot.frameRendered = true;
        syncSnapshot();
        succeedIfRenderable();
      });
    }

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    syncSnapshot();
    succeedIfRenderable();
  });
}
