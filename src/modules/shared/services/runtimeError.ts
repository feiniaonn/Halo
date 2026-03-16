import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const HALO_RUNTIME_ERROR_EVENT = "halo:runtime-error";
const HALO_RUNTIME_ERROR_MARK = "__haloRuntimeErrorRecord";

export type RuntimeErrorRecord = {
  id: number;
  title: string;
  summary: string;
  detail: string;
  source: string;
  fatal: boolean;
  occurredAt: number;
};

export type RuntimeErrorInput = {
  title?: string;
  summary?: string;
  detail?: string;
  error?: unknown;
  source?: string;
  fatal?: boolean;
};

let runtimeErrorId = 1;

function nextRuntimeErrorId(): number {
  const value = runtimeErrorId;
  runtimeErrorId += 1;
  return value;
}

export function normalizeRuntimeErrorDetail(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message, error.stack].filter(Boolean);
    return parts.join("\n\n").trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  if (error === null || error === undefined) {
    return "";
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

export function summarizeRuntimeError(detail: string, fallback = "Unexpected runtime error"): string {
  const firstLine = detail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const summary = firstLine || fallback;
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

export function createRuntimeErrorRecord(input: RuntimeErrorInput): RuntimeErrorRecord {
  const rawDetail = [input.detail?.trim() ?? "", normalizeRuntimeErrorDetail(input.error)]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const detail = rawDetail || "Unknown runtime error";
  return {
    id: nextRuntimeErrorId(),
    title: input.title?.trim() || "Runtime Error",
    summary: input.summary?.trim() || summarizeRuntimeError(detail),
    detail,
    source: input.source?.trim() || "unknown",
    fatal: Boolean(input.fatal),
    occurredAt: Date.now(),
  };
}

export function isRuntimeErrorRecord(value: unknown): value is RuntimeErrorRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<RuntimeErrorRecord>;
  return typeof record.title === "string"
    && typeof record.summary === "string"
    && typeof record.detail === "string"
    && typeof record.source === "string"
    && typeof record.occurredAt === "number";
}

export function extractRuntimeErrorRecord(value: unknown): RuntimeErrorRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = (value as Record<string, unknown>)[HALO_RUNTIME_ERROR_MARK];
  return isRuntimeErrorRecord(record) ? record : null;
}

export function getRuntimeErrorFingerprint(record: RuntimeErrorRecord): string {
  return [
    record.title.trim().toLowerCase(),
    record.summary.trim().toLowerCase(),
    record.source.trim().toLowerCase(),
    record.fatal ? "fatal" : "recoverable",
  ].join("::");
}

export function reportRuntimeError(input: RuntimeErrorInput): RuntimeErrorRecord {
  const record = createRuntimeErrorRecord(input);
  if (input.error && typeof input.error === "object") {
    try {
      Object.defineProperty(input.error, HALO_RUNTIME_ERROR_MARK, {
        value: record,
        configurable: true,
      });
    } catch {
      // Ignore mark failures on non-extensible error objects.
    }
  }
  window.dispatchEvent(new CustomEvent<RuntimeErrorRecord>(HALO_RUNTIME_ERROR_EVENT, {
    detail: record,
  }));
  return record;
}

export async function copyRuntimeErrorText(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the legacy copy path.
    }
  }
  if (typeof document === "undefined") {
    return false;
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export async function closeCurrentRuntimeWindow(): Promise<void> {
  if (!isTauri()) {
    window.close();
    return;
  }
  const win = getCurrentWindow();
  await win.close().catch(async () => {
    await win.hide().catch(() => void 0);
    await win.destroy().catch(() => void 0);
  });
}

export function reloadCurrentRuntimeWindow(): void {
  window.location.reload();
}
