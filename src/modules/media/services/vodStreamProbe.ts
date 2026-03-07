import { invoke } from "@tauri-apps/api/core";

export type VodStreamKind = "hls" | "flv" | "mp4" | "unknown";

export interface VodStreamProbeResult {
  kind: VodStreamKind;
  reason: string | null;
  contentType: string | null;
  finalUrl: string | null;
  probed: boolean;
}

interface RawVodStreamProbeResult {
  kind?: string;
  reason?: string | null;
  content_type?: string | null;
  final_url?: string | null;
}

export function inferVodStreamKind(url: string): VodStreamKind {
  const lower = url.trim().toLowerCase();
  if (lower.includes(".m3u8")) return "hls";
  if (lower.includes(".flv")) return "flv";
  if (lower.includes(".mp4")) return "mp4";
  return "unknown";
}

export async function probeVodStream(
  url: string,
  headers: Record<string, string> | null,
): Promise<VodStreamProbeResult> {
  const inferred = inferVodStreamKind(url);
  if (inferred !== "unknown") {
    return {
      kind: inferred,
      reason: null,
      contentType: null,
      finalUrl: url,
      probed: false,
    };
  }

  const result = await invoke<RawVodStreamProbeResult>("probe_stream_kind", { url, headers });
  const nextKind = result.kind === "hls" || result.kind === "flv" || result.kind === "mp4"
    ? result.kind
    : "unknown";

  return {
    kind: nextKind,
    reason: result.reason ?? null,
    contentType: result.content_type ?? null,
    finalUrl: result.final_url ?? url,
    probed: true,
  };
}
