import type {
  SpiderArtifactAnalysis,
  SpiderExecutionReport,
  SpiderExecutionTarget,
  SpiderFailureKind,
  SpiderSiteRuntimeState,
  SpiderRuntimeStatus,
  SpiderFailureCode,
  VodResponse,
} from "@/modules/media/types/tvbox.types";

const SOFT_DISABLE_THRESHOLD = 3;
const PREFLIGHT_METHODS = new Set(["prefetch", "profile"]);
const EMPTY_HOME_CONTENT_PATTERNS = [
  /homecontent returned no canonical class or list/i,
  /homecontent returned no canonical list/i,
  /homecontent returned neither class nor list/i,
];
const DETERMINISTIC_INIT_FAILURE_PATTERNS = [
  /Expected URL scheme 'http' or 'https' but no colon was found/i,
  /no protocol:/i,
  /MalformedURLException/i,
];
const BLOCKED_HTML_PATTERNS = [
  /<!doctype html/i,
  /<html[\s>]/i,
  /Protected By .* WAF/i,
  /window\.product_data/i,
  /SafeLine/i,
];

function isPreflightMethod(method?: string | null): boolean {
  return PREFLIGHT_METHODS.has((method ?? "").trim());
}

function matchesEmptyHomeContentFailure(message?: string | null): boolean {
  const normalized = (message ?? "").trim();
  if (!normalized) return false;
  return EMPTY_HOME_CONTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isEmptyHomeContentFailure(report: SpiderExecutionReport): boolean {
  return !report.ok
    && report.method === "homeContent"
    && report.failureKind === "ResponseShapeError"
    && matchesEmptyHomeContentFailure(report.failureMessage);
}

function matchesDeterministicInitFailure(message?: string | null): boolean {
  const normalized = (message ?? "").trim();
  if (!normalized) return false;
  return DETERMINISTIC_INIT_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isDeterministicInitFailure(
  report: Pick<SpiderExecutionReport, "failureKind" | "failureCode" | "failureMessage" | "method" | "ok">,
): boolean {
  if (report.ok || report.method !== "homeContent") {
    return false;
  }
  if (report.failureKind !== "InitError" && report.failureCode !== "RuntimeInitFailed") {
    return false;
  }
  return matchesDeterministicInitFailure(report.failureMessage);
}

function isClassSelectionFailure(report: SpiderExecutionReport | SpiderSiteRuntimeState): boolean {
  const failureCode = "failureCode" in report
    ? report.failureCode
    : (report as SpiderSiteRuntimeState).lastFailureCode;
  const failureKind = "failureKind" in report
    ? report.failureKind
    : (report as SpiderSiteRuntimeState).lastFailureKind;
  return failureCode === "ClassSelectionMiss"
    || failureKind === "ClassSelectionError";
}

function matchesBlockedHtmlPayload(rawPayload?: string | null): boolean {
  const normalized = (rawPayload ?? "").trim();
  if (!normalized) return false;
  return BLOCKED_HTML_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isBlockedHtmlFailureCode(code?: SpiderFailureCode | null): boolean {
  return code === "UpstreamForbidden";
}

function hasCanonicalVodPayload(payload?: Pick<VodResponse, "class" | "list"> | null): boolean {
  return Boolean(payload?.class?.length || payload?.list?.length);
}

function isImmediateSourceFailure(report: SpiderExecutionReport): boolean {
  if (report.ok || report.method !== "homeContent") return false;

  if (report.sourceHealthImpact === "hard") return true;
  return isClassSelectionFailure(report)
    || isDeterministicInitFailure(report)
    || isEmptyHomeContentFailure(report);
}

export function buildDerivedSpiderPayloadReport(
  report: SpiderExecutionReport,
  rawPayload: string | null | undefined,
  payload: Pick<VodResponse, "class" | "list"> | null | undefined,
): SpiderExecutionReport | null {
  if (!report.ok || report.method !== "homeContent") {
    return null;
  }
  if (hasCanonicalVodPayload(payload)) {
    return null;
  }
  if (!matchesBlockedHtmlPayload(rawPayload)) {
    return null;
  }

  return {
    ...report,
    ok: false,
    failureKind: "ResponseShapeError",
    failureCode: "UpstreamForbidden",
    failureMessage: "上游返回了 WAF/拦截 HTML，未提供可解析的首页数据。",
    sourceHealthImpact: "hard",
    retryable: false,
    checkedAtMs: report.checkedAtMs + 1,
  };
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

export function shouldHideRuntimeSite(
  state: SpiderSiteRuntimeState | null | undefined,
): boolean {
  if (!state?.softDisabled) {
    return false;
  }
  if (state.lastReportMethod !== "homeContent") {
    return false;
  }
  if (isClassSelectionFailure(state)) {
    return true;
  }
  if (matchesDeterministicInitFailure(state.lastFailureMessage)
    && (state.lastFailureKind === "InitError" || state.lastFailureCode === "RuntimeInitFailed")) {
    return true;
  }
  if (state.lastFailureKind === "ResponseShapeError" && matchesEmptyHomeContentFailure(state.lastFailureMessage)) {
    return true;
  }
  return isBlockedHtmlFailureCode(state.lastFailureCode);
}

export function shouldDeprioritizeRuntimeSite(
  state: SpiderSiteRuntimeState | null | undefined,
): boolean {
  if (!state) {
    return false;
  }
  if (shouldHideRuntimeSite(state)) {
    return true;
  }
  switch (state.runtimeStatus) {
    case "temporarily-disabled":
    case "site-error":
    case "missing-dependency":
    case "needs-compat-pack":
    case "needs-local-helper":
      return true;
    default:
      return false;
  }
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
  if (report.method === "prefetch" && report.failureKind === "FetchError") {
    return "Spider 运行资源预取失败，当前接口会在真实请求时继续重试；若持续失败，再考虑切换接口。";
  }

  if (isBlockedHtmlFailureCode(report.failureCode)) {
    return "当前接口被上游风控/WAF 拦截，桌面端已暂时隔离，避免继续空跑。";
  }

  if (isDeterministicInitFailure(report)) {
    return "当前接口初始化时构造了非法 URL，这类站点属于确定性失败，桌面端会暂时隔离避免反复空跑。";
  }

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
