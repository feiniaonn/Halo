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
import { humanizeVodError } from "@/modules/media/services/mediaError";
import {
  isSupportedSourceTarget,
  loadVodRepoSource,
  loadVodSource,
  normalizeSourceTarget,
  readSpiderExecutionReport,
} from "@/modules/media/services/mediaSourceLoader";
import {
  clearVodSourceSelectionSnapshot,
  pickStoredSiteKey,
  readVodSourceSelectionSnapshot,
  writeVodSourceSelectionSnapshot,
} from "@/modules/media/services/vodSourceSelection";
import { clearVodImageProxyCache } from "@/modules/media/services/vodImageProxy";
import { pickBestVodDispatchCandidate } from "@/modules/media/services/vodDispatchSearch";
import {
  buildPresetClasses,
  parseSingleSource,
  parseVodResponse,
  resolveSiteSpiderUrl,
} from "@/modules/media/services/tvboxConfig";
import { openVodPlayerWindow } from "@/modules/media/services/vodPlayerWindow";
import { clearTvBoxRuntimeCaches, resolveSiteExtInput } from "@/modules/media/services/tvboxRuntime";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import type { MediaNotice } from "@/modules/media/types/mediaPage.types";
import type {
  CompatHelperStatus,
  NormalizedTvBoxConfig,
  SpiderExecutionReport,
  SpiderPrefetchResult,
  SpiderSiteRuntimeState,
  TvBoxClass,
  TvBoxRepoUrl,
  TvBoxVodItem,
} from "@/modules/media/types/tvbox.types";
import type { VodDispatchCandidate } from "@/modules/media/types/vodDispatch.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

const MEDIA_VOD_SOURCE_KEY = "halo_media_source_vod_single";
const MEDIA_VOD_SITE_KEY = "halo_media_active_site_key";
const VOD_INTERFACE_TIMEOUT_MS = 5000;
const VOD_INTERFACE_TIMEOUT_CODE = `vod_interface_timeout_${VOD_INTERFACE_TIMEOUT_MS}ms`;

