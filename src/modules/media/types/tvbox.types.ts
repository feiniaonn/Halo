import type {
  TvBoxDoH,
  TvBoxHostMapping,
  TvBoxParse,
  TvBoxPlaybackRule,
  TvBoxRequestHeaderRule,
} from "@/modules/media/types/vodWindow.types";

export interface TvBoxRepoUrl {
  url: string;
  name: string;
}

export interface TvBoxClass {
  type_id: string;
  type_name: string;
}

export interface TvBoxVodItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
}

export type VodBrowseMode = "site" | "aggregate";

export interface VodAggregateSourceRef {
  siteKey: string;
  siteName: string;
  sourceKind: TvBoxSiteSourceKind;
  order: number;
}

export interface VodAggregateResultItem extends TvBoxVodItem {
  aggregateSource: VodAggregateSourceRef;
  aggregateKeyword: string;
}

export type VodBrowseItem = TvBoxVodItem | VodAggregateResultItem;

export type VodAggregateSiteState = "idle" | "loading" | "success" | "empty" | "timeout" | "error";

export interface VodAggregateSiteStatus {
  siteKey: string;
  siteName: string;
  state: VodAggregateSiteState;
  order: number;
  resultCount: number;
  message?: string;
  updatedAt: number;
}

export interface VodAggregateSessionState {
  keyword: string;
  siteCount: number;
  completedCount: number;
  successCount: number;
  isRunning: boolean;
  statuses: VodAggregateSiteStatus[];
}

export interface VodResponse {
  class?: TvBoxClass[];
  list?: TvBoxVodItem[];
  pagecount?: number;
  total?: number;
}

export interface VodDetailItem {
  vod_id?: string;
  vod_name?: string;
  vod_pic?: string;
  vod_year?: string;
  vod_area?: string;
  vod_actor?: string;
  vod_director?: string;
  vod_content?: string;
  vod_play_from?: string;
  vod_play_url?: string;
}

export interface VodDetailResponse {
  list?: VodDetailItem[];
}

export interface RawTvBoxSite {
  key?: string;
  name?: string;
  type?: number | string;
  api?: string;
  jar?: string;
  ext?: unknown;
  searchable?: number | string | boolean;
  quickSearch?: number | string | boolean;
  filterable?: number | string | boolean;
  playUrl?: string;
  click?: string;
  playerType?: number | string;
  categories?: unknown;
}

export interface RawTvBoxParse {
  name?: string;
  type?: number | string;
  url?: string;
  ext?: unknown;
}

export interface RawTvBoxConfig {
  spider?: string;
  sites?: RawTvBoxSite[];
  urls?: TvBoxRepoUrl[];
  parses?: RawTvBoxParse[];
  headers?: unknown;
  rules?: unknown;
  doh?: unknown;
  proxy?: unknown;
  proxyRules?: unknown;
  tlsMode?: unknown;
  caBundlePath?: unknown;
  hostnameVerification?: unknown;
  hosts?: unknown;
  ads?: unknown;
  logo?: string;
  wallpaper?: string;
}

export type TvBoxExtKind = "empty" | "text" | "object" | "array" | "url";
export type TvBoxSiteSourceKind = "cms" | "spider";
export type SpiderArtifactKind = "JvmJar" | "DexOnly" | "DexNative" | "Unknown";
export type SpiderExecutionTarget = "desktop-direct" | "desktop-compat-pack" | "desktop-helper";
export type SpiderExecutionPhase = "prefetch" | "profile" | "execute";
export type SpiderRuntimeFamily = "fm-anotherds" | "app-merge-c" | "a0-js-heavy" | "pure-js-bridge" | "unknown";
export type SpiderTransportTarget = "rust-unified" | "java-okhttp" | "java-okhttp-fallback" | "local-helper" | "unknown";
export type SpiderFailureCode =
  | "RemoteArtifactFetchFailed"
  | "ClassSelectionMiss"
  | "RuntimeInitFailed"
  | "RuntimeMethodFailed"
  | "TransportTlsFailed"
  | "TransportProxyFailed"
  | "TransportTimeout"
  | "UpstreamForbidden"
  | "UpstreamMalformedPayload"
  | "PayloadSchemaInvalid"
  | "DependencyMissing"
  | "CapabilityUnsupported"
  | "Unknown";
export type SpiderSourceHealthImpact = "none" | "soft" | "hard";
export type SpiderFailureKind =
  | "FetchError"
  | "TransformError"
  | "MissingDependency"
  | "NeedsContextShim"
  | "NeedsCompatPack"
  | "NeedsLocalHelper"
  | "NativeMethodBlocked"
  | "ClassSelectionError"
  | "InitError"
  | "SiteRuntimeError"
  | "ResponseShapeError"
  | "Timeout"
  | "Unknown";
export type SpiderRuntimeStatus =
  | "idle"
  | "checking"
  | "desktop-ready"
  | "needs-compat-pack"
  | "needs-local-helper"
  | "missing-dependency"
  | "site-error"
  | "temporarily-disabled";

export type TvBoxTlsMode = "strict" | "allow_invalid";
export type TvBoxHostnameVerificationMode = "strict" | "allow_invalid";

export interface TvBoxProxyRule {
  host: string;
  proxyUrl: string;
}

export interface SpiderFeatureFlags {
  unifiedRequestPolicyV1: boolean;
  spiderExecutionEnvelopeV1: boolean;
  normalizedPayloadV1: boolean;
  spiderTaskManagerV1: boolean;
}

export interface SpiderExecutionTimings {
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
}

