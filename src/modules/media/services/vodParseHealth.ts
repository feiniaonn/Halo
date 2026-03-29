import { invoke } from "@tauri-apps/api/core";

export type VodParseFailureKind = "timeout" | "upstream" | "payload" | "runtime" | "validation";
export type VodParseHealthState = "healthy" | "cooldown" | "quarantined";

export interface VodParseHealthRecord {
  parseUrl: string;
  successCount: number;
  failureCount: number;
  lastStatus: string;
  lastFailureKind?: VodParseFailureKind | null;
  lastUsedAt: number;
  lastDurationMs: number;
  avgDurationMs: number;
  consecutiveHardFailures: number;
  consecutiveSoftFailures: number;
  quarantineUntil: number;
}

export interface VodParseHealthSnapshot {
  state: VodParseHealthState;
  ageMs: number;
  freshness: number;
  successSignal: number;
  failureSignal: number;
  effectiveHardFailures: number;
  effectiveSoftFailures: number;
  stabilityScore: number;
}

export const VOD_PARSE_QUARANTINE_WINDOW_MS = 20 * 60 * 1000;
export const VOD_PARSE_FAILURE_DECAY_WINDOW_MS = 30 * 60 * 1000;
export const VOD_PARSE_SIGNAL_HALF_LIFE_MS = 6 * 60 * 60 * 1000;
const VOD_PARSE_HARD_FAILURE_QUARANTINE_THRESHOLD = 2;
const VOD_PARSE_SOFT_FAILURE_QUARANTINE_THRESHOLD = 3;

function normalizeRepoUrl(repoUrl?: string): string {
  return repoUrl?.trim() ?? "";
}

function normalizeDurationMs(durationMs: number | undefined): number {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) {
    return 0;
  }
  return Math.max(0, Math.round(durationMs));
}

function computeNextAverageDuration(
  previous: VodParseHealthRecord | null | undefined,
  nextDurationMs: number,
): number {
  if (nextDurationMs <= 0) {
    return Math.max(0, previous?.avgDurationMs ?? 0);
  }
  const attemptCount = Math.max(0, (previous?.successCount ?? 0) + (previous?.failureCount ?? 0));
  if (attemptCount <= 0) {
    return nextDurationMs;
  }
  const weightedTotal = Math.max(0, previous?.avgDurationMs ?? 0) * attemptCount + nextDurationMs;
  return Math.round(weightedTotal / (attemptCount + 1));
}

function computeDecayedFailureSignal(
  value: number | undefined,
  ageMs: number,
): number {
  const normalizedValue = Math.max(0, Number(value ?? 0));
  if (normalizedValue <= 0 || ageMs <= 0) {
    return normalizedValue;
  }
  return Math.max(0, normalizedValue - ageMs / VOD_PARSE_FAILURE_DECAY_WINDOW_MS);
}

function computeFreshness(ageMs: number): number {
  if (ageMs <= 0) {
    return 1;
  }
  return Math.exp((-Math.LN2 * ageMs) / VOD_PARSE_SIGNAL_HALF_LIFE_MS);
}

export function getVodParseHealthSnapshot(
  record: VodParseHealthRecord | null | undefined,
  now = Date.now(),
): VodParseHealthSnapshot {
  if (!record) {
    return {
      state: "healthy",
      ageMs: 0,
      freshness: 0,
      successSignal: 0,
      failureSignal: 0,
      effectiveHardFailures: 0,
      effectiveSoftFailures: 0,
      stabilityScore: 0,
    };
  }

  const ageMs = Math.max(0, now - Math.max(0, record.lastUsedAt ?? 0));
  const freshness = computeFreshness(ageMs);
  const effectiveHardFailures = computeDecayedFailureSignal(record.consecutiveHardFailures, ageMs);
  const effectiveSoftFailures = computeDecayedFailureSignal(record.consecutiveSoftFailures, ageMs);
  const successSignal = Math.max(0, Number(record.successCount ?? 0)) * freshness;
  const failureSignal = Math.max(0, Number(record.failureCount ?? 0)) * freshness;
  const state = (record.quarantineUntil ?? 0) > now
    ? "quarantined"
    : (effectiveHardFailures >= 0.35 || effectiveSoftFailures >= 0.35)
      ? "cooldown"
      : "healthy";

  return {
    state,
    ageMs,
    freshness,
    successSignal,
    failureSignal,
    effectiveHardFailures,
    effectiveSoftFailures,
    stabilityScore:
      successSignal
      - failureSignal * 1.35
      - effectiveHardFailures * 2.5
      - effectiveSoftFailures * 1.5,
  };
}

export function getVodParseHealthState(
  record: VodParseHealthRecord | null | undefined,
  now = Date.now(),
): VodParseHealthState {
  return getVodParseHealthSnapshot(record, now).state;
}

