import { cn } from '@/lib/utils';
import {
  toVodKernelDisplay,
  type VodKernelDisplay,
  VOD_KERNEL_LABELS,
} from '@/modules/media/services/vodKernelStateMachine';
import type { VodKernelMode } from '@/modules/media/types/vodWindow.types';

interface VodKernelStatusBadgeProps {
  requestedMode: VodKernelMode;
  activeKernel: VodKernelDisplay | null;
}

export function VodKernelStatusBadge({
  requestedMode,
  activeKernel,
}: VodKernelStatusBadgeProps) {
  if (!activeKernel) {
    return null;
  }

  const requestedKernel = toVodKernelDisplay(requestedMode);
  const isFallback = requestedKernel !== activeKernel;
  const label = isFallback
    ? `实际: ${VOD_KERNEL_LABELS[activeKernel]}`
    : `当前: ${VOD_KERNEL_LABELS[activeKernel]}`;
  const title = isFallback
    ? `已从 ${VOD_KERNEL_LABELS[requestedKernel]} 自动回退到 ${VOD_KERNEL_LABELS[activeKernel]}`
    : '当前实际播放内核';

  return (
    <span
      className={cn(
        'cursor-default select-none rounded border px-2 py-0.5 text-xs',
        isFallback
          ? 'border-amber-400/30 bg-amber-500/15 text-amber-100'
          : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100',
      )}
      title={title}
    >
      {label}
    </span>
  );
}
