export type VodKernelMode = 'proxy' | 'direct' | 'mpv' | 'potplayer';
export type VodSourceKind = 'cms' | 'spider';

export interface TvBoxRequestHeaderRule {
  host: string;
  header: Record<string, string>;
}

export interface TvBoxPlaybackRule {
  name: string;
  hosts: string[];
  regex: string[];
  script: string[];
}

export interface TvBoxDoH {
  name: string;
  url: string;
  ips: string[];
}

export interface TvBoxHostMapping {
  host: string;
  target: string;
}

/**
 * TVBox config parse/jiexi entry (from the `parses` array in the subscription config).
 * type 0 = direct URL (call {url}{videoPageUrl} -> real stream)
 * type 1 = JSON API
 * type 3 = web/iframe viewer (not usable as direct stream)
 */
export interface TvBoxParse {
  name: string;
  type: number;
  url: string;
  ext?: {
    header?: Record<string, string>;
    flag?: string[];
  };
}

/** Represents one parsed episode (name + play URL). */
export interface VodEpisode {
  name: string;
  url: string;
  searchOnly: boolean;
}

/** A group of episodes from one play route/source. */
export interface VodRoute {
  sourceName: string;
  episodes: VodEpisode[];
}

/** VOD detail metadata */
export interface VodDetail {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_year?: string;
  vod_area?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_content?: string;
  vod_play_from?: string;
  vod_play_url?: string;
}

/** Full launch payload stored in localStorage and emitted to the window */
export interface VodPlayerLaunchPayload {
  sourceKind: VodSourceKind;
  spiderUrl: string;
  siteName?: string;
  siteKey: string;
  apiClass: string;
  ext: string;
  playUrl?: string;
  click?: string;
  playerType?: string;
  vodId: string;
  /** Pre-fetched detail, or null to lazy-fetch inside the player window */
  detail: VodDetail | null;
  routes: VodRoute[];
  /** Which route to start on (index) */
  initialRouteIdx: number;
  /** Which episode to start on (index) */
  initialEpisodeIdx: number;
  initialKernelMode: VodKernelMode;
  /** Jiexi/parse service entries from the subscription config's `parses` array */
  parses?: TvBoxParse[];
  requestHeaders?: TvBoxRequestHeaderRule[];
  playbackRules?: TvBoxPlaybackRule[];
  proxyDomains?: string[];
  hostMappings?: TvBoxHostMapping[];
  adHosts?: string[];
}
