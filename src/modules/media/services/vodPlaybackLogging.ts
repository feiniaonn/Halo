import {
  getVodPlaybackDiagnosticsElapsedMs,
  getVodPlaybackDiagnostics,
  type VodPlaybackDiagnostics,
  type VodResolvedStream,
} from "@/modules/media/services/vodPlayback";

export function summarizePlaybackHeaderKeys(headers: Record<string, string> | null): string {
  const keys = Object.keys(headers ?? {}).map((key) => key.trim()).filter(Boolean).sort();
  return keys.length > 0 ? keys.join(",") : "none";
}

function formatPlaybackDiagnostics(diagnostics: VodPlaybackDiagnostics | null): string {
  if (!diagnostics || diagnostics.steps.length === 0) {
    return "none";
  }
  return diagnostics.steps
    .map((step) => {
      const elapsed = typeof step.elapsedMs === "number" ? `@${step.elapsedMs}ms` : "";
      const budget = typeof step.budgetMs === "number" ? `/b${step.budgetMs}` : "";
      return `${step.stage}:${step.status}${elapsed}${budget}:${step.detail.replace(/\s+/g, "_")}`;
    })
    .join("|");
}

export function buildPlaybackResolutionLog(input: {
  routeName: string;
  episodeName: string;
  stream: VodResolvedStream;
  finalUrl: string;
  streamKind: string;
  kernelPlan: string[];
}): string {
  const diagnostics = getVodPlaybackDiagnostics(input.stream);
  const elapsedMs = getVodPlaybackDiagnosticsElapsedMs(diagnostics);
  return [
    `[VodPlayer] playback_resolve`,
    `route=${input.routeName}`,
    `episode=${input.episodeName}`,
    `resolved_by=${input.stream.resolvedBy}`,
    `final_url=${input.finalUrl}`,
    `header_keys=${summarizePlaybackHeaderKeys(input.stream.headers)}`,
    `stream_kind=${input.streamKind}`,
    `kernel_plan=[${input.kernelPlan.join(",")}]`,
    `elapsed_ms=${elapsedMs ?? "na"}`,
    `diagnostics=${formatPlaybackDiagnostics(diagnostics)}`,
  ].join(" ");
}

export function buildPlaybackResolutionFailureLog(input: {
  routeName: string;
  episodeName: string;
  reason: string;
  diagnostics?: VodPlaybackDiagnostics | null;
}): string {
  const diagnostics = input.diagnostics ?? null;
  const elapsedMs = getVodPlaybackDiagnosticsElapsedMs(diagnostics);
  return [
    `[VodPlayer] playback_resolve_failed`,
    `route=${input.routeName}`,
    `episode=${input.episodeName}`,
    `reason=${input.reason}`,
    `elapsed_ms=${elapsedMs ?? "na"}`,
    `diagnostics=${formatPlaybackDiagnostics(diagnostics)}`,
  ].join(" ");
}