export function classifyVodParseFailure(
  message: string,
  options?: {
    validationReason?: string | null;
  },
): VodParseFailureKind {
  const validationReason = options?.validationReason?.trim().toLowerCase() ?? "";
  if (validationReason) {
    return "validation";
  }

  const normalizedMessage = message.trim().toLowerCase();
  if (!normalizedMessage) {
    return "runtime";
  }

  if (
    normalizedMessage.includes("stream_probe_hls_geo_blocked")
    || normalizedMessage.includes("stream_probe_hls_html_blocked")
  ) {
    return "upstream";
  }
  if (/stream_probe_|not directly playable|解析页|真正的视频地址|fake hls|audio_only/.test(normalizedMessage)) {
    return "validation";
  }
  if (/timeout|timed out|超时|deadline exceeded|aborted/.test(normalizedMessage)) {
    return "timeout";
  }
  if (/payload|schema|json|response shape|malformed/.test(normalizedMessage)) {
    return "payload";
  }
  if (/forbidden|http\s+[45]\d{2}|connection|proxy|ssl|upstream|network/.test(normalizedMessage)) {
    return "upstream";
  }
  return "runtime";
}

export function computeVodParseFailureUpdate(
  previous: VodParseHealthRecord | null | undefined,
  failureKind: VodParseFailureKind,
  durationMs: number | undefined,
  now = Date.now(),
): {
  nextStat: VodParseHealthRecord;
  hardFailure: boolean;
  softFailure: boolean;
  quarantineUntil: number;
} {
  const normalizedPrevious = previous ?? null;
  const normalizedDurationMs = normalizeDurationMs(durationMs);
  const hardFailure = failureKind === "payload" || failureKind === "runtime" || failureKind === "validation";
  const softFailure = failureKind === "timeout" || failureKind === "upstream";
  const consecutiveHardFailures = hardFailure
    ? (normalizedPrevious?.consecutiveHardFailures ?? 0) + 1
    : 0;
  const consecutiveSoftFailures = softFailure
    ? (normalizedPrevious?.consecutiveSoftFailures ?? 0) + 1
    : 0;
  const quarantineUntil = (
    (hardFailure && consecutiveHardFailures >= VOD_PARSE_HARD_FAILURE_QUARANTINE_THRESHOLD)
    || (softFailure && consecutiveSoftFailures >= VOD_PARSE_SOFT_FAILURE_QUARANTINE_THRESHOLD)
  )
    ? now + VOD_PARSE_QUARANTINE_WINDOW_MS
    : Math.max(normalizedPrevious?.quarantineUntil ?? 0, 0);

  return {
    nextStat: {
      parseUrl: normalizedPrevious?.parseUrl ?? "",
      successCount: normalizedPrevious?.successCount ?? 0,
      failureCount: (normalizedPrevious?.failureCount ?? 0) + 1,
      lastStatus: `failed:${failureKind}`,
      lastFailureKind: failureKind,
      lastUsedAt: now,
      lastDurationMs: normalizedDurationMs,
      avgDurationMs: computeNextAverageDuration(normalizedPrevious, normalizedDurationMs),
      consecutiveHardFailures,
      consecutiveSoftFailures,
      quarantineUntil,
    },
    hardFailure,
    softFailure,
    quarantineUntil,
  };
}

export function mergeVodParseHealthSuccess(
  records: VodParseHealthRecord[],
  parseUrl: string,
  durationMs: number | undefined,
  now = Date.now(),
): VodParseHealthRecord[] {
  const normalizedParseUrl = parseUrl.trim();
  if (!normalizedParseUrl) {
    return records;
  }

  const normalizedDurationMs = normalizeDurationMs(durationMs);
  const next = records.slice();
  const index = next.findIndex((record) => record.parseUrl === normalizedParseUrl);
  const previous = index >= 0 ? next[index] : null;
  const updated: VodParseHealthRecord = {
    parseUrl: normalizedParseUrl,
    successCount: (previous?.successCount ?? 0) + 1,
    failureCount: previous?.failureCount ?? 0,
    lastStatus: "success",
    lastFailureKind: null,
    lastUsedAt: now,
    lastDurationMs: normalizedDurationMs,
    avgDurationMs: computeNextAverageDuration(previous, normalizedDurationMs),
    consecutiveHardFailures: 0,
    consecutiveSoftFailures: 0,
    quarantineUntil: 0,
  };
  if (index >= 0) {
    next[index] = updated;
  } else {
    next.push(updated);
  }
  return next;
}

