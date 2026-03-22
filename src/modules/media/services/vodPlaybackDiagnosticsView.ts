import {
  getVodPlaybackDiagnosticsElapsedMs,
  type VodPlaybackDiagnosticStage,
  type VodPlaybackDiagnosticStatus,
  type VodPlaybackDiagnostics,
} from "@/modules/media/services/vodPlaybackDiagnostics";

export interface VodPlaybackDiagnosticsReport {
  routeName: string;
  episodeName: string;
  status: "success" | "error";
  resolvedBy?: string;
  finalUrl?: string;
  reason?: string;
  diagnostics: VodPlaybackDiagnostics | null;
  updatedAt: number;
}

export interface VodPlaybackDiagnosticTimelineItem {
  index: number;
  stage: VodPlaybackDiagnosticStage;
  stageLabel: string;
  status: VodPlaybackDiagnosticStatus;
  statusLabel: string;
  elapsedMs: number | null;
  budgetMs: number | null;
  reason: string | null;
  summary: string;
  fields: Record<string, string>;
  detail: string;
}

const STAGE_LABELS: Record<VodPlaybackDiagnosticStage, string> = {
  spider_payload: "Spider 返回",
  wrapped_url: "包装页探测",
  parse_chain: "解析链路",
  parse_attempt: "解析尝试",
  webview_parse: "WebView 解析",
  direct_fallback: "直链回退",
  episode_direct: "剧集直链",
  final: "最终结果",
};

const STATUS_LABELS: Record<VodPlaybackDiagnosticStatus, string> = {
  success: "成功",
  miss: "落空",
  skip: "跳过",
  error: "失败",
};

function trimFieldValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseVodPlaybackDiagnosticDetail(detail: string): {
  fields: Record<string, string>;
  reason: string | null;
  summary: string;
} {
  const normalizedDetail = detail.trim();
  if (!normalizedDetail) {
    return {
      fields: {},
      reason: null,
      summary: "empty",
    };
  }

  const matches = [...normalizedDetail.matchAll(/(^|\s)([a-z_]+)=/g)];
  if (matches.length === 0) {
    return {
      fields: {},
      reason: null,
      summary: normalizedDetail,
    };
  }

  const fields: Record<string, string> = {};
  for (const [index, match] of matches.entries()) {
    const key = match[2]?.trim();
    if (!key) {
      continue;
    }
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length
      ? (matches[index + 1].index ?? normalizedDetail.length)
      : normalizedDetail.length;
    const value = trimFieldValue(normalizedDetail.slice(start, end));
    if (value) {
      fields[key] = value;
    }
  }

  const summary = fields.reason
    ?? fields.resolved
    ?? fields.target
    ?? fields.url
    ?? normalizedDetail;

  return {
    fields,
    reason: fields.reason ?? null,
    summary,
  };
}

export function buildVodPlaybackDiagnosticsTimeline(
  diagnostics: VodPlaybackDiagnostics | null | undefined,
): VodPlaybackDiagnosticTimelineItem[] {
  if (!diagnostics?.steps?.length) {
    return [];
  }

  return diagnostics.steps.map((step, index) => {
    const parsed = parseVodPlaybackDiagnosticDetail(step.detail);
    return {
      index,
      stage: step.stage,
      stageLabel: STAGE_LABELS[step.stage] ?? step.stage,
      status: step.status,
      statusLabel: STATUS_LABELS[step.status] ?? step.status,
      elapsedMs: typeof step.elapsedMs === "number" ? step.elapsedMs : null,
      budgetMs: typeof step.budgetMs === "number" ? step.budgetMs : null,
      reason: parsed.reason,
      summary: parsed.summary,
      fields: parsed.fields,
      detail: step.detail,
    };
  });
}

export function summarizeVodPlaybackDiagnosticsReport(
  report: VodPlaybackDiagnosticsReport | null | undefined,
): {
  totalElapsedMs: number | null;
  lastReason: string | null;
} {
  if (!report) {
    return {
      totalElapsedMs: null,
      lastReason: null,
    };
  }

  const timeline = buildVodPlaybackDiagnosticsTimeline(report.diagnostics);
  const lastReason = report.reason
    ?? [...timeline].reverse().find((item) => item.reason)?.reason
    ?? null;

  return {
    totalElapsedMs: getVodPlaybackDiagnosticsElapsedMs(report.diagnostics),
    lastReason,
  };
}
