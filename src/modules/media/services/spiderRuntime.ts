import type {
  SpiderArtifactAnalysis,
  SpiderExecutionReport,
  SpiderExecutionTarget,
  SpiderFailureKind,
  SpiderSiteRuntimeState,
  SpiderRuntimeStatus,
} from "@/modules/media/types/tvbox.types";

const SOFT_DISABLE_THRESHOLD = 3;
const PREFLIGHT_METHODS = new Set(["prefetch", "profile"]);

function isPreflightMethod(method?: string | null): boolean {
  return PREFLIGHT_METHODS.has((method ?? "").trim());
}

function isImmediateSourceFailure(report: SpiderExecutionReport): boolean {
  if (report.ok || report.method !== "homeContent") return false;

  if (report.sourceHealthImpact === "hard") return true;
  return report.failureCode === "ClassSelectionMiss" || report.failureKind === "ClassSelectionError";
}

function statusFromExecutionTarget(target: SpiderExecutionTarget): SpiderRuntimeStatus {
  switch (target) {
    case "desktop-compat-pack":
      return "needs-compat-pack";
    case "desktop-helper":
      return "needs-local-helper";
    default:
      return "desktop-ready";
  }
}

function statusFromArtifact(artifact: SpiderArtifactAnalysis): SpiderRuntimeStatus {
  return statusFromExecutionTarget(artifact.requiredRuntime);
}

function statusFromFailure(kind?: SpiderFailureKind | null): SpiderRuntimeStatus {
  switch (kind) {
    case "MissingDependency":
      return "missing-dependency";
    case "NeedsContextShim":
    case "NeedsCompatPack":
    case "TransformError":
      return "needs-compat-pack";
    case "NeedsLocalHelper":
      return "needs-local-helper";
    case "FetchError":
    case "NativeMethodBlocked":
    case "ClassSelectionError":
    case "InitError":
    case "SiteRuntimeError":
    case "ResponseShapeError":
    case "Timeout":
    case "Unknown":
      return "site-error";
    default:
      return "desktop-ready";
  }
}

function fallbackStatusFromPreflight(
  previous: SpiderSiteRuntimeState | null | undefined,
  report: SpiderExecutionReport,
): SpiderRuntimeStatus {
  const preferredTarget = report.siteProfile?.recommendedTarget ?? report.executionTarget;
  if (preferredTarget !== "desktop-direct") {
    return statusFromExecutionTarget(preferredTarget);
  }
  if (report.artifact) {
    return statusFromArtifact(report.artifact);
  }
  if (previous?.artifact) {
    return statusFromArtifact(previous.artifact);
  }
  return statusFromExecutionTarget(preferredTarget);
}

function mergeSupplementalState(
  previous: SpiderSiteRuntimeState,
  report: SpiderExecutionReport,
): SpiderSiteRuntimeState {
  return {
    ...previous,
    healthCheckedAt: Math.max(previous.healthCheckedAt ?? 0, report.checkedAtMs) || null,
    artifact: report.artifact ?? previous.artifact,
    siteProfile: report.siteProfile ?? previous.siteProfile,
    requiredCompatPacks: report.siteProfile?.requiredCompatPacks ?? previous.requiredCompatPacks,
    requiredHelperPorts: report.siteProfile?.requiredHelperPorts ?? previous.requiredHelperPorts,
  };
}

export function buildCheckingSpiderRuntimeState(
  previous?: SpiderSiteRuntimeState | null,
): SpiderSiteRuntimeState {
  return {
    runtimeStatus: "checking",
    executionTarget: previous?.executionTarget ?? "desktop-direct",
    healthCheckedAt: previous?.healthCheckedAt ?? null,
    lastReportMethod: previous?.lastReportMethod,
    lastFailureKind: previous?.lastFailureKind,
    lastFailureCode: previous?.lastFailureCode,
    lastFailureMessage: previous?.lastFailureMessage,
    missingDependency: previous?.missingDependency,
    failureCount: previous?.failureCount ?? 0,
    softDisabled: previous?.softDisabled ?? false,
    artifact: previous?.artifact,
    siteProfile: previous?.siteProfile,
    requiredCompatPacks: previous?.requiredCompatPacks ?? [],
    requiredHelperPorts: previous?.requiredHelperPorts ?? [],
  };
}