function withVodInterfaceTimeout<T>(promise: Promise<T>, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${VOD_INTERFACE_TIMEOUT_CODE}:${stage}`));
    }, VOD_INTERFACE_TIMEOUT_MS);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeVodRequestErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes(VOD_INTERFACE_TIMEOUT_CODE) || /execution timeout exceeded after\s+\d+s/i.test(message)) {
    return "接口解析超时（5秒）";
  }
  return humanizeVodError(message);
}

type SpiderJarStatus = "idle" | "loading" | "ready" | "error";

interface MediaNetworkPolicyStatus {
  request_header_rule_count: number;
  host_mapping_count: number;
  doh_entry_count: number;
  supports_doh_resolver: boolean;
  active_doh_provider_name?: string | null;
  unsupported_doh_entry_count?: number;
}

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

  const [classFilterKeyword, setClassFilterKeyword] = useState("");
  const [vodSearchKeyword, setVodSearchKeyword] = useState("");
  const [activeSearchKeyword, setActiveSearchKeyword] = useState("");
  const [vodClasses, setVodClasses] = useState<TvBoxClass[]>([]);
  const [activeClassId, setActiveClassId] = useState("");
  const [vodList, setVodList] = useState<TvBoxVodItem[]>([]);
  const [loadingVod, setLoadingVod] = useState(false);
  const [vodPage, setVodPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedVodId, setSelectedVodId] = useState<string | null>(null);
  const [selectedVodTitle, setSelectedVodTitle] = useState<string | null>(null);

  const activeSiteKeyRef = useRef("");
  const activeRepoUrlRef = useRef("");
  const sourceRef = useRef(source);
  const activeClassIdRef = useRef("");
  const prefetchInFlightRef = useRef("");
  const prefetchPromiseRef = useRef<Promise<SpiderPrefetchResult | null> | null>(null);
  const prefetchPromiseKeyRef = useRef("");
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

  useEffect(() => {
    activeClassIdRef.current = activeClassId;
  }, [activeClassId]);

  const invalidateVodRequests = useCallback(() => {
    homeRequestRef.current += 1;
    categoryRequestRef.current += 1;
    searchRequestRef.current += 1;
    dispatchSearchSessionRef.current += 1;
    homeInFlightRef.current = "";
    categoryInFlightRef.current = "";
    searchInFlightRef.current = "";
    prefetchInFlightRef.current = "";
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

  const resetVodRuntimeState = useCallback(() => {
    invalidateVodRequests();
    clearSpiderExecutionReport();
    clearTvBoxRuntimeCaches();
    clearVodImageProxyCache();
    setSiteRuntimeStates({});
    setSpiderJarStatus("idle");
    setLoadingVod(false);
    setLoadingMore(false);
  }, [clearSpiderExecutionReport, invalidateVodRequests]);

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
    setClassFilterKeyword("");
    setVodSearchKeyword("");
    setActiveSearchKeyword("");
    setVodClasses([]);
    setActiveClassId("");
    setVodList([]);
    setVodPage(1);
    setHasMore(true);
    setSelectedVodId(null);
    setSelectedVodTitle(null);
  }, []);

  const selectVodItem = useCallback((item: TvBoxVodItem | null) => {
    setSelectedVodId(item?.vod_id ?? null);
    setSelectedVodTitle(item?.vod_name?.trim() || null);
  }, []);

  const clearSelectedVod = useCallback(() => {
    invalidateVodRequests();
    setSelectedVodId(null);
    setSelectedVodTitle(null);
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

  const activeVodSite = useMemo(
    () => config?.sites.find((site) => site.key === activeSiteKey) ?? null,
    [activeSiteKey, config],
  );

  const activeSiteRuntime = useMemo(
    () => (activeSiteKey ? siteRuntimeStates[activeSiteKey] ?? null : null),
    [activeSiteKey, siteRuntimeStates],
  );

  const activeSiteAutoLoadBlocked = useMemo(
    () => shouldBlockAutoLoad(activeSiteRuntime),
    [activeSiteRuntime],
  );

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

  const triggerJarPrefetch = useCallback((siteKey: string, spiderUrl: string, apiClass: string, ext: string) => {
    if (!spiderUrl) return;
    if (/app3q/i.test(apiClass)) {
      setSpiderJarStatus("ready");
      return Promise.resolve(null);
    }
    const generation = controllerGenerationRef.current;
    const requestKey = [siteKey, spiderUrl, apiClass, ext].join("::");
    if (prefetchPromiseKeyRef.current === requestKey && prefetchPromiseRef.current) {
      return prefetchPromiseRef.current;
    }
    if (prefetchInFlightRef.current === requestKey) return prefetchPromiseRef.current;
    prefetchInFlightRef.current = requestKey;
    prefetchPromiseKeyRef.current = requestKey;
    clearSpiderExecutionReport(siteKey);

    setSpiderJarStatus("loading");
    if (siteKey) {
      setSiteRuntimeStates((current) => ({
        ...current,
        [siteKey]: buildCheckingSpiderRuntimeState(current[siteKey]),
      }));
    }

    const prefetchPromise = invoke<SpiderPrefetchResult>("prefetch_spider_jar", { spiderUrl, apiClass })
      .then(async (result) => {
        if (isStaleControllerGeneration(generation)) return null;
        setSpiderJarStatus("ready");
        if (!siteKey) return result;

        applySpiderPrefetchState(siteKey, result);
        const profileReport = await invoke<SpiderExecutionReport>("profile_spider_site", {
          spiderUrl,
          siteKey,
          apiClass,
          ext,
        });
        if (isStaleControllerGeneration(generation)) return null;
        applySpiderExecutionState(siteKey, profileReport);
        if (profileReport.executionTarget === "desktop-helper") {
          await syncCompatHelperStatus();
        }
        return result;
      })
      .catch((reason) => {
        if (isStaleControllerGeneration(generation)) return null;
        console.warn("[Spider] JAR pre-fetch failed:", reason);
        setSpiderJarStatus("error");

        const message = reason instanceof Error ? reason.message : String(reason);
        if (siteKey) {
          applySpiderExecutionState(siteKey, {
            ok: false,
            siteKey,
            method: "prefetch",
            executionTarget: "desktop-direct",
            failureKind: "FetchError",
            failureMessage: message,
            checkedAtMs: Date.now(),
            artifact: null,
            siteProfile: null,
          });
        }
        notify({ kind: "warning", text: humanizeVodError(message) });
        return null;
      })
      .finally(() => {
        if (prefetchInFlightRef.current === requestKey) {
          prefetchInFlightRef.current = "";
        }
        if (prefetchPromiseKeyRef.current === requestKey) {
          prefetchPromiseKeyRef.current = "";
          prefetchPromiseRef.current = null;
        }
      });
    prefetchPromiseRef.current = prefetchPromise;
    return prefetchPromise;
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
  }, [config?.ads, config?.headers, config?.hosts, config?.parses, config?.proxy, config?.rules, config?.spider, notify]);

  const resolveMsearchMatches = useCallback(async (
    keyword: string,
    fallbackTitle = "",
    maxMatches = 4,
  ): Promise<VodDispatchCandidate[]> => {
    if (!config || !activeSiteKey) {
      throw new Error("Current source is unavailable for dispatch search.");
    }

    const generation = controllerGenerationRef.current;
    const sessionId = beginDispatchSearchSession();
    const normalizedKeyword = keyword.trim() || fallbackTitle.trim();
    if (!normalizedKeyword) {
      return [];
    }
    const cappedMaxMatches = Math.max(1, Math.min(maxMatches, 12));
    const isStale = () => isStaleDispatchSearchSession(generation, sessionId);

    const active = config.sites.find((site) => site.key === activeSiteKey) ?? null;
    const orderedSites = [
      ...(active ? [active] : []),
      ...config.sites.filter((site) => site.key !== activeSiteKey),
    ]
      .filter((site) => site.capability.canSearch)
      .slice(0, 12);

    if (!orderedSites.length) {
      return [];
    }

    const matches: Array<{ order: number; value: VodDispatchCandidate }> = [];
    let cursor = 0;
    const concurrency = Math.min(3, orderedSites.length);

    const worker = async () => {
      while (!isStale()) {
        if (matches.length >= cappedMaxMatches) {
          return;
        }
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= orderedSites.length) {
          return;
        }

        const site = orderedSites[currentIndex];
        const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
        if (site.capability.requiresSpider && !spiderUrl) {
          continue;
        }

        try {
          const extInput = site.capability.requiresSpider
            ? await withVodInterfaceTimeout(
              resolveSiteExtInput(site),
              `dispatch_ext:${site.key}`,
            )
            : site.extValue;
          if (isStale()) {
            return;
          }

          const searchResponse = site.capability.requiresSpider
            ? await invoke<string>("spider_search", {
              spiderUrl,
              siteKey: site.key,
              apiClass: site.api,
              ext: extInput,
              keyword: normalizedKeyword,
              quick: site.quickSearch,
            })
            : await withVodInterfaceTimeout(invoke<string>("fetch_vod_search", {
              apiUrl: site.api,
              keyword: normalizedKeyword,
            }), `dispatch_search:${site.key}`);
          if (isStale()) {
            return;
          }

          const candidateList = parseVodResponse(searchResponse).list ?? [];
          const bestCandidate = pickBestVodDispatchCandidate(normalizedKeyword, candidateList);
          if (!bestCandidate?.vod_id) {
            continue;
          }

          const detailResult = await fetchVodDetail({ site, spider: config.spider }, bestCandidate.vod_id);
          if (isStale()) {
            return;
          }
          if (!detailResult.routes.length) {
            continue;
          }

          matches.push({
            order: currentIndex,
            value: {
              siteKey: site.key,
              siteName: site.name,
              sourceKind: site.capability.sourceKind,
              vodId: bestCandidate.vod_id,
              matchTitle: bestCandidate.vod_name,
              remarks: bestCandidate.vod_remarks,
              detail: detailResult.detail,
              routes: detailResult.routes,
              extInput: detailResult.extInput,
            },
          });
        } catch {
          // Continue with the next site.
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (isStale()) {
      return [];
    }
    return matches
      .sort((left, right) => left.order - right.order)
      .slice(0, cappedMaxMatches)
      .map((item) => item.value);
  }, [
    activeSiteKey,
    beginDispatchSearchSession,
    config,
    isStaleDispatchSearchSession,
  ]);

  const resolveMsearchAndPlay = useCallback(async (keyword: string, fallbackTitle = "") => {
    const matches = await resolveMsearchMatches(keyword, fallbackTitle, 1);
    const firstMatch = matches[0];
    if (!firstMatch) {
      throw new Error("未在可用站点中找到可播放节点。");
    }

    const targetSite = config?.sites.find((site) => site.key === firstMatch.siteKey) ?? null;
    if (!targetSite) {
      throw new Error("Matched site context is no longer available.");
    }

    clearSelectedVod();
    await openVodFromDetail(
      targetSite,
      firstMatch.extInput,
      firstMatch.detail,
      firstMatch.routes,
    );
    notify({ kind: "success", text: `已从 [${firstMatch.siteName}] 找到可播线路，正在播放...` });
  }, [clearSelectedVod, config?.sites, notify, openVodFromDetail, resolveMsearchMatches]);

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
      resetVodRuntimeState();
      resetVodBrowseState();
      return;
    }
    void loadSourceConfig(source);
  }, [loadSourceConfig, resetVodBrowseState, resetVodRuntimeState, source]);

  useEffect(() => {
    if (!activeVodSite || !config || !activeVodSite.capability.requiresSpider) {
      return;
    }
    const spiderUrl = resolveSiteSpiderUrl(activeVodSite, config.spider);
    if (!spiderUrl) return;
    triggerJarPrefetch(activeVodSite.key, spiderUrl, activeVodSite.api, activeVodSite.extValue);
  }, [activeVodSite, config, siteReloadToken, triggerJarPrefetch]);

  useEffect(() => {
    if (activeSiteRuntime?.executionTarget === "desktop-helper") {
      void syncCompatHelperStatus();
    }
  }, [activeSiteRuntime?.executionTarget, syncCompatHelperStatus]);

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

      setLoadingVod(true);
      setVodPage(1);
      setHasMore(true);

      try {
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExtInput(site), `home_ext:${site.key}`)
          : site.extValue;
        if (
          site.capability.requiresSpider
          && spiderJarStatus === "loading"
          && prefetchPromiseRef.current
        ) {
          await prefetchPromiseRef.current;
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
        setVodClasses(classes);
        setActiveClassId(nextClassId);
        setVodList(homeList);
      } catch (reason) {
        if (isStale()) return;
        console.error("Failed to fetch VOD home:", reason);
        const fallbackMessage = normalizeVodRequestErrorMessage(reason);
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
        if (isStale()) return;
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
  }, [activeSearchKeyword, activeSiteAutoLoadBlocked, activeSiteKey, config, notify, siteReloadToken, syncSpiderExecutionState]);

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

      if (!isLoadMore) {
        setLoadingVod(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const extInput = site.capability.requiresSpider
          ? await withVodInterfaceTimeout(resolveSiteExtInput(site), `category_ext:${site.key}`)
          : site.extValue;
        if (
          site.capability.requiresSpider
          && spiderJarStatus === "loading"
          && prefetchPromiseRef.current
        ) {
          await prefetchPromiseRef.current;
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
          setVodList((current) => (isLoadMore ? [...current, ...data.list!] : data.list!));
          if (data.pagecount && vodPage >= data.pagecount) {
            setHasMore(false);
          } else {
            setHasMore(data.list.length >= 10);
          }
        } else {
          if (!isLoadMore) setVodList([]);
          setHasMore(false);
        }
      } catch (reason) {
        if (isStale()) return;
        console.error("Failed to fetch category:", reason);
        const fallbackMessage = normalizeVodRequestErrorMessage(reason);
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
        if (isStale()) return;
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
    notify,
    siteReloadToken,
    syncSpiderExecutionState,
    vodPage,
  ]);

  const handleVodSearch = useCallback(async () => {
    const keyword = vodSearchKeyword.trim();
    if (!keyword || !config || !activeVodSite) return;
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
        ? await withVodInterfaceTimeout(resolveSiteExtInput(activeVodSite), `search_ext:${activeVodSite.key}`)
        : activeVodSite.extValue;
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
      setVodList(Array.isArray(data.list) ? data.list : []);
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
    activeSiteAutoLoadBlocked,
    activeVodSite,
    config,
    invalidateVodRequests,
    notify,
    syncSpiderExecutionState,
    vodSearchKeyword,
  ]);

  const handleSearchReset = useCallback(() => {
    invalidateVodRequests();
    skipInitialCategoryFetchRef.current = null;
    setVodSearchKeyword("");
    setActiveSearchKeyword("");
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
      clearTvBoxRuntimeCaches();
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
    clearTvBoxRuntimeCaches();
    invalidateVodRequests();
    clearSpiderExecutionReport(siteKey);
    resetVodBrowseState();
    clearSelectedVod();
    setActiveSiteKey(siteKey);
    persistSelection({ siteKey });
  }, [
    activeSiteKey,
    advanceControllerGeneration,
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
    activeSiteRuntime,
    siteRuntimeStates,
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
  };
}
