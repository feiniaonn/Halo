import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  buildCheckingSpiderRuntimeState,
  buildSpiderFailureNotice,
  mergePrefetchArtifactState,
  mergeSpiderExecutionReport,
  resetSpiderRuntimeIsolation,
  shouldBlockAutoLoad,
} from "@/modules/media/services/spiderRuntime";
import {
  isSupportedSourceTarget,
  loadVodRepoSource,
  loadVodSource,
  normalizeSourceTarget,
  readSpiderExecutionReport,
} from "@/modules/media/services/mediaSourceLoader";
import {
  buildAggregateSessionState,
  getDefaultVodBrowseMode,
} from "@/modules/media/services/vodAggregateSearch";
import { executeAggregateVodSearch } from "@/modules/media/services/vodAggregateExecutor";
import {
  filterAggregateAutoSearchSites,
  GLOBAL_VOD_DISPATCH_ORIGIN_SITE_KEY,
} from "@/modules/media/services/vodDispatchHealth";
import {
  buildVodAggregateCacheKey,
  buildVodBrowseSessionCachePrefix,
  buildVodCategoryCacheKey,
  buildVodHomeCacheKey,
} from "@/modules/media/services/vodBrowseCacheKeys";
import {
  mergeVodBrowseItems,
  normalizeVodRequestErrorMessage,
  withVodInterfaceTimeout,
} from "@/modules/media/services/vodBrowseRuntime";
import { getVodMetadataHomeFallbackTarget } from "@/modules/media/services/vodMetadataFallback";
import { useVodDispatchActions } from "@/modules/media/hooks/useVodDispatchActions";
import { useVodSpiderWarmup } from "@/modules/media/hooks/useVodSpiderWarmup";
import {
  getSpiderRuntimeWarmupPromise as getWarmupPromiseFromMap,
  triggerSpiderRuntimeWarmup,
} from "@/modules/media/services/vodSpiderWarmup";
import {
  clearVodSourceSelectionSnapshot,
  pickStoredSiteKey,
  readVodSourceSelectionSnapshot,
  writeVodSourceSelectionSnapshot,
} from "@/modules/media/services/vodSourceSelection";
import { sortVodSitesByRanking } from "@/modules/media/services/vodSourceRanking";
import { useVodDispatchBackendStats } from "@/modules/media/hooks/useVodDispatchBackendStats";
import { useVodSiteRankings } from "@/modules/media/hooks/useVodSiteRankings";
import {
  loadPersistedAggregateSearchCache,
  savePersistedAggregateSearchCache,
} from "@/modules/media/services/vodPersistentCache";
import {
  deleteTimedCacheByPrefix,
  readTimedCache,
  writeTimedCache,
} from "@/modules/media/services/vodSourceCache";
import { clearVodImageProxyCache } from "@/modules/media/services/vodImageProxy";
import {
  buildPresetClasses,
  parseSingleSource,
  parseVodResponse,
  resolveSiteSpiderUrl,
} from "@/modules/media/services/tvboxConfig";
import { openVodPlayerWindow } from "@/modules/media/services/vodPlayerWindow";
import { clearTvBoxRuntimeCaches, resolveSiteExtInput } from "@/modules/media/services/tvboxRuntime";
import type { MediaNotice } from "@/modules/media/types/mediaPage.types";
import type {
  CompatHelperStatus,
  NormalizedTvBoxConfig,
  SpiderExecutionReport,
  SpiderPrefetchResult,
  SpiderSiteRuntimeState,
  VodAggregateResultItem,
  VodAggregateSessionState,
  VodBrowseItem,
  VodBrowseMode,
  TvBoxClass,
  TvBoxRepoUrl,
} from "@/modules/media/types/tvbox.types";
import type {
  AggregateCacheEntry,
  CategoryCacheEntry,
  HomeCacheEntry,
  MediaNetworkPolicyStatus,
} from "@/modules/media/types/vodSourceController.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

const MEDIA_VOD_SOURCE_KEY = "halo_media_source_vod_single";
const MEDIA_VOD_SITE_KEY = "halo_media_active_site_key";
const VOD_BROWSE_CACHE_TTL_MS = 5 * 60 * 1000;
const VOD_AGGREGATE_CACHE_TTL_MS = 2 * 60 * 1000;
const VOD_EXT_PREFETCH_CONCURRENCY = 6;
const VOD_AGGREGATE_SEARCH_CONCURRENCY = 8;
const VOD_BACKGROUND_WARMUP_CONCURRENCY = 2;
const VOD_BACKGROUND_WARMUP_MAX_SITES = 4;

type SpiderJarStatus = "idle" | "loading" | "ready" | "error";

interface UseVodSourceControllerOptions {
  notify: (notice: MediaNotice) => void;
}

