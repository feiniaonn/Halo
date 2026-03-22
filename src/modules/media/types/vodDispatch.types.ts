import type { VodDetail, VodRoute } from '@/modules/media/types/vodWindow.types';
import type { TvBoxSiteSourceKind } from '@/modules/media/types/tvbox.types';

export type VodDispatchFailureKind = 'timeout' | 'upstream' | 'payload' | 'runtime';
export type VodDispatchHealthState = 'healthy' | 'cooldown' | 'quarantined';
export type VodDispatchBackendStatusState =
  | 'cache-hit'
  | 'attempting'
  | 'success'
  | 'no-match'
  | 'no-routes'
  | 'failed'
  | 'skipped-quarantined';

export interface VodDispatchBackendStat {
  targetSiteKey: string;
  successCount: number;
  failureCount: number;
  lastStatus: string;
  lastFailureKind?: VodDispatchFailureKind | null;
  lastUsedAt: number;
  consecutiveHardFailures: number;
  consecutiveUpstreamFailures: number;
  quarantineUntil: number;
}

export interface VodDispatchBackendStatus {
  targetSiteKey: string;
  targetSiteName: string;
  order: number;
  state: VodDispatchBackendStatusState;
  message?: string;
  failureKind?: VodDispatchFailureKind;
  quarantinedUntil?: number;
  updatedAt: number;
}

export interface VodDispatchCandidate {
  siteKey: string;
  siteName: string;
  sourceKind: TvBoxSiteSourceKind;
  vodId: string;
  matchTitle: string;
  remarks?: string;
  originSiteKey?: string;
  detail?: VodDetail;
  routes?: VodRoute[];
  extInput?: string;
  requiresDetailResolve?: boolean;
}

export interface VodDispatchResolution {
  originSiteKey: string;
  keyword: string;
  cacheHit: boolean;
  matches: VodDispatchCandidate[];
  backendStatuses: VodDispatchBackendStatus[];
}