export function mergePrefetchArtifactState(
  previous: SpiderSiteRuntimeState | null | undefined,
  artifact: SpiderArtifactAnalysis,
): SpiderSiteRuntimeState {
  return {
    runtimeStatus: previous?.softDisabled ? "temporarily-disabled" : statusFromArtifact(artifact),
    executionTarget: artifact.requiredRuntime,
    healthCheckedAt: previous?.healthCheckedAt ?? null,
    lastReportMethod: "prefetch",
    lastFailureKind: previous?.lastFailureKind,
    lastFailureCode: previous?.lastFailureCode,
    lastFailureMessage: previous?.lastFailureMessage,
    missingDependency: previous?.missingDependency,
    failureCount: previous?.failureCount ?? 0,
    softDisabled: previous?.softDisabled ?? false,
    artifact,
    siteProfile: previous?.siteProfile,
    requiredCompatPacks: previous?.requiredCompatPacks ?? [],
    requiredHelperPorts: previous?.requiredHelperPorts ?? [],
  };
}

export function mergeSpiderExecutionReport(
  previous: SpiderSiteRuntimeState | null | undefined,
  report: SpiderExecutionReport,
): SpiderSiteRuntimeState {
  if (previous?.healthCheckedAt && report.checkedAtMs < previous.healthCheckedAt) {
    return previous;
  }

  const incomingStatus = report.ok
    ? statusFromExecutionTarget(report.executionTarget)
    : statusFromFailure(report.failureKind);
  const incomingPreflight = isPreflightMethod(report.method);
  const hasAuthoritativeContentState = !!previous?.lastReportMethod && !isPreflightMethod(previous.lastReportMethod);
  if (incomingPreflight && previous && hasAuthoritativeContentState) {
    return mergeSupplementalState(previous, report);
  }

  const suppressPreflightSiteError = incomingPreflight && !report.ok && incomingStatus === "site-error";
  const immediateDisable = !suppressPreflightSiteError && isImmediateSourceFailure(report);
  const repeatedFailure = !suppressPreflightSiteError
    && !report.ok
    && (
      (report.failureCode && previous?.lastFailureCode === report.failureCode)
      || (report.failureKind && previous?.lastFailureKind === report.failureKind)
    );
  const failureCount = report.ok
    ? 0
    : suppressPreflightSiteError
      ? previous?.failureCount ?? 0
      : immediateDisable
      ? SOFT_DISABLE_THRESHOLD
      : repeatedFailure
        ? (previous?.failureCount ?? 0) + 1
        : 1;
  const softDisabled = suppressPreflightSiteError
    ? previous?.softDisabled ?? false
    : !report.ok && (immediateDisable || failureCount >= SOFT_DISABLE_THRESHOLD);
  const baseStatus = suppressPreflightSiteError
    ? fallbackStatusFromPreflight(previous, report)
    : incomingStatus;

  return {
    runtimeStatus: softDisabled ? "temporarily-disabled" : baseStatus,
    executionTarget: report.executionTarget,
    healthCheckedAt: report.checkedAtMs,
    lastReportMethod: report.method,
    lastFailureKind: suppressPreflightSiteError ? previous?.lastFailureKind : report.failureKind ?? undefined,
    lastFailureCode: suppressPreflightSiteError ? previous?.lastFailureCode : report.failureCode ?? undefined,
    lastFailureMessage: suppressPreflightSiteError ? previous?.lastFailureMessage : report.failureMessage ?? undefined,
    missingDependency: suppressPreflightSiteError ? previous?.missingDependency : report.missingDependency ?? undefined,
    failureCount,
    softDisabled,
    artifact: report.artifact ?? previous?.artifact,
    siteProfile: report.siteProfile ?? previous?.siteProfile,
    requiredCompatPacks: report.siteProfile?.requiredCompatPacks ?? previous?.requiredCompatPacks ?? [],
    requiredHelperPorts: report.siteProfile?.requiredHelperPorts ?? previous?.requiredHelperPorts ?? [],
  };
}

export function resetSpiderRuntimeIsolation(
  previous: SpiderSiteRuntimeState | null | undefined,
): SpiderSiteRuntimeState | null {
  if (!previous) return null;
  return {
    ...previous,
    runtimeStatus: previous.artifact
      ? statusFromArtifact(previous.artifact)
      : statusFromExecutionTarget(previous.executionTarget),
    failureCount: 0,
    softDisabled: false,
  };
}

