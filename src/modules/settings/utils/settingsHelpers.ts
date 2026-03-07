import type { AppSettingsResponse } from "../types/settings.types";

export type BackgroundType = "none" | "image" | "video";

export function formatSettingsError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "未知错误";
  }
}

export function normalizeBackgroundType(value: unknown): BackgroundType {
  if (value === "image" || value === "video" || value === "none") return value;
  return "none";
}

export function pickStoredBackgroundPath(
  settings: AppSettingsResponse | null,
  type: Extract<BackgroundType, "image" | "video">,
): string | null {
  if (!settings) return null;
  if (type === "image") return settings.background_image_path ?? null;
  return settings.background_video_path ?? null;
}
