import { invoke } from "@tauri-apps/api/core";

import { sanitizeMediaUrlCandidate } from "./vodPlaybackPayloadUtils";

export type VodStreamKind = "hls" | "flv" | "mp4" | "dash" | "mpegts" | "unknown";

const STREAM_PROBE_CACHE_TTL_MS = 30 * 1000;
const STREAM_PROBE_DEFAULT_TIMEOUT_MS = 3500;

export interface VodStreamProbeResult {
  kind: VodStreamKind;
  reason: string | null;
  contentType: string | null;
  finalUrl: string | null;
  probed: boolean;
}

export interface VodStreamProbeOptions {
  timeoutMs?: number;
}

interface RawVodStreamProbeResult {
  kind?: string;
  reason?: string | null;
  content_type?: string | null;
  final_url?: string | null;
}

const streamProbeCache = new Map<
  string,
  {
    result: VodStreamProbeResult;
    expiresAt: number;
  }
>();
const inflightStreamProbeCache = new Map<string, Promise<VodStreamProbeResult>>();

function normalizeProbeHeaders(
  headers: Record<string, string> | null,
): Record<string, string> | null {
  if (!headers) {
    return null;
  }
  const normalizedEntries = Object.entries(headers)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => !!key)
    .sort(([left], [right]) => left.localeCompare(right));
  return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : null;
}

function buildStreamProbeCacheKey(url: string, headers: Record<string, string> | null): string {
  return JSON.stringify([url.trim(), normalizeProbeHeaders(headers)]);
}

function cloneProbeResult(result: VodStreamProbeResult): VodStreamProbeResult {
  return { ...result };
}

export function inferVodStreamKind(url: string): VodStreamKind {
  const lower = url.trim().toLowerCase();
  if (lower.includes(".m3u8") || lower.includes("m3u8")) return "hls";
  if (lower.includes(".mpd") || lower.includes("mpd")) return "dash";
  if (lower.includes(".flv") || lower.includes("flv")) return "flv";
  if (lower.includes(".ts") || lower.includes(".m2ts") || lower.includes("mpegts")) return "mpegts";
  if (lower.includes(".mp4") || lower.includes("mp4")) return "mp4";
  return "unknown";
}

export async function probeVodStream(
  url: string,
  headers: Record<string, string> | null,
  options?: VodStreamProbeOptions,
): Promise<VodStreamProbeResult> {
  const normalizedUrl = sanitizeMediaUrlCandidate(url) || url.trim();
  const normalizedHeaders = normalizeProbeHeaders(headers);
  const inferred = inferVodStreamKind(normalizedUrl);
  if (inferred !== "unknown" && inferred !== "hls") {
    return {
      kind: inferred,
      reason: null,
      contentType: null,
      finalUrl: normalizedUrl,
      probed: false,
    };
  }

  const cacheKey = buildStreamProbeCacheKey(normalizedUrl, normalizedHeaders);
  const cached = streamProbeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneProbeResult(cached.result);
  }

  const timeoutMs = Math.max(800, options?.timeoutMs ?? STREAM_PROBE_DEFAULT_TIMEOUT_MS);
  const inflightKey = `${cacheKey}|${timeoutMs}`;
  const existing = inflightStreamProbeCache.get(inflightKey);
  if (existing) {
    return existing.then(cloneProbeResult);
  }

  const pending = invoke<RawVodStreamProbeResult>("probe_stream_kind", {
    url: normalizedUrl,
    headers: normalizedHeaders,
    timeoutMs,
  }).then((result) => {
    const nextKind =
      result.kind === "hls" ||
      result.kind === "flv" ||
      result.kind === "mp4" ||
      result.kind === "dash" ||
      result.kind === "mpegts"
      ? result.kind
      : "unknown";

    const normalizedResult: VodStreamProbeResult = {
      kind: nextKind,
      reason: result.reason ?? null,
      contentType: result.content_type ?? null,
      finalUrl:
        sanitizeMediaUrlCandidate(result.final_url)
        || (typeof result.final_url === "string" ? result.final_url.trim() : "")
        || normalizedUrl,
      probed: true,
    };
    streamProbeCache.set(cacheKey, {
      result: normalizedResult,
      expiresAt: Date.now() + STREAM_PROBE_CACHE_TTL_MS,
    });
    return normalizedResult;
  }).finally(() => {
    inflightStreamProbeCache.delete(inflightKey);
  });

  inflightStreamProbeCache.set(inflightKey, pending);
  const result = await pending;
  const nextKind =
    result.kind === "hls" ||
    result.kind === "flv" ||
    result.kind === "mp4" ||
    result.kind === "dash" ||
    result.kind === "mpegts"
      ? result.kind
      : "unknown";

  return {
    ...result,
    kind: nextKind,
  };
}