export function useVodSourceController({ notify }: UseVodSourceControllerOptions) {
  const [source, setSource] = useState(() => localStorage.getItem(MEDIA_VOD_SOURCE_KEY)?.trim() ?? "");
  const [draft, setDraft] = useState(source);

  const [repoUrls, setRepoUrls] = useState<TvBoxRepoUrl[]>([]);
  const [activeRepoUrl, setActiveRepoUrl] = useState("");
  const [config, setConfig] = useState<NormalizedTvBoxConfig | null>(null);
  const [activeSiteKey, setActiveSiteKey] = useState("");
  const [siteRuntimeStates, setSiteRuntimeStates] = useState<Record<string, SpiderSiteRuntimeState>>({});
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [spiderJarStatus, setSpiderJarStatus] = useState<SpiderJarStatus>("idle");
  const [siteReloadToken, setSiteReloadToken] = useState(0);
  const [networkPolicyGeneration, setNetworkPolicyGeneration] = useState(1);
  const [browseMode, setBrowseMode] = useState<VodBrowseMode>("site");
  const [aggregateSessionState, setAggregateSessionState] = useState<VodAggregateSessionState | null>(null);

  const [classFilterKeyword, setClassFilterKeyword] = useState("");
  const [vodSearchKeyword, setVodSearchKeyword] = useState("");
  const [activeSearchKeyword, setActiveSearchKeyword] = useState("");
  const [vodClasses, setVodClasses] = useState<TvBoxClass[]>([]);
  const [activeClassId, setActiveClassId] = useState("");
  const [vodList, setVodList] = useState<VodBrowseItem[]>([]);
  const [loadingVod, setLoadingVod] = useState(false);
  const [vodPage, setVodPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedVodId, setSelectedVodId] = useState<string | null>(null);
  const [selectedVodTitle, setSelectedVodTitle] = useState<string | null>(null);
  const [selectedVodSiteKey, setSelectedVodSiteKey] = useState<string | null>(null);

  const activeSiteKeyRef = useRef("");
  const activeRepoUrlRef = useRef("");
  const sourceRef = useRef(source);
  const activeClassIdRef = useRef("");
  const runtimeSessionKeyRef = useRef("");
  const browseModeRef = useRef<VodBrowseMode>("site");
  const networkPolicyGenerationRef = useRef(1);
  const prefetchPromiseRef = useRef<Promise<SpiderPrefetchResult | null> | null>(null);
  const runtimeWarmupPromisesRef = useRef(new Map<string, Promise<SpiderPrefetchResult | null>>());
  const homeCacheRef = useRef(new Map<string, { value: HomeCacheEntry; expiresAt: number }>());
  const categoryCacheRef = useRef(new Map<string, { value: CategoryCacheEntry; expiresAt: number }>());
  const aggregateCacheRef = useRef(new Map<string, { value: AggregateCacheEntry; expiresAt: number }>());
  const homeRequestRef = useRef(0);
  const homeInFlightRef = useRef("");
  const categoryRequestRef = useRef(0);
  const categoryInFlightRef = useRef("");
  const searchRequestRef = useRef(0);
  const searchInFlightRef = useRef("");
  const skipInitialCategoryFetchRef = useRef<{
    siteKey: string;
    classId: string;
  } | null>(null);
  const suppressInitialMetadataCategoryWarningRef = useRef<{
    siteKey: string;
    classId: string;
  } | null>(null);
  const controllerGenerationRef = useRef(0);
  const dispatchSearchSessionRef = useRef(0);

  useEffect(() => {
    activeSiteKeyRef.current = activeSiteKey;
  }, [activeSiteKey]);

  useEffect(() => {
    activeRepoUrlRef.current = activeRepoUrl;
  }, [activeRepoUrl]);

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const { siteRankings, recordSiteSuccess } = useVodSiteRankings(source, activeRepoUrl);
  const { backendStats: aggregateDispatchBackendStats, recordBackendSuccess: recordAggregateBackendSuccess, recordBackendFailure: recordAggregateBackendFailure } = useVodDispatchBackendStats(
    source,
    activeRepoUrl,
    GLOBAL_VOD_DISPATCH_ORIGIN_SITE_KEY,
  );
  const { backendStats: activeOriginDispatchBackendStats } = useVodDispatchBackendStats(
    source,
    activeRepoUrl,
    activeSiteKey,
  );

  useEffect(() => {
    activeClassIdRef.current = activeClassId;
  }, [activeClassId]);

  useEffect(() => {
    browseModeRef.current = browseMode;
  }, [browseMode]);

  useEffect(() => {
    networkPolicyGenerationRef.current = networkPolicyGeneration;
  }, [networkPolicyGeneration]);

  const runtimeSessionKey = useMemo(
    () => [source.trim(), activeRepoUrl.trim() || "__root__", String(networkPolicyGeneration)].join("::"),
    [activeRepoUrl, networkPolicyGeneration, source],
  );

  useEffect(() => {
    runtimeSessionKeyRef.current = runtimeSessionKey;
  }, [runtimeSessionKey]);

  const invalidateVodRequests = useCallback(() => {
    homeRequestRef.current += 1;
    categoryRequestRef.current += 1;
    searchRequestRef.current += 1;
    dispatchSearchSessionRef.current += 1;
    homeInFlightRef.current = "";
    categoryInFlightRef.current = "";
    searchInFlightRef.current = "";
    void invoke<number>("cancel_spider_tasks", { siteKey: null }).catch(() => {
      // Ignore best-effort cancellation failures and let generation guards discard stale results.
    });
    setLoadingVod(false);
    setLoadingMore(false);
  }, []);

  const advanceControllerGeneration = useCallback(() => {
    controllerGenerationRef.current += 1;
    return controllerGenerationRef.current;
  }, []);

  const isStaleControllerGeneration = useCallback(
    (generation: number) => generation !== controllerGenerationRef.current,
    [],
  );

  const beginDispatchSearchSession = useCallback(() => {
    dispatchSearchSessionRef.current += 1;
    return dispatchSearchSessionRef.current;
  }, []);

  const isStaleDispatchSearchSession = useCallback(
    (generation: number, sessionId: number) => {
      if (isStaleControllerGeneration(generation)) {
        return true;
      }
      return sessionId !== dispatchSearchSessionRef.current;
    },
    [isStaleControllerGeneration],
  );

  const clearSpiderExecutionReport = useCallback((siteKey?: string | null) => {
    const normalizedSiteKey = siteKey?.trim() ?? "";
    void invoke("clear_spider_execution_report", {
      siteKey: normalizedSiteKey || null,
    }).catch(() => {
      // Ignore cleanup failures and let the next execution report overwrite stale state.
    });
  }, []);

  const clearBrowseCaches = useCallback((siteKey?: string) => {
    const prefix = buildVodBrowseSessionCachePrefix(runtimeSessionKeyRef.current, siteKey);
    deleteTimedCacheByPrefix(homeCacheRef.current, prefix);
    deleteTimedCacheByPrefix(categoryCacheRef.current, prefix);
    deleteTimedCacheByPrefix(aggregateCacheRef.current, buildVodBrowseSessionCachePrefix(runtimeSessionKeyRef.current));
  }, []);

  const resetVodRuntimeState = useCallback(() => {
    invalidateVodRequests();
    clearSpiderExecutionReport();
    clearTvBoxRuntimeCaches(runtimeSessionKeyRef.current);
    runtimeWarmupPromisesRef.current.clear();
    clearBrowseCaches();
    clearVodImageProxyCache();
    setSiteRuntimeStates({});
    setSpiderJarStatus("idle");
    setAggregateSessionState(null);
    setLoadingVod(false);
    setLoadingMore(false);
  }, [clearBrowseCaches, clearSpiderExecutionReport, invalidateVodRequests]);

  const persistSelection = useCallback((next: {
    source?: string;
    repoUrl?: string;
    siteKey?: string;
  }) => {
    const snapshotSource = (next.source ?? sourceRef.current).trim();
    if (!snapshotSource) return;

    const snapshotRepoUrl = (next.repoUrl ?? activeRepoUrlRef.current).trim();
    const snapshotSiteKey = (next.siteKey ?? activeSiteKeyRef.current).trim();
    writeVodSourceSelectionSnapshot({
      source: snapshotSource,
      repoUrl: snapshotRepoUrl,
      siteKey: snapshotSiteKey,
    });
    if (snapshotSiteKey) {
      localStorage.setItem(MEDIA_VOD_SITE_KEY, snapshotSiteKey);
    }
  }, []);

  const resetVodBrowseState = useCallback(() => {
    skipInitialCategoryFetchRef.current = null;
    suppressInitialMetadataCategoryWarningRef.current = null;
    setClassFilterKeyword("");
    setVodSearchKeyword("");
    setActiveSearchKeyword("");
    setAggregateSessionState(null);
    setVodClasses([]);
    setActiveClassId("");
    setVodList([]);
    setVodPage(1);
    setHasMore(true);
    setSelectedVodId(null);
    setSelectedVodTitle(null);
    setSelectedVodSiteKey(null);
  }, []);

  const selectVodItem = useCallback((item: VodBrowseItem | null) => {
    setSelectedVodId(item?.vod_id ?? null);
    setSelectedVodTitle(item?.vod_name?.trim() || null);
    setSelectedVodSiteKey(
      item && "aggregateSource" in item
        ? item.aggregateSource.siteKey
        : activeSiteKeyRef.current || null,
    );
  }, []);

  const clearSelectedVod = useCallback(() => {
    invalidateVodRequests();
    setSelectedVodId(null);
    setSelectedVodTitle(null);
    setSelectedVodSiteKey(null);
  }, [invalidateVodRequests]);

  useEffect(() => () => {
    controllerGenerationRef.current += 1;
    invalidateVodRequests();
  }, [invalidateVodRequests]);

  const filteredVodClasses = useMemo(() => {
    const keyword = classFilterKeyword.trim().toLowerCase();
    if (!keyword) return vodClasses;
    return vodClasses.filter((item) => item.type_name.toLowerCase().includes(keyword));
  }, [classFilterKeyword, vodClasses]);

  const activeVodSite = useMemo(() => config?.sites.find((site) => site.key === activeSiteKey) ?? null, [activeSiteKey, config]);

  const activeSiteRuntime = useMemo(() => (activeSiteKey ? siteRuntimeStates[activeSiteKey] ?? null : null), [activeSiteKey, siteRuntimeStates]);

  const prioritizedSites = useMemo(() => (config ? sortVodSitesByRanking(config.sites, siteRankings, activeSiteKey) : []), [activeSiteKey, config, siteRankings]);

  const aggregateEligibleSites = useMemo(
    () => filterAggregateAutoSearchSites(prioritizedSites, aggregateDispatchBackendStats),
    [aggregateDispatchBackendStats, prioritizedSites],
  );

  const supportsAggregateBrowse = aggregateEligibleSites.length > 1;
  const effectiveBrowseMode = supportsAggregateBrowse ? browseMode : "site";

  const selectedVodSite = useMemo(() => config?.sites.find((site) => site.key === selectedVodSiteKey) ?? activeVodSite, [activeVodSite, config, selectedVodSiteKey]);

  const activeSiteAutoLoadBlocked = useMemo(() => shouldBlockAutoLoad(activeSiteRuntime), [activeSiteRuntime]);

  const detailEnabled = !!activeVodSite?.capability.supportsDetail;

  useEffect(() => {
    const policy = config ? {
      requestHeaders: config.headers,
      hostMappings: config.hosts,
      doh: config.doh,
    } : null;

    invoke("set_media_network_policy", { policy }).catch((error) => {
      console.warn("[Media] Failed to sync network policy:", error);
    });
  }, [config]);

  useEffect(() => {
    if (!config) return;

    invoke<MediaNetworkPolicyStatus>("get_media_network_policy_status")
      .then((status) => {
        setNetworkPolicyGeneration(status.generation || 1);
        if (status.doh_entry_count > 0 && !status.supports_doh_resolver) {
          notify({
            kind: "warning",
            text: `当前源包含 ${status.doh_entry_count} 条 DoH 配置，但桌面端暂未接入自定义 DNS 解析器；其余 headers/hosts 规则已生效。`,
          });
          return;
        }

        if ((status.unsupported_doh_entry_count ?? 0) > 0 && status.active_doh_provider_name) {
          notify({
            kind: "warning",
            text: `当前已启用 ${status.active_doh_provider_name}，但还有 ${status.unsupported_doh_entry_count} 条自定义 DoH 配置暂未接入；其余网络策略已生效。`,
          });
        }
      })
      .catch((error) => {
        console.warn("[Media] Failed to read network policy status:", error);
      });
  }, [config, notify]);

  useEffect(() => {
    if (supportsAggregateBrowse) {
      return;
    }
    if (browseModeRef.current !== "site") {
      setBrowseMode("site");
    }
  }, [supportsAggregateBrowse]);

  const syncDraft = useCallback(() => {
    setDraft(source);
  }, [source]);

  const applySpiderPrefetchState = useCallback((siteKey: string, result: SpiderPrefetchResult) => {
    if (!siteKey) return;
    setSiteRuntimeStates((current) => ({
      ...current,
      [siteKey]: mergePrefetchArtifactState(current[siteKey], result.artifact),
    }));
  }, []);

  const applySpiderExecutionState = useCallback((siteKey: string, report: SpiderExecutionReport | null) => {
    if (!siteKey || !report) return;
    setSiteRuntimeStates((current) => ({
      ...current,
      [siteKey]: mergeSpiderExecutionReport(current[siteKey], report),
    }));
  }, []);

  const syncSpiderExecutionState = useCallback(async (siteKey: string) => {
    const report = await readSpiderExecutionReport(siteKey);
    if (report) {
      applySpiderExecutionState(siteKey, report);
      if (report.executionTarget === "desktop-helper") {
        try {
          await invoke<CompatHelperStatus>("compat_helper_status");
        } catch {
          // Ignore helper status probe failures here.
        }
      }
    }
    return report;
  }, [applySpiderExecutionState]);

  const syncCompatHelperStatus = useCallback(async () => {
    try {
      return await invoke<CompatHelperStatus>("compat_helper_status");
    } catch {
      return null;
    }
  }, []);

  const resolveSiteExt = useCallback((
    site: Pick<NonNullable<NormalizedTvBoxConfig["sites"][number]>, "api" | "extKind" | "extValue">,
    options?: { forceRefresh?: boolean },
  ) => {
    return resolveSiteExtInput(site, {
      sessionKey: runtimeSessionKeyRef.current,
      policyGeneration: networkPolicyGenerationRef.current,
      forceRefresh: options?.forceRefresh,
    });
  }, []);

  const getSpiderRuntimeWarmupPromise = useCallback((spiderUrl: string, apiClass: string) => {
    return getWarmupPromiseFromMap(runtimeWarmupPromisesRef.current, spiderUrl, apiClass);
  }, []);

  const triggerJarPrefetch = useCallback((
    siteKey: string,
    spiderUrl: string,
    apiClass: string,
    ext: string,
    options?: { trackAsActive?: boolean; profileSite?: boolean; notifyOnFailure?: boolean },
  ) => {
    return triggerSpiderRuntimeWarmup({
      siteKey,
      spiderUrl,
      apiClass,
      ext,
      generation: controllerGenerationRef.current,
      runtimeWarmupPromises: runtimeWarmupPromisesRef.current,
      activePrefetchPromiseRef: prefetchPromiseRef,
      isStaleControllerGeneration,
      clearSpiderExecutionReport,
      applySpiderPrefetchState,
      applySpiderExecutionState,
      syncCompatHelperStatus,
      onSetSiteChecking: (nextSiteKey) => {
        setSiteRuntimeStates((current) => ({
          ...current,
          [nextSiteKey]: buildCheckingSpiderRuntimeState(current[nextSiteKey]),
        }));
      },
      onSetSpiderJarStatus: setSpiderJarStatus,
      onNotifyWarning: (message) => notify({ kind: "warning", text: message }),
      shouldTrackAsActive: options?.trackAsActive,
      shouldProfileSite: options?.profileSite,
      notifyOnFailure: options?.notifyOnFailure,
    });
  }, [
    applySpiderExecutionState,
    applySpiderPrefetchState,
    clearSpiderExecutionReport,
    isStaleControllerGeneration,
    notify,
    syncCompatHelperStatus,
  ]);

  const openVodFromDetail = useCallback(async (
    site: NonNullable<typeof activeVodSite>,
    extInput: string,
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx = 0,
    episodeIdx = 0,
  ) => {
    try {
      await openVodPlayerWindow({
        sourceKey: source,
        repoUrl: activeRepoUrl || undefined,
        sourceKind: site.capability.sourceKind,
        spiderUrl: resolveSiteSpiderUrl(site, config?.spider),
        siteName: site.name,
        siteKey: site.key,
        apiClass: site.api,
        ext: extInput,
        playUrl: site.playUrl || undefined,
        click: site.click || undefined,
        playerType: site.playerType || undefined,
        vodId: detail.vod_id,
        detail,
        routes,
        initialRouteIdx: routeIdx,
        initialEpisodeIdx: episodeIdx,
        initialKernelMode: "direct",
        parses: config?.parses,
        requestHeaders: config?.headers,
        playbackRules: config?.rules,
        proxyDomains: config?.proxy,
        hostMappings: config?.hosts,
        adHosts: config?.ads,
      });
    } catch (err) {
      console.error("[VOD Controller] Failed to open player window:", err);
      const message = err instanceof Error ? err.message : String(err);
      notify({ kind: "error", text: `打开播放窗口失败: ${message}` });
    }
  }, [
    activeRepoUrl,
    config?.ads,
    config?.headers,
    config?.hosts,
    config?.parses,
    config?.proxy,
    config?.rules,
    config?.spider,
    notify,
    source,
  ]);

  const { playDispatchCandidate, resolveMsearchMatches, resolveMsearchAndPlay } = useVodDispatchActions({
    config,
    activeSiteKey,
    activeSiteKeyRef,
    sourceRef,
    activeRepoUrlRef,
    runtimeSessionKeyRef,
    networkPolicyGenerationRef,
    controllerGenerationRef,
    beginDispatchSearchSession,
    isStaleDispatchSearchSession,
    resolveSiteExt,
    getSpiderRuntimeWarmupPromise,
    syncSpiderExecutionState,
    recordSiteSuccess,
    clearSelectedVod,
    openVodFromDetail,
    notify,
  });

  const selectRepo = useCallback(async (repo: TvBoxRepoUrl) => {
    if (!repo.url) return;
    const generation = advanceControllerGeneration();
    const storedSelection = readVodSourceSelectionSnapshot();

    setLoadingConfig(true);
    setConfig(null);
    setActiveRepoUrl(repo.url);
    setActiveSiteKey("");
    resetVodRuntimeState();
    resetVodBrowseState();

    try {
      const normalized = await loadVodRepoSource(repo.url);
      if (isStaleControllerGeneration(generation)) return;
      setConfig(normalized);
      setBrowseMode(getDefaultVodBrowseMode(normalized.sites));
      const legacySiteKey = localStorage.getItem(MEDIA_VOD_SITE_KEY) ?? "";
      const preferredSiteKey = storedSelection?.source === sourceRef.current && storedSelection.repoUrl === repo.url
        ? storedSelection.siteKey
        : legacySiteKey;
      const restoredKey = pickStoredSiteKey(normalized.sites, preferredSiteKey);
      setActiveSiteKey(restoredKey);
      persistSelection({ repoUrl: repo.url, siteKey: restoredKey });
      notify({ kind: "success", text: `已加载分仓 [${repo.name}]，共 ${normalized.sites.length} 个站点。` });
    } catch (reason) {
      if (isStaleControllerGeneration(generation)) return;
      console.error(reason);
      notify({ kind: "error", text: `分仓 [${repo.name}] 解析失败。` });
    } finally {
      if (!isStaleControllerGeneration(generation)) {
        setLoadingConfig(false);
      }
    }
  }, [
    advanceControllerGeneration,
    isStaleControllerGeneration,
    notify,
    persistSelection,
    resetVodBrowseState,
    resetVodRuntimeState,
  ]);

  const loadSourceConfig = useCallback(async (url: string) => {
    if (!url) return;
    const generation = advanceControllerGeneration();
    const storedSelection = readVodSourceSelectionSnapshot();
    const preferredRepoUrl = storedSelection?.source === url
      ? storedSelection.repoUrl
      : "";

    setLoadingConfig(true);
    setRepoUrls([]);
    setActiveRepoUrl("");
    setActiveSiteKey("");
    setConfig(null);
    resetVodRuntimeState();
    resetVodBrowseState();

    try {
      const loaded = await loadVodSource(url, preferredRepoUrl);
      if (isStaleControllerGeneration(generation)) return;
      setRepoUrls(loaded.repoUrls);
      setActiveRepoUrl(loaded.activeRepoUrl);
      setConfig(loaded.config);
      setBrowseMode(getDefaultVodBrowseMode(loaded.config.sites));
      const legacySiteKey = localStorage.getItem(MEDIA_VOD_SITE_KEY) ?? "";
      const preferredSiteKey = storedSelection?.source === url && storedSelection.repoUrl === loaded.activeRepoUrl
        ? storedSelection.siteKey
        : legacySiteKey;
      const restoredKey = pickStoredSiteKey(loaded.config.sites, preferredSiteKey);
      setActiveSiteKey(restoredKey);
      persistSelection({
        source: url,
        repoUrl: loaded.activeRepoUrl,
        siteKey: restoredKey,
      });

      if (loaded.repoUrls.length > 0) {
        notify({ kind: "success", text: `检测到多仓配置，共 ${loaded.repoUrls.length} 个分仓。` });
      } else {
        notify({ kind: "success", text: `已加载 ${loaded.config.sites.length} 个站点。` });
      }
    } catch (reason) {
      if (isStaleControllerGeneration(generation)) return;
      console.error(reason);
      const message = reason instanceof Error ? reason.message : String(reason);
      notify({
        kind: "error",
        text: message.includes("JSON") || message.includes("empty response")
          ? "本地解析失败，且兜底解密未获得有效配置。"
          : `解析源失败: ${message}`,
      });
    } finally {
      if (!isStaleControllerGeneration(generation)) {
        setLoadingConfig(false);
      }
    }
  }, [
    advanceControllerGeneration,
    isStaleControllerGeneration,
    notify,
    persistSelection,
    resetVodBrowseState,
    resetVodRuntimeState,
  ]);

  useEffect(() => {
    if (!source) {
      setRepoUrls([]);
      setActiveRepoUrl("");
      setConfig(null);
      setActiveSiteKey("");
      setBrowseMode("site");
      resetVodRuntimeState();
      resetVodBrowseState();
      return;
    }
    void loadSourceConfig(source);
  }, [loadSourceConfig, resetVodBrowseState, resetVodRuntimeState, source]);

  useVodSpiderWarmup({
    config,
    activeSiteKey,
    activeVodSite,
    activeSiteExecutionTarget: activeSiteRuntime?.executionTarget,
    prioritizedSites,
    activeOriginDispatchBackendStats,
    aggregateDispatchBackendStats,
    runtimeSessionKey,
    networkPolicyGeneration,
    siteReloadToken,
    extPrefetchConcurrency: VOD_EXT_PREFETCH_CONCURRENCY,
    backgroundWarmupConcurrency: VOD_BACKGROUND_WARMUP_CONCURRENCY,
    backgroundWarmupMaxSites: VOD_BACKGROUND_WARMUP_MAX_SITES,
    resolveSiteExt,
    triggerJarPrefetch,
    syncCompatHelperStatus,
  });

  useEffect(() => {
    const fetchHomeContent = async () => {
      if (!activeSiteKey || !config || activeSearchKeyword) return;
      const site = config.sites.find((item) => item.key === activeSiteKey);
      if (!site) return;
      if (site.capability.requiresSpider && activeSiteAutoLoadBlocked) {
        setLoadingVod(false);
        return;
      }

      const presetClasses = buildPresetClasses(site);
      if (!site.capability.canHome) {
        skipInitialCategoryFetchRef.current = null;
        suppressInitialMetadataCategoryWarningRef.current = null;
        setVodClasses(presetClasses);
        setActiveClassId(presetClasses[0]?.type_id ?? "");
        setVodList([]);
        setHasMore(false);
        return;
      }

      const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
      const requestId = ++homeRequestRef.current;
      const requestedSiteKey = site.key;
      const isStale = () => requestId !== homeRequestRef.current || requestedSiteKey !== activeSiteKeyRef.current;
      const flightKey = [site.key, site.api, spiderUrl, String(siteReloadToken)].join("::");
      if (homeInFlightRef.current === flightKey) {
        return;
      }
      homeInFlightRef.current = flightKey;

      const cachedHome = readTimedCache(
        homeCacheRef.current,
        buildVodHomeCacheKey(runtimeSessionKeyRef.current, site.key),
      );
      if (cachedHome) {
        skipInitialCategoryFetchRef.current = cachedHome.shouldSkipInitialCategoryFetch
          ? { siteKey: site.key, classId: cachedHome.activeClassId }
          : null;
        suppressInitialMetadataCategoryWarningRef.current = null;
        setVodPage(1);
        setHasMore(true);
        setVodClasses(cachedHome.classes);
        setActiveClassId(cachedHome.activeClassId);
        setVodList(cachedHome.list);
        homeInFlightRef.current = "";
        setLoadingVod(false);
        return;
      }

      setLoadingVod(true);
      setVodPage(1);
      setHasMore(true);

      try {
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExt(site), `home_ext:${site.key}`)
          : site.extValue;
        const runtimeWarmup = site.capability.requiresSpider && spiderUrl
          ? getSpiderRuntimeWarmupPromise(spiderUrl, site.api)
          : null;
        if (runtimeWarmup) {
          await runtimeWarmup;
          if (isStale()) return;
        }
        const response = site.capability.requiresSpider
          ? await invoke<string>("spider_home", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
          })
          : await withVodInterfaceTimeout(invoke<string>("fetch_vod_home", {
            apiUrl: site.api,
          }), `home:${site.key}`);

        const data = parseVodResponse(response);
        if (site.capability.requiresSpider) {
          await syncSpiderExecutionState(site.key);
        }
        if (isStale()) return;

        const classes = Array.isArray(data.class) && data.class.length > 0 ? data.class : presetClasses;
        const nextClassId = classes[0]?.type_id ?? "";
        const homeList = Array.isArray(data.list) ? data.list : [];
        skipInitialCategoryFetchRef.current = nextClassId && homeList.length > 0 && site.capability.canCategory
          ? { siteKey: site.key, classId: nextClassId }
          : null;
        writeTimedCache(homeCacheRef.current, buildVodHomeCacheKey(runtimeSessionKeyRef.current, site.key), {
          classes,
          activeClassId: nextClassId,
          list: homeList,
          shouldSkipInitialCategoryFetch: Boolean(skipInitialCategoryFetchRef.current),
        }, VOD_BROWSE_CACHE_TTL_MS);
        suppressInitialMetadataCategoryWarningRef.current = null;
        setVodClasses(classes);
        setActiveClassId(nextClassId);
        setVodList(homeList);
      } catch (reason) {
        if (isStale()) return;
        console.error("Failed to fetch VOD home:", reason);
        const fallbackMessage = normalizeVodRequestErrorMessage(reason);
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
        if (isStale()) return;
        const metadataFallbackTarget = getVodMetadataHomeFallbackTarget(site, presetClasses);
        if (metadataFallbackTarget) {
          skipInitialCategoryFetchRef.current = null;
          suppressInitialMetadataCategoryWarningRef.current = {
            siteKey: site.key,
            classId: metadataFallbackTarget.classId,
          };
          setVodPage(1);
          setHasMore(true);
          setVodClasses(metadataFallbackTarget.classes);
          setActiveClassId(metadataFallbackTarget.classId);
          setVodList([]);
          return;
        }
        const message = buildSpiderFailureNotice(report, fallbackMessage);
        notify({ kind: "error", text: `获取首页失败: ${message}` });
      } finally {
        if (homeInFlightRef.current === flightKey) {
          homeInFlightRef.current = "";
        }
        if (!isStale()) {
          setLoadingVod(false);
        }
      }
    };

    void fetchHomeContent();
  }, [
    activeSearchKeyword,
    activeSiteAutoLoadBlocked,
    activeSiteKey,
    config,
    getSpiderRuntimeWarmupPromise,
    notify,
    resolveSiteExt,
    siteReloadToken,
    syncSpiderExecutionState,
  ]);

  useEffect(() => {
    const fetchCategoryPage = async (isLoadMore: boolean) => {
      if (!activeClassId || !activeSiteKey || !config || activeSearchKeyword) return;
      const site = config.sites.find((item) => item.key === activeSiteKey);
      if (!site || !site.capability.canCategory) return;
      if (site.capability.requiresSpider && activeSiteAutoLoadBlocked) {
        setLoadingVod(false);
        setLoadingMore(false);
        return;
      }

      const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
      const requestId = ++categoryRequestRef.current;
      const requestedSiteKey = site.key;
      const requestedClassId = activeClassId;
      const isStale = () =>
        requestId !== categoryRequestRef.current
        || requestedSiteKey !== activeSiteKeyRef.current
        || requestedClassId !== activeClassIdRef.current;
      const shouldSkipInitialFetch = !isLoadMore
        && vodPage === 1
        && skipInitialCategoryFetchRef.current?.siteKey === site.key
        && skipInitialCategoryFetchRef.current?.classId === activeClassId;
      if (shouldSkipInitialFetch) {
        skipInitialCategoryFetchRef.current = null;
        setLoadingVod(false);
        setLoadingMore(false);
        return;
      }
      const flightKey = [site.key, activeClassId, String(vodPage), String(siteReloadToken)].join("::");
      if (categoryInFlightRef.current === flightKey) {
        return;
      }
      categoryInFlightRef.current = flightKey;

      const cachedCategory = readTimedCache(
        categoryCacheRef.current,
        buildVodCategoryCacheKey(runtimeSessionKeyRef.current, site.key, activeClassId, vodPage),
      );
      if (cachedCategory) {
        if (
          suppressInitialMetadataCategoryWarningRef.current?.siteKey === site.key
          && suppressInitialMetadataCategoryWarningRef.current?.classId === activeClassId
        ) {
          suppressInitialMetadataCategoryWarningRef.current = null;
        }
        setVodList((current) => (isLoadMore ? [...current, ...cachedCategory.list] : cachedCategory.list));
        setHasMore(cachedCategory.hasMore);
        categoryInFlightRef.current = "";
        setLoadingVod(false);
        setLoadingMore(false);
        return;
      }

      if (!isLoadMore) {
        setLoadingVod(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExt(site), `category_ext:${site.key}`)
          : site.extValue;
        const runtimeWarmup = site.capability.requiresSpider && spiderUrl
          ? getSpiderRuntimeWarmupPromise(spiderUrl, site.api)
          : null;
        if (runtimeWarmup) {
          await runtimeWarmup;
          if (isStale()) return;
        }
        const response = site.capability.requiresSpider
          ? await invoke<string>("spider_category", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
            tid: activeClassId,
            pg: vodPage,
          })
          : await withVodInterfaceTimeout(invoke<string>("fetch_vod_category", {
            apiUrl: site.api,
            tid: activeClassId,
            pg: vodPage,
          }), `category:${site.key}`);

        const data = parseVodResponse(response);
        if (site.capability.requiresSpider) {
          await syncSpiderExecutionState(site.key);
        }
        if (isStale()) return;

        if (Array.isArray(data.list) && data.list.length > 0) {
          const nextHasMore = data.pagecount && vodPage >= data.pagecount
            ? false
            : data.list.length >= 10;
          writeTimedCache(
            categoryCacheRef.current,
            buildVodCategoryCacheKey(runtimeSessionKeyRef.current, site.key, activeClassId, vodPage),
            {
              list: data.list,
              hasMore: nextHasMore,
            },
            VOD_BROWSE_CACHE_TTL_MS,
          );
          if (
            suppressInitialMetadataCategoryWarningRef.current?.siteKey === site.key
            && suppressInitialMetadataCategoryWarningRef.current?.classId === activeClassId
          ) {
            suppressInitialMetadataCategoryWarningRef.current = null;
          }
          setVodList((current) => (isLoadMore ? [...current, ...data.list!] : data.list!));
          setHasMore(nextHasMore);
        } else {
          if (
            suppressInitialMetadataCategoryWarningRef.current?.siteKey === site.key
            && suppressInitialMetadataCategoryWarningRef.current?.classId === activeClassId
          ) {
            suppressInitialMetadataCategoryWarningRef.current = null;
          }
          if (!isLoadMore) setVodList([]);
          setHasMore(false);
        }
      } catch (reason) {
        if (isStale()) return;
        console.error("Failed to fetch category:", reason);
        const fallbackMessage = normalizeVodRequestErrorMessage(reason);
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
        if (isStale()) return;
        const shouldSuppressWarning = !isLoadMore
          && suppressInitialMetadataCategoryWarningRef.current?.siteKey === site.key
          && suppressInitialMetadataCategoryWarningRef.current?.classId === activeClassId;
        if (shouldSuppressWarning) {
          suppressInitialMetadataCategoryWarningRef.current = null;
          setHasMore(false);
          return;
        }
        const message = buildSpiderFailureNotice(report, fallbackMessage);
        notify({ kind: "warning", text: `获取分类数据失败: ${message}` });
        setHasMore(false);
      } finally {
        if (categoryInFlightRef.current === flightKey) {
          categoryInFlightRef.current = "";
        }
        if (!isStale()) {
          setLoadingVod(false);
          setLoadingMore(false);
        }
      }
    };

    void fetchCategoryPage(vodPage > 1);
  }, [
    activeClassId,
    activeSearchKeyword,
    activeSiteAutoLoadBlocked,
    activeSiteKey,
    config,
    getSpiderRuntimeWarmupPromise,
    notify,
    resolveSiteExt,
    siteReloadToken,
    syncSpiderExecutionState,
    vodPage,
  ]);

  const handleVodSearch = useCallback(async () => {
    const keyword = vodSearchKeyword.trim();
    if (!keyword || !config || !activeVodSite) return;
    if (effectiveBrowseMode === "aggregate" && aggregateEligibleSites.length > 1) {
      const orderedSites = aggregateEligibleSites.filter((site) => {
        if (!site.capability.canSearch) {
          return false;
        }
        if (site.capability.requiresSpider) {
          return !shouldBlockAutoLoad(siteRuntimeStates[site.key] ?? null);
        }
        return true;
      });
      if (!orderedSites.length) {
        notify({ kind: "warning", text: "当前分仓没有可用于聚合搜索的接口。" });
        return;
      }

      invalidateVodRequests();
      skipInitialCategoryFetchRef.current = null;
      const generation = controllerGenerationRef.current;
      const requestId = ++searchRequestRef.current;
      const siteKeys = orderedSites.map((site) => site.key);
      const flightKey = ["aggregate", keyword, siteKeys.join(",")].join("::");
      if (searchInFlightRef.current === flightKey) {
        return;
      }
      searchInFlightRef.current = flightKey;

      const isStale = () =>
        requestId !== searchRequestRef.current
        || isStaleControllerGeneration(generation);

      const cachedAggregate = readTimedCache(
        aggregateCacheRef.current,
        buildVodAggregateCacheKey(runtimeSessionKeyRef.current, keyword, siteKeys),
      );

      setActiveSearchKeyword(keyword);
      setLoadingVod(true);
      setHasMore(false);
      setVodPage(1);
      setVodList([]);

      if (cachedAggregate) {
        setVodList(cachedAggregate.items);
        setAggregateSessionState(buildAggregateSessionState(keyword, cachedAggregate.statuses, false));
        setLoadingVod(false);
        searchInFlightRef.current = "";
        for (const status of cachedAggregate.statuses) {
          if (status.resultCount > 0) {
            recordAggregateBackendSuccess(status.siteKey);
          }
        }
        notify({
          kind: cachedAggregate.items.length > 0 ? "success" : "warning",
          text: cachedAggregate.items.length > 0
            ? `已从缓存恢复 ${cachedAggregate.items.length} 条聚合结果。`
            : "聚合搜索缓存已命中，但没有可展示结果。",
        });
        return;
      }

      const persistedAggregate = await loadPersistedAggregateSearchCache(
        sourceRef.current,
        activeRepoUrlRef.current,
        keyword,
        siteKeys,
      );
      if (persistedAggregate) {
        writeTimedCache(
          aggregateCacheRef.current,
          buildVodAggregateCacheKey(runtimeSessionKeyRef.current, keyword, siteKeys),
          persistedAggregate,
          VOD_AGGREGATE_CACHE_TTL_MS,
        );
        setVodList(persistedAggregate.items);
        setAggregateSessionState(buildAggregateSessionState(keyword, persistedAggregate.statuses, false));
        setLoadingVod(false);
        searchInFlightRef.current = "";
        for (const status of persistedAggregate.statuses) {
          if (status.resultCount > 0) {
            recordAggregateBackendSuccess(status.siteKey);
            recordSiteSuccess(status.siteKey);
          }
        }
        notify({
          kind: persistedAggregate.items.length > 0 ? "success" : "warning",
          text: persistedAggregate.items.length > 0
            ? `已从持久缓存恢复 ${persistedAggregate.items.length} 条聚合结果。`
            : "聚合缓存已命中，但没有可展示结果。",
        });
        return;
      }

      let statuses: VodAggregateSessionState["statuses"] = [];
      let aggregateItems: VodAggregateResultItem[] = [];

      try {
        const result = await executeAggregateVodSearch({
          keyword,
          sites: orderedSites,
          spider: config.spider,
          concurrency: VOD_AGGREGATE_SEARCH_CONCURRENCY,
          isStale,
          resolveSiteExt,
          getSpiderRuntimeWarmupPromise,
          syncSpiderExecutionState,
          onItems: (items) => {
            aggregateItems = [...aggregateItems, ...items];
            setVodList((current) => mergeVodBrowseItems(current, items));
          },
          onStatusesChange: (nextStatuses, running) => {
            statuses = nextStatuses;
            setAggregateSessionState(buildAggregateSessionState(keyword, nextStatuses, running));
          },
          onSiteSuccess: (siteKey) => {
            recordAggregateBackendSuccess(siteKey);
          },
          onSiteFailure: (siteKey, failureKind) => {
            recordAggregateBackendFailure(siteKey, failureKind);
          },
        });
        aggregateItems = result.items;
        statuses = result.statuses;

        if (isStale()) {
          return;
        }

        writeTimedCache(
          aggregateCacheRef.current,
          buildVodAggregateCacheKey(runtimeSessionKeyRef.current, keyword, siteKeys),
          {
            items: aggregateItems,
            statuses,
          },
          VOD_AGGREGATE_CACHE_TTL_MS,
        );
        void savePersistedAggregateSearchCache(
          sourceRef.current,
          activeRepoUrlRef.current,
          keyword,
          siteKeys,
          {
            items: aggregateItems,
            statuses,
          },
        ).catch(() => {
          // Ignore persistence failures and keep the in-memory cache.
        });

        for (const status of statuses) {
          if (status.resultCount > 0) {
            recordSiteSuccess(status.siteKey);
          }
        }

        setAggregateSessionState(buildAggregateSessionState(keyword, statuses, false));
        notify({
          kind: aggregateItems.length > 0 ? "success" : "warning",
          text: aggregateItems.length > 0
            ? `聚合搜索完成，已从 ${orderedSites.length} 个接口收集 ${aggregateItems.length} 条结果。`
            : "聚合搜索完成，但没有接口返回可展示结果。",
        });
      } finally {
        if (searchInFlightRef.current === flightKey) {
          searchInFlightRef.current = "";
        }
        if (!isStale()) {
          setLoadingVod(false);
          setAggregateSessionState(buildAggregateSessionState(keyword, statuses, false));
        }
      }
      return;
    }

    setAggregateSessionState(null);
    if (!activeVodSite.capability.canSearch) {
      notify({ kind: "warning", text: "当前站点未声明搜索能力。" });
      return;
    }
    if (activeVodSite.capability.requiresSpider && activeSiteAutoLoadBlocked) {
      notify({ kind: "warning", text: "当前接口已被临时隔离，请先查看运行诊断后再重试。" });
      return;
    }

    invalidateVodRequests();
    skipInitialCategoryFetchRef.current = null;
    const requestId = ++searchRequestRef.current;
    const requestedSiteKey = activeVodSite.key;
    const flightKey = [activeVodSite.key, keyword].join("::");
    if (searchInFlightRef.current === flightKey) {
      return;
    }
    searchInFlightRef.current = flightKey;

    const isStale = () =>
      requestId !== searchRequestRef.current
      || requestedSiteKey !== activeSiteKeyRef.current;

    setActiveSearchKeyword(keyword);
    setLoadingVod(true);
    setHasMore(false);
    setVodPage(1);
    setVodList([]);

    try {
      const spiderUrl = resolveSiteSpiderUrl(activeVodSite, config.spider);
      const extInput = activeVodSite.capability.requiresSpider
        ? await withVodInterfaceTimeout(resolveSiteExt(activeVodSite), `search_ext:${activeVodSite.key}`)
        : activeVodSite.extValue;
      const runtimeWarmup = activeVodSite.capability.requiresSpider && spiderUrl
        ? getSpiderRuntimeWarmupPromise(spiderUrl, activeVodSite.api)
        : null;
      if (runtimeWarmup) {
        await runtimeWarmup;
        if (isStale()) return;
      }
      const response = activeVodSite.capability.requiresSpider
        ? await invoke<string>("spider_search", {
          spiderUrl,
          siteKey: activeVodSite.key,
          apiClass: activeVodSite.api,
          ext: extInput,
          keyword,
          quick: activeVodSite.quickSearch,
        })
        : await withVodInterfaceTimeout(invoke<string>("fetch_vod_search", {
          apiUrl: activeVodSite.api,
          keyword,
        }), `search:${activeVodSite.key}`);

      const data = parseVodResponse(response);
      if (activeVodSite.capability.requiresSpider) {
        await syncSpiderExecutionState(activeVodSite.key);
      }
      if (isStale()) return;
      const nextList = Array.isArray(data.list) ? data.list : [];
      if (nextList.length > 0) {
        recordSiteSuccess(activeVodSite.key);
      }
      setVodList(nextList);
      notify({
        kind: data.list?.length ? "success" : "warning",
        text: data.list?.length
          ? `搜索完成，共返回 ${data.list.length} 条结果。`
          : "搜索完成，但没有返回结果。",
      });
    } catch (reason) {
      if (isStale()) return;
      console.error("Failed to search VOD site:", reason);
      const fallbackMessage = normalizeVodRequestErrorMessage(reason);
      const report = activeVodSite.capability.requiresSpider ? await syncSpiderExecutionState(activeVodSite.key) : null;
      if (isStale()) return;
      const message = buildSpiderFailureNotice(report, fallbackMessage);
      notify({ kind: "error", text: `站点搜索失败: ${message}` });
    } finally {
      if (searchInFlightRef.current === flightKey) {
        searchInFlightRef.current = "";
      }
      if (!isStale()) {
        setLoadingVod(false);
      }
    }
  }, [
    aggregateEligibleSites,
    effectiveBrowseMode,
    getSpiderRuntimeWarmupPromise,
    activeSiteAutoLoadBlocked,
    activeVodSite,
    config,
    invalidateVodRequests,
    isStaleControllerGeneration,
    notify,
    recordAggregateBackendFailure,
    recordAggregateBackendSuccess,
    recordSiteSuccess,
    resolveSiteExt,
    siteRuntimeStates,
    syncSpiderExecutionState,
    vodSearchKeyword,
  ]);

  const handleSearchReset = useCallback(() => {
    invalidateVodRequests();
    skipInitialCategoryFetchRef.current = null;
    setVodSearchKeyword("");
    setActiveSearchKeyword("");
    setAggregateSessionState(null);
    setVodList([]);
    setVodPage(1);
    setHasMore(true);
  }, [invalidateVodRequests]);

  const handleClassClick = useCallback((id: string) => {
    if (activeClassId === id) return;
    setActiveClassId(id);
    setVodPage(1);
    setHasMore(true);
  }, [activeClassId]);

  const handleSiteSelect = useCallback((siteKey: string) => {
    const generation = advanceControllerGeneration();
    if (activeSiteKey === siteKey) {
      clearTvBoxRuntimeCaches(runtimeSessionKeyRef.current);
      clearBrowseCaches(siteKey);
      runtimeWarmupPromisesRef.current.clear();
      invalidateVodRequests();
      clearSpiderExecutionReport(siteKey);
      clearSelectedVod();
      setSiteRuntimeStates((current) => {
        const next = resetSpiderRuntimeIsolation(current[siteKey]);
        if (!next) return current;
        return { ...current, [siteKey]: next };
      });
      if (!isStaleControllerGeneration(generation)) {
        setSiteReloadToken((current) => current + 1);
      }
      return;
    }
    invalidateVodRequests();
    resetVodBrowseState();
    clearSelectedVod();
    setActiveSiteKey(siteKey);
    persistSelection({ siteKey });
  }, [
    activeSiteKey,
    advanceControllerGeneration,
    clearBrowseCaches,
    clearSelectedVod,
    clearSpiderExecutionReport,
    invalidateVodRequests,
    isStaleControllerGeneration,
    persistSelection,
    resetVodBrowseState,
  ]);

  const saveSource = useCallback(() => {
    const parsed = parseSingleSource(draft);
    const normalizedSource = normalizeSourceTarget(parsed.source);
    if (!normalizedSource) {
      notify({ kind: "error", text: "点播源地址不能为空。" });
      return;
    }
    if (!isSupportedSourceTarget(normalizedSource)) {
      notify({ kind: "error", text: "点播源地址必须为 http(s) 地址或 file:// 本地文件路径。" });
      return;
    }

    localStorage.setItem(MEDIA_VOD_SOURCE_KEY, normalizedSource);
    setSource(normalizedSource);
    setDraft(normalizedSource);
    resetVodRuntimeState();
    notify({
      kind: parsed.warning ? "warning" : "success",
      text: parsed.warning ?? "点播源已保存。",
    });
  }, [draft, notify, resetVodRuntimeState]);

  const clearSource = useCallback(() => {
    advanceControllerGeneration();
    localStorage.removeItem(MEDIA_VOD_SOURCE_KEY);
    localStorage.removeItem(MEDIA_VOD_SITE_KEY);
    clearVodSourceSelectionSnapshot();
    setSource("");
    setDraft("");
    setRepoUrls([]);
    setActiveRepoUrl("");
    setConfig(null);
    setActiveSiteKey("");
    resetVodRuntimeState();
    resetVodBrowseState();
    clearSelectedVod();
    notify({ kind: "success", text: "点播源已清空。" });
  }, [advanceControllerGeneration, clearSelectedVod, notify, resetVodBrowseState, resetVodRuntimeState]);

  return {
    source,
    draft,
    setDraft,
    repoUrls,
    activeRepoUrl,
    config,
    activeSiteKey,
    activeVodSite,
    selectedVodSite,
    runtimeSessionKey,
    networkPolicyGeneration,
    activeSiteRuntime,
    siteRuntimeStates,
    browseMode: effectiveBrowseMode,
    setBrowseMode,
    supportsAggregateBrowse,
    aggregateSessionState,
    aggregateEligibleSites,
    filteredVodClasses,
    classFilterKeyword,
    vodSearchKeyword,
    activeSearchKeyword,
    loadingConfig,
    spiderJarStatus,
    loadingVod,
    loadingMore,
    vodList,
    hasMore,
    detailEnabled,
    activeClassId,
    selectedVodId,
    selectedVodTitle,
    setClassFilterKeyword,
    setVodSearchKeyword,
    selectVodItem,
    clearSelectedVod,
    syncDraft,
    saveSource,
    clearSource,
    selectRepo,
    handleSiteSelect,
    handleClassClick,
    handleSearchReset,
    handleVodSearch,
    loadMore: () => setVodPage((current) => current + 1),
    openVodFromDetail,
    resolveMsearchMatches,
    resolveMsearchAndPlay,
    playDispatchCandidate,
  };
}
