import type { VodKernelMode } from '../types/vodWindow.types';

export type VodKernelDisplay = 'mpv' | 'hls-proxy' | 'hls-direct';

export const VOD_KERNEL_MAX_ATTEMPTS = 1;

export const VOD_KERNEL_LABELS: Record<VodKernelDisplay, string> = {
  mpv: 'MPV 内核',
  'hls-direct': 'HLS 直连',
  'hls-proxy': 'HLS 代理',
};

export function toVodKernelDisplay(mode: VodKernelMode): VodKernelDisplay {
  if (mode === 'proxy') return 'hls-proxy';
  if (mode === 'direct') return 'hls-direct';
  return 'mpv';
}

export function fromVodKernelDisplay(display: VodKernelDisplay): VodKernelMode {
  if (display === 'hls-proxy') return 'proxy';
  if (display === 'hls-direct') return 'direct';
  return 'mpv';
}

export function buildVodKernelPlan(startMode: VodKernelMode): VodKernelDisplay[] {
  return [toVodKernelDisplay(startMode)];
}
