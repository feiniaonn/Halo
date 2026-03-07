import { describe, expect, it } from "vitest";

import {
  buildSpiderFailureNotice,
  getSpiderRuntimeLabel,
  mergePrefetchArtifactState,
  mergeSpiderExecutionReport,
  shouldBlockAutoLoad,
} from "@/modules/media/services/spiderRuntime";
import type { SpiderExecutionReport } from "@/modules/media/types/tvbox.types";

describe("spiderRuntime", () => {
  it("maps compat-pack artifact to compat status", () => {
    const state = mergePrefetchArtifactState(undefined, {
      artifactKind: "DexOnly",
      requiredRuntime: "desktop-compat-pack",
      transformable: true,
      originalJarPath: "a.jar",
      preparedJarPath: "a.desktop.jar",
      classInventory: ["com.github.catvod.spider.Test"],
      nativeLibs: [],
    });
    expect(state.runtimeStatus).toBe("needs-compat-pack");
    expect(getSpiderRuntimeLabel(state)).toContain("兼容包");
  });

  it("soft-disables repeated failures", () => {
    const report: SpiderExecutionReport = {
      ok: false,
      siteKey: "csp_demo",
      method: "homeContent",
      executionTarget: "desktop-compat-pack",
      failureKind: "InitError",
      failureMessage: "NullPointerException",
      checkedAtMs: Date.now(),
      artifact: null,
    };

    const state1 = mergeSpiderExecutionReport(undefined, report);
    const state2 = mergeSpiderExecutionReport(state1, report);
    const state3 = mergeSpiderExecutionReport(state2, report);

    expect(state3.softDisabled).toBe(true);
    expect(state3.runtimeStatus).toBe("temporarily-disabled");
    expect(shouldBlockAutoLoad(state3)).toBe(true);
  });

  it("formats missing dependency notice", () => {
    expect(buildSpiderFailureNotice({
      ok: false,
      siteKey: "csp_demo",
      method: "homeContent",
      executionTarget: "desktop-compat-pack",
      failureKind: "MissingDependency",
      failureMessage: "NoClassDefFoundError",
      missingDependency: "com.google.gson.reflect.TypeToken",
      checkedAtMs: Date.now(),
      artifact: null,
    }, "fallback")).toContain("TypeToken");
  });

  it("marks helper routes with helper status", () => {
    const state = mergeSpiderExecutionReport(undefined, {
      ok: true,
      siteKey: "csp_ttian",
      method: "profile",
      executionTarget: "desktop-helper",
      checkedAtMs: Date.now(),
      artifact: {
        artifactKind: "DexOnly",
        requiredRuntime: "desktop-compat-pack",
        transformable: true,
        originalJarPath: "ttian.jar",
        preparedJarPath: "ttian.desktop.jar",
        classInventory: ["com.github.catvod.spider.TTian"],
        nativeLibs: [],
      },
      siteProfile: {
        className: "com.github.catvod.spider.TTian",
        hasContextInit: true,
        declaresContextInit: true,
        hasNonContextInit: true,
        hasNativeInit: false,
        hasNativeContentMethod: false,
        nativeMethods: [],
        initSignatures: ["init(android.content.Context, java.lang.String)"],
        needsContextShim: true,
        requiredCompatPacks: ["legacy-core"],
        requiredHelperPorts: [9966, 1072, 9999],
        recommendedTarget: "desktop-helper",
        routingReason: "localhost helper detected on ports 9966, 1072, 9999",
      },
    });

    expect(state.runtimeStatus).toBe("needs-local-helper");
    expect(shouldBlockAutoLoad(state)).toBe(false);
    expect(state.requiredHelperPorts).toEqual([9966, 1072, 9999]);
  });
});
