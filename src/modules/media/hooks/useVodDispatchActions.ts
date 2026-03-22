import { useCallback, type MutableRefObject } from "react";

import {
  classifyVodDispatchFailure,
  recordVodDispatchBackendFailure,
  recordVodDispatchBackendSuccess,
} from "@/modules/media/services/vodDispatchHealth";
import { fetchVodDetail } from "@/modules/media/services/vodDetail";
import { resolveVodDispatchMatches } from "@/modules/media/services/vodDispatchResolver";
import type { MediaNotice } from "@/modules/media/types/mediaPage.types";
import type {
  NormalizedTvBoxConfig,
  NormalizedTvBoxSite,
  SpiderExecutionReport,
} from "@/modules/media/types/tvbox.types";
import type {
  VodDispatchCandidate,
  VodDispatchResolution,
} from "@/modules/media/types/vodDispatch.types";
import type { VodDetail, VodRoute } from "@/modules/media/types/vodWindow.types";

interface UseVodDispatchActionsArgs {
  config: NormalizedTvBoxConfig | null;
  activeSiteKey: string;
  activeSiteKeyRef: MutableRefObject<string>;
  sourceRef: MutableRefObject<string>;
  activeRepoUrlRef: MutableRefObject<string>;
  runtimeSessionKeyRef: MutableRefObject<string>;
  networkPolicyGenerationRef: MutableRefObject<number>;
  controllerGenerationRef: MutableRefObject<number>;
  beginDispatchSearchSession: () => number;
  isStaleDispatchSearchSession: (generation: number, sessionId: number) => boolean;
  resolveSiteExt: (
    site: Pick<NormalizedTvBoxSite, "api" | "extKind" | "extValue">,
    options?: { forceRefresh?: boolean },
  ) => Promise<string>;
  getSpiderRuntimeWarmupPromise: (
    spiderUrl: string,
    apiClass: string,
  ) => Promise<unknown> | null;
  syncSpiderExecutionState: (siteKey: string) => Promise<SpiderExecutionReport | null>;
  recordSiteSuccess: (siteKey: string) => void;
  clearSelectedVod: () => void;
  openVodFromDetail: (
    site: NormalizedTvBoxSite,
    extInput: string,
    detail: VodDetail,
    routes: VodRoute[],
    routeIdx?: number,
    episodeIdx?: number,
  ) => Promise<void>;
  notify: (notice: MediaNotice) => void;
}

const NO_ROUTE_MESSAGE = "Matched detail returned no playable routes.";