export function shouldBlockAutoLoad(
  state: SpiderSiteRuntimeState | null | undefined,
): boolean {
  return state?.runtimeStatus === "temporarily-disabled";
}

export function getSpiderRuntimeLabel(
  state: SpiderSiteRuntimeState | null | undefined,
): string {
  switch (state?.runtimeStatus) {
    case "checking":
      return "检测中";
    case "desktop-ready":
      return "桌面直跑";
    case "needs-compat-pack":
      return "兼容包路径";
    case "needs-local-helper":
      return "本地 Helper";
    case "missing-dependency":
      return "缺运行库";
    case "site-error":
      return "站点异常";
    case "temporarily-disabled":
      return "临时隔离";
    default:
      return "未检测";
  }
}

export function getSpiderRuntimeTone(
  state: SpiderSiteRuntimeState | null | undefined,
): "neutral" | "success" | "warning" | "error" {
  switch (state?.runtimeStatus) {
    case "desktop-ready":
      return "success";
    case "checking":
    case "needs-compat-pack":
    case "needs-local-helper":
      return "warning";
    case "missing-dependency":
    case "site-error":
    case "temporarily-disabled":
      return "error";
    default:
      return "neutral";
  }
}

export function describeSpiderFailureKind(
  kind?: SpiderFailureKind | null,
): string {
  switch (kind) {
    case "FetchError":
      return "Spider 资源准备失败";
    case "TransformError":
      return "Dex 转换失败";
    case "MissingDependency":
      return "缺少运行依赖";
    case "NeedsContextShim":
      return "需要 Context 兼容";
    case "NeedsCompatPack":
      return "需要兼容包";
    case "NeedsLocalHelper":
      return "需要本地 Helper";
    case "NativeMethodBlocked":
      return "Native/JNI 被阻断";
    case "ClassSelectionError":
      return "未命中正确 Spider 类";
    case "InitError":
      return "Spider 初始化失败";
    case "SiteRuntimeError":
      return "站点运行异常";
    case "ResponseShapeError":
      return "返回结构异常";
    case "Timeout":
      return "执行超时";
    case "Unknown":
      return "未分类错误";
    default:
      return "未知状态";
  }
}

export function buildSpiderFailureNotice(
  report: SpiderExecutionReport | null | undefined,
  fallbackMessage: string,
): string {
  if (!report) return fallbackMessage;

  if (isImmediateSourceFailure(report)) {
    return "当前接口疑似已失效或上游返回已变，本次会话已暂时隔离，避免重复拖慢页面。";
  }

  if (report.failureKind === "MissingDependency" && report.missingDependency) {
    return `Spider 缺少运行依赖: ${report.missingDependency}`;
  }

  if (report.failureKind === "NeedsLocalHelper") {
    const ports = report.siteProfile?.requiredHelperPorts?.length
      ? `，所需端口：${report.siteProfile.requiredHelperPorts.join(", ")}`
      : "";
    return `当前接口需要本地兼容服务，但 helper 启动或探活失败${ports}。`;
  }

  if (report.failureKind === "NeedsCompatPack") {
    const packs = report.siteProfile?.requiredCompatPacks?.length
      ? `，所需兼容包：${report.siteProfile.requiredCompatPacks.join(", ")}`
      : "";
    return `当前接口需要桌面兼容包，但兼容包未命中或加载失败${packs}。`;
  }

  if (report.failureKind === "NeedsContextShim") {
    return "当前接口声明了 Android Context 初始化，需要经过桌面兼容层。";
  }

  if (report.failureKind === "NativeMethodBlocked") {
    return "当前接口命中了 native/JNI 路径，当前桌面兼容层还没有把这条链接住。";
  }

  const summary = describeSpiderFailureKind(report.failureKind);
  if (report.siteProfile?.routingReason) {
    return report.failureMessage
      ? `${summary}: ${report.failureMessage}（${report.siteProfile.routingReason}）`
      : `${summary}（${report.siteProfile.routingReason}）`;
  }
  return report.failureMessage ? `${summary}: ${report.failureMessage}` : summary;
}
