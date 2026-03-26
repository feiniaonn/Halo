import {
  getVodPlaybackDiagnosticsElapsedMs,
  type VodPlaybackDiagnostics,
  type VodResolvedStream,
} from "@/modules/media/services/vodPlayback";

export function summarizePlaybackHeaderKeys(headers: Record<string, string> | null): string {
  const keys = Object.keys(headers ?? {}).map((key) => key.trim()).filter(Boolean).sort();
  return keys.length > 0 ? keys.join(",") : "none";
}

export function buildPlaybackResolutionLog(input: {
  routeName: string;
  episodeName: string;
  stream: VodResolvedStream;
  finalUrl: string;
  streamKind: string;
  kernelPlan: string[];
}): string {
  const elapsedMs = getVodPlaybackDiagnosticsElapsedMs(input.stream.diagnostics ?? null);
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
  ].join(" ");
}