export interface SpiderExecutionDiagnostics {
  requestId: string;
  rootCause?: string | null;
  fallbackUsed: boolean;
  schemaVersion: number;
}

export interface SpiderArtifactAnalysis {
  artifactKind: SpiderArtifactKind;
  requiredRuntime: SpiderExecutionTarget;
  transformable: boolean;
  originalJarPath: string;
  preparedJarPath: string;
  classInventory: string[];
  nativeLibs: string[];
}

export interface SpiderSiteProfile {
  className: string;
  hasContextInit: boolean;
  declaresContextInit: boolean;
  hasNonContextInit: boolean;
  hasNativeInit: boolean;
  hasNativeContentMethod: boolean;
  nativeMethods: string[];
  initSignatures: string[];
  needsContextShim: boolean;
  requiredCompatPacks: string[];
  requiredHelperPorts: number[];
  recommendedTarget: SpiderExecutionTarget;
  routingReason?: string | null;
}

export interface SpiderExecutionReport {
  ok: boolean;
  siteKey: string;
  method: string;
  phase?: SpiderExecutionPhase;
  runtimeFamily?: SpiderRuntimeFamily;
  executionTarget: SpiderExecutionTarget;
  transportTarget?: SpiderTransportTarget;
  className?: string | null;
  failureKind?: SpiderFailureKind | null;
  failureCode?: SpiderFailureCode | null;
  failureMessage?: string | null;
  missingDependency?: string | null;
  retryable?: boolean;
  sourceHealthImpact?: SpiderSourceHealthImpact;
  requestId?: string;
  checkedAtMs: number;
  timings?: SpiderExecutionTimings;
  diagnostics?: SpiderExecutionDiagnostics;
  featureFlags?: SpiderFeatureFlags;
  artifact?: SpiderArtifactAnalysis | null;
  siteProfile?: SpiderSiteProfile | null;
}

export interface NormalizedSpiderMethodResponse<T = unknown> {
  schemaVersion: number;
  siteKey: string;
  method: string;
  rawPayload: string;
  normalizedPayload: T;
  report: SpiderExecutionReport;
  envelope: {
    ok: boolean;
    siteKey: string;
    method: string;
    phase: SpiderExecutionPhase;
    runtimeFamily: SpiderRuntimeFamily;
    executionTarget: SpiderExecutionTarget | string;
    transportTarget: SpiderTransportTarget;
    failureCode?: SpiderFailureCode | null;
    retryable: boolean;
    sourceHealthImpact: SpiderSourceHealthImpact;
    timings: SpiderExecutionTimings;
    payload?: T | null;
    diagnostics: SpiderExecutionDiagnostics;
  };
}

export interface SpiderPrefetchResult {
  originalJarPath: string;
  preparedJarPath: string;
  artifact: SpiderArtifactAnalysis;
}

export interface SpiderSiteRuntimeState {
  runtimeStatus: SpiderRuntimeStatus;
  executionTarget: SpiderExecutionTarget;
  healthCheckedAt: number | null;
  lastReportMethod?: string;
  lastFailureKind?: SpiderFailureKind;
  lastFailureCode?: SpiderFailureCode;
  lastFailureMessage?: string;
  missingDependency?: string;
  failureCount: number;
  softDisabled: boolean;
  artifact?: SpiderArtifactAnalysis;
  siteProfile?: SpiderSiteProfile;
  requiredCompatPacks: string[];
  requiredHelperPorts: number[];
}

export interface CompatHelperStatus {
  running: boolean;
  healthy: boolean;
  pid?: number | null;
  ports: number[];
  startedAtMs?: number | null;
  helperJarPath?: string | null;
  lastFailure?: string | null;
}

export interface CompatHelperTrace {
  port: number;
  method: string;
  path: string;
  query: string;
  targetUrl?: string | null;
  responseStatus?: number | null;
  failure?: string | null;
  bodySnippet?: string | null;
  capturedAtMs: number;
}

export interface TvBoxSiteCapability {
  sourceKind: TvBoxSiteSourceKind;
  canHome: boolean;
  canCategory: boolean;
  canSearch: boolean;
  searchOnly: boolean;
  displayOnly: boolean;
  requiresSpider: boolean;
  supportsDetail: boolean;
  supportsPlay: boolean;
  mayNeedParse: boolean;
  supportsBrowserParse: boolean;
  hasRemoteExt: boolean;
  hasPlayUrl: boolean;
  hasPresetCategories: boolean;
}

export interface NormalizedTvBoxSite {
  key: string;
  name: string;
  type: number;
  api: string;
  jar: string;
  ext: unknown;
  extKind: TvBoxExtKind;
  extValue: string;
  searchable: boolean;
  quickSearch: boolean;
  filterable: boolean;
  playUrl: string;
  click: string;
  playerType: string;
  categories: string[];
  capability: TvBoxSiteCapability;
}

export interface NormalizedTvBoxConfig {
  spider: string;
  sites: NormalizedTvBoxSite[];
  urls: TvBoxRepoUrl[];
  parses: TvBoxParse[];
  headers: TvBoxRequestHeaderRule[];
  rules: TvBoxPlaybackRule[];
  doh: TvBoxDoH[];
  proxy: string[];
  proxyRules: TvBoxProxyRule[];
  tlsMode: TvBoxTlsMode;
  caBundlePath: string;
  hostnameVerification: TvBoxHostnameVerificationMode;
  hosts: TvBoxHostMapping[];
  ads: string[];
  logo: string;
  wallpaper: string;
}
