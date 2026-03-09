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
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

const MEDIA_VOD_SOURCE_KEY = "halo_media_source_vod_single";
const MEDIA_VOD_SITE_KEY = "halo_media_active_site_key";

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

  const activeSiteKeyRef = useRef("");
  const activeRepoUrlRef = useRef("");
  const sourceRef = useRef(source);
  const activeClassIdRef = useRef("");
  const prefetchInFlightRef = useRef("");
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
    homeInFlightRef.current = "";
    categoryInFlightRef.current = "";
    searchInFlightRef.current = "";
    prefetchInFlightRef.current = "";
  }, []);

  const resetVodRuntimeState = useCallback(() => {
    invalidateVodRequests();
    clearTvBoxRuntimeCaches();
    clearVodImageProxyCache();
    setSiteRuntimeStates({});
    setSpiderJarStatus("idle");
    setLoadingVod(false);
    setLoadingMore(false);
  }, [invalidateVodRequests]);

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
  }, []);

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
    const requestKey = [siteKey, spiderUrl, apiClass, ext].join("::");
    if (prefetchInFlightRef.current === requestKey) return;
    prefetchInFlightRef.current = requestKey;

    setSpiderJarStatus("loading");
    if (siteKey) {
      setSiteRuntimeStates((current) => ({
        ...current,
        [siteKey]: buildCheckingSpiderRuntimeState(current[siteKey]),
      }));
    }

    invoke<SpiderPrefetchResult>("prefetch_spider_jar", { spiderUrl })
      .then(async (result) => {
        setSpiderJarStatus("ready");
        if (!siteKey) return;

        applySpiderPrefetchState(siteKey, result);
        const profileReport = await invoke<SpiderExecutionReport>("profile_spider_site", {
          spiderUrl,
          siteKey,
          apiClass,
          ext,
        });
        applySpiderExecutionState(siteKey, profileReport);
        if (profileReport.executionTarget === "desktop-helper") {
          await syncCompatHelperStatus();
        }
      })
      .catch((reason) => {
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
      })
      .finally(() => {
        if (prefetchInFlightRef.current === requestKey) {
          prefetchInFlightRef.current = "";
        }
      });
  }, [applySpiderExecutionState, applySpiderPrefetchState, notify, syncCompatHelperStatus]);

  const openVodFromDetail = useCallback(async (
    site: NonNullable<typeof activeVodSite>,
    extInput: string,
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx = 0,
    episodeIdx = 0,
  ) => {
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
      initialKernelMode: "mpv",
      parses: config?.parses,
      requestHeaders: config?.headers,
      playbackRules: config?.rules,
      proxyDomains: config?.proxy,
      hostMappings: config?.hosts,
      adHosts: config?.ads,
    });
  }, [config?.ads, config?.headers, config?.hosts, config?.parses, config?.proxy, config?.rules, config?.spider]);

  const resolveMsearchAndPlay = useCallback(async (keyword: string) => {
    if (!config || !activeSiteKey) {
      throw new Error("当前源未启用 Spider，无法跨站搜索。");
    }

    const active = config.sites.find((site) => site.key === activeSiteKey) ?? null;
    const orderedSites = [
      ...(active ? [active] : []),
      ...config.sites.filter((site) => site.key !== activeSiteKey),
    ]
      .filter((site) => site.capability.requiresSpider && site.capability.canSearch)
      .slice(0, 8);

    for (const site of orderedSites) {
      const spiderUrl = resolveSiteSpiderUrl(site, config.spider);
      if (!spiderUrl) continue;

      try {
        const extInput = await resolveSiteExtInput(site);
        const searchResponse = await invoke<string>("spider_search", {
          spiderUrl,
          siteKey: site.key,
          apiClass: site.api,
          ext: extInput,
          keyword,
          quick: site.quickSearch,
        });

        const candidates = (parseVodResponse(searchResponse).list ?? []).slice(0, 2);
        for (const candidate of candidates) {
          if (!candidate.vod_id) continue;
          const detailResult = await fetchVodDetail({ site, spider: config.spider }, candidate.vod_id);
          if (!detailResult.routes.length) continue;

          setSelectedVodId(null);
          await openVodFromDetail(site, detailResult.extInput, detailResult.detail, detailResult.routes);
          notify({ kind: "success", text: `已从 [${site.name}] 找到可播线路，正在播放...` });
          return;
        }
      } catch {
        // Try the next Spider-capable site.
      }
    }

    throw new Error("未在可用站点中找到可播放节点。");
  }, [activeSiteKey, config, notify, openVodFromDetail]);

  const selectRepo = useCallback(async (repo: TvBoxRepoUrl) => {
    if (!repo.url) return;
    const storedSelection = readVodSourceSelectionSnapshot();

    setLoadingConfig(true);
    setConfig(null);
    setActiveRepoUrl(repo.url);
    setActiveSiteKey("");
    resetVodRuntimeState();
    resetVodBrowseState();

    try {
      const normalized = await loadVodRepoSource(repo.url);
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
      console.error(reason);
      notify({ kind: "error", text: `分仓 [${repo.name}] 解析失败。` });
    } finally {
      setLoadingConfig(false);
    }
  }, [notify, persistSelection, resetVodBrowseState, resetVodRuntimeState]);

  const loadSourceConfig = useCallback(async (url: string) => {
    if (!url) return;
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
      console.error(reason);
      const message = reason instanceof Error ? reason.message : String(reason);
      notify({
        kind: "error",
        text: message.includes("JSON") || message.includes("empty response")
          ? "本地解析失败，且兜底解密未获得有效配置。"
          : `解析源失败: ${message}`,
      });
    } finally {
      setLoadingConfig(false);
    }
  }, [notify, persistSelection, resetVodBrowseState, resetVodRuntimeState]);

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
        const extInput = site.capability.requiresSpider ? await resolveSiteExtInput(site) : site.extValue;
        const response = site.capability.requiresSpider
          ? await invoke<string>("spider_home", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
          })
          : await invoke<string>("fetch_vod_home", { apiUrl: site.api });

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
        const fallbackMessage = humanizeVodError(reason instanceof Error ? reason.message : String(reason));
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
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
        const extInput = site.capability.requiresSpider ? await resolveSiteExtInput(site) : site.extValue;
        const response = site.capability.requiresSpider
          ? await invoke<string>("spider_category", {
            spiderUrl,
            siteKey: site.key,
            apiClass: site.api,
            ext: extInput,
            tid: activeClassId,
            pg: vodPage,
          })
          : await invoke<string>("fetch_vod_category", {
            apiUrl: site.api,
            tid: activeClassId,
            pg: vodPage,
          });

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
        const fallbackMessage = humanizeVodError(reason instanceof Error ? reason.message : String(reason));
        const report = site.capability.requiresSpider ? await syncSpiderExecutionState(site.key) : null;
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
        ? await resolveSiteExtInput(activeVodSite)
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
        : await invoke<string>("fetch_vod_search", {
          apiUrl: activeVodSite.api,
          keyword,
        });

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
      const fallbackMessage = humanizeVodError(reason instanceof Error ? reason.message : String(reason));
      const report = activeVodSite.capability.requiresSpider ? await syncSpiderExecutionState(activeVodSite.key) : null;
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
    if (activeSiteKey === siteKey) {
      clearTvBoxRuntimeCaches();
      invalidateVodRequests();
      setSiteRuntimeStates((current) => {
        const next = resetSpiderRuntimeIsolation(current[siteKey]);
        if (!next) return current;
        return { ...current, [siteKey]: next };
      });
      setSiteReloadToken((current) => current + 1);
      return;
    }
    clearTvBoxRuntimeCaches();
    invalidateVodRequests();
    resetVodBrowseState();
    setActiveSiteKey(siteKey);
    persistSelection({ siteKey });
  }, [activeSiteKey, invalidateVodRequests, persistSelection, resetVodBrowseState]);

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
    notify({ kind: "success", text: "点播源已清空。" });
  }, [notify, resetVodBrowseState, resetVodRuntimeState]);

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
    setClassFilterKeyword,
    setVodSearchKeyword,
    setSelectedVodId,
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
    resolveMsearchAndPlay,
  };
}
