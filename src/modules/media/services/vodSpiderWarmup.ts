import { invoke } from "@tauri-apps/api/core";

import { humanizeVodError } from "@/modules/media/services/mediaError";
import type {
  CompatHelperStatus,
  SpiderExecutionReport,
  SpiderPrefetchResult,
} from "@/modules/media/types/tvbox.types";

type SpiderJarStatus = "idle" | "loading" | "ready" | "error";

interface ActiveWarmupPromiseRef {
  current: Promise<SpiderPrefetchResult | null> | null;
}

interface ProfileSpiderSiteRuntimeArgs {
  siteKey: string;
  spiderUrl: string;
  apiClass: string;
  ext: string;
  generation: number;
  isStaleControllerGeneration: (generation: number) => boolean;
  applySpiderExecutionState: (siteKey: string, report: SpiderExecutionReport | null) => void;
  syncCompatHelperStatus: () => Promise<CompatHelperStatus | null>;
}

interface TriggerSpiderRuntimeWarmupArgs {
  siteKey: string;
  spiderUrl: string;
  apiClass: string;
  ext: string;
  generation: number;
  runtimeWarmupPromises: Map<string, Promise<SpiderPrefetchResult | null>>;
  activePrefetchPromiseRef: ActiveWarmupPromiseRef;
  isStaleControllerGeneration: (generation: number) => boolean;
  clearSpiderExecutionReport: (siteKey?: string | null) => void;
  applySpiderPrefetchState: (siteKey: string, result: SpiderPrefetchResult) => void;
  applySpiderExecutionState: (siteKey: string, report: SpiderExecutionReport | null) => void;
  syncCompatHelperStatus: () => Promise<CompatHelperStatus | null>;
  onSetSiteChecking: (siteKey: string) => void;
  onSetSpiderJarStatus: (status: SpiderJarStatus) => void;
  onNotifyWarning: (message: string) => void;
  shouldTrackAsActive?: boolean;
  shouldProfileSite?: boolean;
}

export function buildSpiderRuntimeWarmupKey(spiderUrl: string, apiClass: string): string {
  return `${spiderUrl.trim()}::${apiClass.trim().toLowerCase()}`;
}

export function getSpiderRuntimeWarmupPromise(
  runtimeWarmupPromises: Map<string, Promise<SpiderPrefetchResult | null>>,
  spiderUrl: string,
  apiClass: string,
): Promise<SpiderPrefetchResult | null> | null {
  return runtimeWarmupPromises.get(buildSpiderRuntimeWarmupKey(spiderUrl, apiClass)) ?? null;
}

export async function profileSpiderSiteRuntime({
  siteKey,
  spiderUrl,
  apiClass,
  ext,
  generation,
  isStaleControllerGeneration,
  applySpiderExecutionState,
  syncCompatHelperStatus,
}: ProfileSpiderSiteRuntimeArgs): Promise<void> {
  try {
    const profileReport = await invoke<SpiderExecutionReport>("profile_spider_site", {
      spiderUrl,
      siteKey,
      apiClass,
      ext,
    });
    if (isStaleControllerGeneration(generation)) {
      return;
    }
    applySpiderExecutionState(siteKey, profileReport);
    if (profileReport.executionTarget === "desktop-helper") {
      await syncCompatHelperStatus();
    }
  } catch (reason) {
    if (isStaleControllerGeneration(generation)) {
      return;
    }
    console.warn("[Spider] Site profile warmup failed:", reason);
  }
}

export function triggerSpiderRuntimeWarmup({
  siteKey,
  spiderUrl,
  apiClass,
  ext,
  generation,
  runtimeWarmupPromises,
  activePrefetchPromiseRef,
  isStaleControllerGeneration,
  clearSpiderExecutionReport,
  applySpiderPrefetchState,
  applySpiderExecutionState,
  syncCompatHelperStatus,
  onSetSiteChecking,
  onSetSpiderJarStatus,
  onNotifyWarning,
  shouldTrackAsActive = true,
  shouldProfileSite = true,
}: TriggerSpiderRuntimeWarmupArgs): Promise<SpiderPrefetchResult | null> {
  if (!spiderUrl) {
    return Promise.resolve(null);
  }
  if (/app3q/i.test(apiClass)) {
    if (shouldTrackAsActive) {
      onSetSpiderJarStatus("ready");
    }
    return Promise.resolve(null);
  }

  const runtimeKey = buildSpiderRuntimeWarmupKey(spiderUrl, apiClass);
  const existingPromise = runtimeWarmupPromises.get(runtimeKey);
  if (existingPromise) {
    if (shouldTrackAsActive) {
      onSetSpiderJarStatus("loading");
      activePrefetchPromiseRef.current = existingPromise;
    }
    if (shouldProfileSite && siteKey) {
      void profileSpiderSiteRuntime({
        siteKey,
        spiderUrl,
        apiClass,
        ext,
        generation,
        isStaleControllerGeneration,
        applySpiderExecutionState,
        syncCompatHelperStatus,
      });
    }
    return existingPromise;
  }

  clearSpiderExecutionReport(siteKey);
  if (shouldTrackAsActive) {
    onSetSpiderJarStatus("loading");
  }
  if (siteKey) {
    onSetSiteChecking(siteKey);
  }

  const runtimeWarmup = invoke<SpiderPrefetchResult>("prefetch_spider_jar", { spiderUrl, apiClass })
    .then((result) => {
      if (isStaleControllerGeneration(generation)) {
        return null;
      }
      if (shouldTrackAsActive) {
        onSetSpiderJarStatus("ready");
      }
      if (siteKey) {
        applySpiderPrefetchState(siteKey, result);
      }
      return result;
    })
    .catch((reason) => {
      if (isStaleControllerGeneration(generation)) {
        return null;
      }
      console.warn("[Spider] JAR pre-fetch failed:", reason);
      if (shouldTrackAsActive) {
        onSetSpiderJarStatus("error");
      }

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
      onNotifyWarning(humanizeVodError(message));
      return null;
    })
    .finally(() => {
      runtimeWarmupPromises.delete(runtimeKey);
      if (activePrefetchPromiseRef.current === runtimeWarmup) {
        activePrefetchPromiseRef.current = null;
      }
    });

  runtimeWarmupPromises.set(runtimeKey, runtimeWarmup);
  if (shouldTrackAsActive) {
    activePrefetchPromiseRef.current = runtimeWarmup;
  }
  if (shouldProfileSite && siteKey) {
    void profileSpiderSiteRuntime({
      siteKey,
      spiderUrl,
      apiClass,
      ext,
      generation,
      isStaleControllerGeneration,
      applySpiderExecutionState,
      syncCompatHelperStatus,
    });
  }
  return runtimeWarmup;
}
