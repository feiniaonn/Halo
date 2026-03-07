export interface DashboardSystemOverview {
  cpuUsage: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  gpuUsage: number | null;
  gpuMemoryUsedBytes: number | null;
  gpuMemoryTotalBytes: number | null;
  gpuMemorySharedUsedBytes: number | null;
  gpuMemorySharedTotalBytes: number | null;
  gpuAdapterDedicatedUsedBytes: number | null;
  gpuAdapterSharedUsedBytes: number | null;
  appCpuUsage: number | null;
  appMemoryUsedBytes: number | null;
  appDiskReadBytesPerSec: number | null;
  appDiskWriteBytesPerSec: number | null;
  appGpuUsage: number | null;
  appGpuMemoryUsedBytes: number | null;
  appGpuMemoryTotalBytes: number | null;
  uptimeSecs: number;
  hostName: string | null;
  osName: string | null;
  osVersion: string | null;
}