export function useVodDispatchActions({
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
}: UseVodDispatchActionsArgs) {
  const resolveMsearchMatches = useCallback(async (
    keyword: string,
    fallbackTitle = "",
    maxMatches = 4,
    originSiteKey = activeSiteKeyRef.current,
  ): Promise<VodDispatchResolution> => {
    const resolvedOriginSiteKey = originSiteKey.trim() || activeSiteKeyRef.current;
    if (!config || !resolvedOriginSiteKey) {
      throw new Error("Current source is unavailable for dispatch search.");
    }

    const generation = controllerGenerationRef.current;
    const sessionId = beginDispatchSearchSession();
    const resolution = await resolveVodDispatchMatches({
      keyword,
      fallbackTitle,
      maxMatches,
      config,
      activeSiteKey,
      originSiteKey: resolvedOriginSiteKey,
      sourceKey: sourceRef.current,
      repoUrl: activeRepoUrlRef.current,
      runtimeSessionKey: runtimeSessionKeyRef.current,
      policyGeneration: networkPolicyGenerationRef.current,
      concurrency: 8,
      isStale: () => isStaleDispatchSearchSession(generation, sessionId),
      resolveSiteExt,
      getSpiderRuntimeWarmupPromise,
      syncSpiderExecutionState,
    });
    for (const siteKey of new Set(resolution.matches.map((item) => item.siteKey))) {
      recordSiteSuccess(siteKey);
    }
    return resolution;
  }, [
    activeSiteKey,
    activeSiteKeyRef,
    activeRepoUrlRef,
    beginDispatchSearchSession,
    config,
    controllerGenerationRef,
    getSpiderRuntimeWarmupPromise,
    isStaleDispatchSearchSession,
    networkPolicyGenerationRef,
    recordSiteSuccess,
    resolveSiteExt,
    runtimeSessionKeyRef,
    sourceRef,
    syncSpiderExecutionState,
  ]);

  const playDispatchCandidate = useCallback(async (
    candidate: VodDispatchCandidate,
  ) => {
    const targetSite = config?.sites.find((site) => site.key === candidate.siteKey) ?? null;
    if (!config || !targetSite) {
      throw new Error("Matched site context is no longer available.");
    }

    const originSiteKey = candidate.originSiteKey?.trim() || activeSiteKeyRef.current;

    try {
      let detail = candidate.detail;
      let routes = candidate.routes ?? [];
      let extInput = candidate.extInput ?? "";

      if (!detail || !extInput || candidate.requiresDetailResolve || routes.length === 0) {
        const detailResult = await fetchVodDetail(
          {
            site: targetSite,
            spider: config.spider,
            sourceKey: sourceRef.current,
            repoUrl: activeRepoUrlRef.current,
            runtimeSessionKey: runtimeSessionKeyRef.current,
            policyGeneration: networkPolicyGenerationRef.current,
          },
          candidate.vodId,
        );
        detail = detailResult.detail;
        routes = detailResult.routes;
        extInput = detailResult.extInput;
      }

      if (!detail || !extInput || routes.length === 0) {
        notify({
          kind: "warning",
          text: `接口 [${candidate.siteName}] 已命中，但没有返回可播放线路。`,
        });
        throw new Error(NO_ROUTE_MESSAGE);
      }

      clearSelectedVod();
      await openVodFromDetail(targetSite, extInput, detail, routes, 0, 0);
      recordSiteSuccess(targetSite.key);
      void recordVodDispatchBackendSuccess(
        sourceRef.current,
        activeRepoUrlRef.current,
        originSiteKey,
        targetSite.key,
      ).catch(() => {
        // Ignore persistence failures after the candidate resolves successfully.
      });
      notify({ kind: "success", text: `已切换到 [${candidate.siteName}] 播放。` });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message !== NO_ROUTE_MESSAGE) {
        const report = targetSite.capability.requiresSpider
          ? await syncSpiderExecutionState(targetSite.key)
          : null;
        const failureKind = classifyVodDispatchFailure(message, report);
        void recordVodDispatchBackendFailure(
          sourceRef.current,
          activeRepoUrlRef.current,
          originSiteKey,
          targetSite.key,
          failureKind,
          undefined,
        ).catch(() => {
          // Ignore backend stat persistence failures for lazy detail resolution.
        });
        notify({ kind: "error", text: `接口 [${candidate.siteName}] 解析失败: ${message}` });
      }
      throw reason instanceof Error ? reason : new Error(message);
    }
  }, [
    activeRepoUrlRef,
    activeSiteKeyRef,
    clearSelectedVod,
    config,
    networkPolicyGenerationRef,
    notify,
    openVodFromDetail,
    recordSiteSuccess,
    runtimeSessionKeyRef,
    sourceRef,
    syncSpiderExecutionState,
  ]);

  const resolveMsearchAndPlay = useCallback(async (
    keyword: string,
    fallbackTitle = "",
    originSiteKey = activeSiteKeyRef.current,
  ) => {
    const resolution = await resolveMsearchMatches(keyword, fallbackTitle, 1, originSiteKey);
    const firstMatch = resolution.matches[0];
    if (!firstMatch) {
      throw new Error("未在可用站点中找到可播放节点。");
    }

    await playDispatchCandidate({
      ...firstMatch,
      originSiteKey: firstMatch.originSiteKey || originSiteKey,
    });
  }, [activeSiteKeyRef, playDispatchCandidate, resolveMsearchMatches]);

  return {
    playDispatchCandidate,
    resolveMsearchMatches,
    resolveMsearchAndPlay,
  };
}
