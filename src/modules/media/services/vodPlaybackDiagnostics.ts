export type VodPlaybackDiagnosticStage =
  | "spider_payload"
  | "wrapped_url"
  | "parse_chain"
  | "parse_attempt"
  | "webview_parse"
  | "direct_fallback"
  | "episode_direct"
  | "final";

export type VodPlaybackDiagnosticStatus = "success" | "miss" | "skip" | "error";

export interface VodPlaybackDiagnosticStep {
  stage: VodPlaybackDiagnosticStage;
  status: VodPlaybackDiagnosticStatus;
  detail: string;
  elapsedMs?: number;
  budgetMs?: number;
}

export interface VodPlaybackDiagnostics {
  startedAt: number;
  steps: VodPlaybackDiagnosticStep[];
}

type VodPlaybackDiagnosticCarrier = {
  diagnostics?: VodPlaybackDiagnostics;
  playbackDiagnostics?: VodPlaybackDiagnostics;
};

function cloneVodPlaybackDiagnostics(diagnostics: VodPlaybackDiagnostics): VodPlaybackDiagnostics {
  return {
    startedAt: diagnostics.startedAt,
    steps: diagnostics.steps.map((step) => ({ ...step })),
  };
}

function summarizeDiagnosticValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "empty";
  }
  if (trimmed.length <= 96) {
    return trimmed;
  }
  return `${trimmed.slice(0, 64)}...${trimmed.slice(-24)}(len=${trimmed.length})`;
}

export function createVodPlaybackDiagnostics(): VodPlaybackDiagnostics {
  return {
    startedAt: Date.now(),
    steps: [],
  };
}

export function appendPlaybackDiagnostic(
  diagnostics: VodPlaybackDiagnostics,
  stage: VodPlaybackDiagnosticStage,
  status: VodPlaybackDiagnosticStatus,
  detail: string,
  options?: {
    budgetMs?: number;
    nowMs?: number;
  },
): void {
  const nowMs = options?.nowMs ?? Date.now();
  diagnostics.steps.push({
    stage,
    status,
    detail: summarizeDiagnosticValue(detail),
    elapsedMs: Math.max(0, nowMs - diagnostics.startedAt),
    budgetMs:
      typeof options?.budgetMs === "number" && Number.isFinite(options.budgetMs)
        ? Math.max(0, Math.round(options.budgetMs))
        : undefined,
  });
}

export function attachVodPlaybackDiagnostics<T extends object>(
  target: T,
  diagnostics: VodPlaybackDiagnostics,
  field: keyof VodPlaybackDiagnosticCarrier,
): T {
  Object.defineProperty(target, field, {
    value: cloneVodPlaybackDiagnostics(diagnostics),
    configurable: true,
    enumerable: false,
    writable: true,
  });
  return target;
}

export function buildVodPlaybackError(message: string, diagnostics: VodPlaybackDiagnostics): Error {
  appendPlaybackDiagnostic(diagnostics, "final", "error", message);
  return attachVodPlaybackDiagnostics(new Error(message), diagnostics, "playbackDiagnostics");
}

export function getVodPlaybackDiagnostics(value: unknown): VodPlaybackDiagnostics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const carrier = value as VodPlaybackDiagnosticCarrier;
  const diagnostics = carrier.diagnostics ?? carrier.playbackDiagnostics;
  if (!diagnostics || !Array.isArray(diagnostics.steps)) {
    return null;
  }

  return diagnostics;
}

export function getVodPlaybackDiagnosticsElapsedMs(
  diagnostics: VodPlaybackDiagnostics | null | undefined,
): number | null {
  if (!diagnostics) {
    return null;
  }
  const lastStep = diagnostics.steps[diagnostics.steps.length - 1];
  if (typeof lastStep?.elapsedMs === "number" && Number.isFinite(lastStep.elapsedMs)) {
    return lastStep.elapsedMs;
  }
  if (typeof diagnostics.startedAt === "number" && Number.isFinite(diagnostics.startedAt)) {
    return Math.max(0, Date.now() - diagnostics.startedAt);
  }
  return null;
}
