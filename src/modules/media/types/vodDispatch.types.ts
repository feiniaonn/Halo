import type { VodDetail, VodRoute } from '@/modules/media/types/vodWindow.types';

export interface VodDispatchCandidate {
  siteKey: string;
  siteName: string;
  sourceKind: 'cms' | 'spider';
  vodId: string;
  matchTitle: string;
  remarks?: string;
  detail: VodDetail;
  routes: VodRoute[];
  extInput: string;
}