export function mergeVodParseHealthFailure(
  records: VodParseHealthRecord[],
  parseUrl: string,
  failureKind: VodParseFailureKind,
  durationMs: number | undefined,
  now = Date.now(),
): VodParseHealthRecord[] {
  const normalizedParseUrl = parseUrl.trim();
  if (!normalizedParseUrl) {
    return records;
  }

  const next = records.slice();
  const index = next.findIndex((record) => record.parseUrl === normalizedParseUrl);
  const previous = index >= 0 ? next[index] : null;
  const { nextStat } = computeVodParseFailureUpdate(
    previous
      ? {
        ...previous,
        parseUrl: normalizedParseUrl,
      }
      : {
        parseUrl: normalizedParseUrl,
        successCount: 0,
        failureCount: 0,
        lastStatus: "",
        lastFailureKind: null,
        lastUsedAt: 0,
        lastDurationMs: 0,
        avgDurationMs: 0,
        consecutiveHardFailures: 0,
        consecutiveSoftFailures: 0,
        quarantineUntil: 0,
      },
    failureKind,
    durationMs,
    now,
  );

  if (index >= 0) {
    next[index] = nextStat;
  } else {
    next.push(nextStat);
  }
  return next;
}

export async function listVodParseHealthRecords(
  source: string | undefined,
  repoUrl: string | undefined,
  siteKey: string,
  apiClass: string,
  routeName: string,
): Promise<VodParseHealthRecord[]> {
  const normalizedSource = source?.trim() ?? "";
  const normalizedSiteKey = siteKey.trim();
  if (!normalizedSource || !normalizedSiteKey) {
    return [];
  }

  const records = await invoke<Array<{
    parse_url: string;
    success_count: number;
    failure_count: number;
    last_status: string;
    last_failure_kind?: VodParseFailureKind | null;
    last_used_at: number;
    last_duration_ms: number;
    avg_duration_ms: number;
    consecutive_hard_failures: number;
    consecutive_soft_failures: number;
    quarantine_until: number;
  }>>("list_vod_parse_health_records", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
    apiClass: apiClass.trim(),
    routeName: routeName.trim(),
    limit: 12,
  });

  return records
    .map((record) => ({
      parseUrl: String(record.parse_url ?? "").trim(),
      successCount: Number(record.success_count ?? 0),
      failureCount: Number(record.failure_count ?? 0),
      lastStatus: String(record.last_status ?? ""),
      lastFailureKind: record.last_failure_kind ?? null,
      lastUsedAt: Number(record.last_used_at ?? 0),
      lastDurationMs: Number(record.last_duration_ms ?? 0),
      avgDurationMs: Number(record.avg_duration_ms ?? 0),
      consecutiveHardFailures: Number(record.consecutive_hard_failures ?? 0),
      consecutiveSoftFailures: Number(record.consecutive_soft_failures ?? 0),
      quarantineUntil: Number(record.quarantine_until ?? 0),
    }))
    .filter((record) => !!record.parseUrl);
}

export async function recordVodParseHealthSuccess(
  source: string | undefined,
  repoUrl: string | undefined,
  siteKey: string,
  apiClass: string,
  routeName: string,
  parseUrl: string,
  durationMs: number | undefined,
): Promise<void> {
  const normalizedSource = source?.trim() ?? "";
  const normalizedSiteKey = siteKey.trim();
  const normalizedParseUrl = parseUrl.trim();
  if (!normalizedSource || !normalizedSiteKey || !normalizedParseUrl) {
    return;
  }

  await invoke("record_vod_parse_health_success", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
    apiClass: apiClass.trim(),
    routeName: routeName.trim(),
    parseUrl: normalizedParseUrl,
    durationMs: normalizeDurationMs(durationMs),
  });
}

export async function recordVodParseHealthFailure(
  source: string | undefined,
  repoUrl: string | undefined,
  siteKey: string,
  apiClass: string,
  routeName: string,
  parseUrl: string,
  failureKind: VodParseFailureKind,
  durationMs: number | undefined,
  previous: VodParseHealthRecord | null | undefined,
  now = Date.now(),
): Promise<VodParseHealthRecord> {
  const normalizedSource = source?.trim() ?? "";
  const normalizedSiteKey = siteKey.trim();
  const normalizedParseUrl = parseUrl.trim();
  const { nextStat, hardFailure, softFailure, quarantineUntil } = computeVodParseFailureUpdate(
    previous,
    failureKind,
    durationMs,
    now,
  );
  if (!normalizedSource || !normalizedSiteKey || !normalizedParseUrl) {
    return {
      ...nextStat,
      parseUrl: normalizedParseUrl,
    };
  }

  await invoke("record_vod_parse_health_failure", {
    source: normalizedSource,
    repoUrl: normalizeRepoUrl(repoUrl) || null,
    siteKey: normalizedSiteKey,
    apiClass: apiClass.trim(),
    routeName: routeName.trim(),
    parseUrl: normalizedParseUrl,
    lastStatus: `failed:${failureKind}`,
    failureKind,
    durationMs: normalizeDurationMs(durationMs),
    hardFailure,
    softFailure,
    quarantineUntilMs: quarantineUntil,
  });

  return {
    ...nextStat,
    parseUrl: normalizedParseUrl,
  };
}
