import type { VodKernelMode } from '../types/vodWindow.types';

export type VodKernelDisplay = 'mpv' | 'hls-direct' | 'potplayer';
export type VodKernelPlanStreamKind =
  | 'unknown'
  | 'hls'
  | 'dash'
  | 'mp4'
  | 'flv'
  | 'mpegts';

export const VOD_KERNEL_MAX_ATTEMPTS = 3;

export const VOD_KERNEL_LABELS: Record<VodKernelDisplay, string> = {
  mpv: 'MPV 内核',
  'hls-direct': 'HLS 直连',
  potplayer: 'PotPlayer',
};

export function toVodKernelDisplay(mode: VodKernelMode): VodKernelDisplay {
  if (mode === 'potplayer') return 'potplayer';
  if (mode === 'mpv') return 'mpv';
  return 'hls-direct';
}

export function fromVodKernelDisplay(display: VodKernelDisplay): VodKernelMode {
  if (display === 'potplayer') return 'potplayer';
  if (display === 'mpv') return 'mpv';
  return 'direct';
}

function buildHlsKernelPlan(startDisplay: VodKernelDisplay): VodKernelDisplay[] {
  switch (startDisplay) {
    case 'potplayer':
      return ['potplayer'];
    case 'mpv':
      return ['mpv', 'hls-direct'];
    case 'hls-direct':
    default:
      return ['hls-direct', 'mpv'];
  }
}

function buildDirectFileKernelPlan(startDisplay: VodKernelDisplay): VodKernelDisplay[] {
  switch (startDisplay) {
    case 'potplayer':
      return ['potplayer'];
    case 'mpv':
      return ['mpv', 'hls-direct'];
    case 'hls-direct':
    default:
      return ['mpv', 'hls-direct'];
  }
}

export function buildVodKernelPlan(
  startMode: VodKernelMode,
  options?: {
    streamKind?: VodKernelPlanStreamKind | null;
    preferProxy?: boolean;
    preferNative?: boolean;
  },
): VodKernelDisplay[] {
  const startDisplay = toVodKernelDisplay(startMode);
  if (options?.streamKind === 'hls') {
    return buildHlsKernelPlan(startDisplay);
  }

  const directFileLike =
    options?.preferNative ||
    options?.streamKind === 'mp4' ||
    options?.streamKind === 'flv' ||
    options?.streamKind === 'dash' ||
    options?.streamKind === 'mpegts';

  if (directFileLike) {
    return buildDirectFileKernelPlan(startDisplay);
  }

  if (startDisplay !== 'potplayer') {
    return [startDisplay, 'mpv'];
  }

  return [startDisplay];
}
