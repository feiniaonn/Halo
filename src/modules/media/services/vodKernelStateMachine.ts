import type { VodKernelMode } from '../types/vodWindow.types';

export type VodKernelDisplay = 'mpv' | 'hls-proxy' | 'hls-direct' | 'potplayer';

export const VOD_KERNEL_MAX_ATTEMPTS = 1;

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

export function buildVodKernelPlan(startMode: VodKernelMode): VodKernelDisplay[] {
  return [toVodKernelDisplay(startMode)];
}
