import type { VodKernelMode } from '../types/vodWindow.types';

export type VodKernelDisplay = 'mpv' | 'hls-proxy' | 'hls-direct' | 'potplayer';
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
  'hls-proxy': 'HLS 代理',
  potplayer: 'PotPlayer',
};

export function toVodKernelDisplay(mode: VodKernelMode): VodKernelDisplay {
  if (mode === 'proxy') return 'hls-proxy';
  if (mode === 'direct') return 'hls-direct';
  if (mode === 'potplayer') return 'potplayer';
  return 'mpv';
}

export function fromVodKernelDisplay(display: VodKernelDisplay): VodKernelMode {
  if (display === 'hls-proxy') return 'proxy';
  if (display === 'hls-direct') return 'direct';
  if (display === 'potplayer') return 'potplayer';
  return 'mpv';
}

function buildHlsKernelPlan(startDisplay: VodKernelDisplay): VodKernelDisplay[] {
  switch (startDisplay) {
    case 'hls-direct':
      return ['hls-direct', 'hls-proxy', 'mpv'];
    case 'hls-proxy':
      return ['hls-proxy', 'mpv', 'hls-direct'];
    case 'potplayer':
      return ['potplayer', 'mpv', 'hls-proxy'];
    case 'mpv':
    default:
      return ['mpv', 'hls-proxy', 'hls-direct'];
  }
}

export function buildVodKernelPlan(
  startMode: VodKernelMode,
  options?: { streamKind?: VodKernelPlanStreamKind | null },
): VodKernelDisplay[] {
  const startDisplay = toVodKernelDisplay(startMode);
  if (options?.streamKind !== 'hls') {
    return [startDisplay];
  }
  return buildHlsKernelPlan(startDisplay);
}
