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
    expect(getSpiderRuntimeLabel(state)).toMatch(/.+/);
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

  it("does not immediately isolate single upstream response failures", () => {
    const report: SpiderExecutionReport = {
      ok: false,
      siteKey: "csp_app3q",
      method: "homeContent",
      executionTarget: "desktop-compat-pack",
      failureKind: "SiteRuntimeError",
      failureMessage: "A JSONObject text must begin with '{' at 0 [character 1 line 1]",
      checkedAtMs: Date.now(),
      artifact: null,
    };

    const state = mergeSpiderExecutionReport(undefined, report);

    expect(state.softDisabled).toBe(false);
    expect(state.failureCount).toBe(1);
    expect(shouldBlockAutoLoad(state)).toBe(false);
    expect(buildSpiderFailureNotice(report, "fallback")).not.toContain("临时隔离");
  });

  it("does not immediately isolate empty-list runtime failures", () => {
    const report: SpiderExecutionReport = {
      ok: false,
      siteKey: "csp_ygp",
      method: "homeContent",
      executionTarget: "desktop-compat-pack",
      failureKind: "SiteRuntimeError",
      failureMessage: "java.lang.IndexOutOfBoundsException: Index 0 out of bounds for length 0",
      checkedAtMs: Date.now(),
      artifact: null,
    };

    const state = mergeSpiderExecutionReport(undefined, report);

    expect(state.softDisabled).toBe(false);
    expect(state.failureCount).toBe(1);
    expect(shouldBlockAutoLoad(state)).toBe(false);
  });

  it("still immediately isolates deterministic class-selection failures", () => {
    const report: SpiderExecutionReport = {
      ok: false,
      siteKey: "csp_demo",
      method: "homeContent",
      executionTarget: "desktop-direct",
      failureKind: "ClassSelectionError",
      failureMessage: "explicit spider hint not found in JAR",
      checkedAtMs: Date.now(),
      artifact: null,
    };

    const state = mergeSpiderExecutionReport(undefined, report);

    expect(state.softDisabled).toBe(true);
    expect(state.failureCount).toBeGreaterThanOrEqual(3);
    expect(shouldBlockAutoLoad(state)).toBe(true);
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

  it("does not downgrade profile-stage site errors into terminal site status", () => {
    const prefetchState = mergePrefetchArtifactState(undefined, {
      artifactKind: "JvmJar",
      requiredRuntime: "desktop-direct",
      transformable: false,
      originalJarPath: "douban.jar",
      preparedJarPath: "douban.jar",
      classInventory: ["com.github.catvod.spider.Douban"],
      nativeLibs: [],
    });

    const state = mergeSpiderExecutionReport(prefetchState, {
      ok: false,
      siteKey: "csp_douban",
      method: "profile",
      executionTarget: "desktop-direct",
      failureKind: "InitError",
      failureMessage: "Spider profile runner returned no delimited payload",
      checkedAtMs: Date.now(),
      artifact: prefetchState.artifact ?? null,
      siteProfile: null,
    });

    expect(state.runtimeStatus).toBe("desktop-ready");
    expect(state.failureCount).toBe(0);
    expect(state.softDisabled).toBe(false);
  });

  it("keeps content execution state authoritative over later profile reports", () => {
    const contentState = mergeSpiderExecutionReport(undefined, {
      ok: true,
      siteKey: "csp_douban",
      method: "homeContent",
      executionTarget: "desktop-direct",
      checkedAtMs: 200,
      artifact: null,
      siteProfile: null,
    });

    const state = mergeSpiderExecutionReport(contentState, {
      ok: false,
      siteKey: "csp_douban",
      method: "profile",
      executionTarget: "desktop-helper",
      failureKind: "SiteRuntimeError",
      failureMessage: "profile stage failed before a class was resolved",
      checkedAtMs: 250,
      artifact: null,
      siteProfile: {
        className: "com.github.catvod.spider.Douban",
        hasContextInit: false,
        declaresContextInit: false,
        hasNonContextInit: true,
        hasNativeInit: false,
        hasNativeContentMethod: false,
        nativeMethods: [],
        initSignatures: [],
        needsContextShim: false,
        requiredCompatPacks: [],
        requiredHelperPorts: [9978],
        recommendedTarget: "desktop-helper",
        routingReason: "profile stage failed before a class was resolved",
      },
    });

    expect(state.runtimeStatus).toBe("desktop-ready");
    expect(state.executionTarget).toBe("desktop-direct");
    expect(state.lastReportMethod).toBe("homeContent");
    expect(state.requiredHelperPorts).toEqual([9978]);
  });

  it("ignores stale execution reports", () => {
    const latest = mergeSpiderExecutionReport(undefined, {
      ok: true,
      siteKey: "csp_demo",
      method: "homeContent",
      executionTarget: "desktop-direct",
      checkedAtMs: 200,
      artifact: null,
      siteProfile: null,
    });

    const stale = mergeSpiderExecutionReport(latest, {
      ok: false,
      siteKey: "csp_demo",
      method: "profile",
      executionTarget: "desktop-direct",
      failureKind: "InitError",
      failureMessage: "older profile failure",
      checkedAtMs: 100,
      artifact: null,
      siteProfile: null,
    });

    expect(stale).toEqual(latest);
  });
});

