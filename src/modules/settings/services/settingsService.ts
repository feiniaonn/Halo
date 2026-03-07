import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettingsResponse,
  CloseBehavior,
  MigrationCompletePayload,
  MigrationProgress,
  MiniRestoreMode,
} from "../types/settings.types";

function shouldRetryWithLegacyArgs(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("missing required key")
    || lower.includes("invalid args")
    || lower.includes("invalid type")
    || lower.includes("unknown field")
  );
}

export async function getAppSettings(): Promise<AppSettingsResponse> {
  return invoke<AppSettingsResponse>("get_app_settings");
}

export async function setStorageRoot(path: string | null): Promise<void> {
  return invoke("set_storage_root", { path });
}

export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  return invoke("set_launch_at_login", { enabled });
}

export async function setCloseBehavior(behavior: CloseBehavior): Promise<void> {
  return invoke("set_close_behavior", { behavior });
}

export async function getCloseBehavior(): Promise<string> {
  return invoke<string>("get_close_behavior");
}

export async function setMiniRestoreMode(mode: MiniRestoreMode): Promise<void> {
  return invoke("set_mini_restore_mode", { mode });
}

export async function setAllowComponentDownload(enabled: boolean): Promise<void> {
  return invoke("set_allow_component_download", { enabled });
}

export async function prepareVideoOptimizer(): Promise<boolean> {
  return invoke<boolean>("prepare_video_optimizer");
}

export async function setBackground(
  backgroundType: "none" | "image" | "video",
  backgroundPath: string | null,
): Promise<void> {
  try {
    await invoke("set_background", {
      backgroundType,
      backgroundPath,
    });
  } catch (error) {
    if (!shouldRetryWithLegacyArgs(error)) throw error;
    // Backward compatibility: older backend may expect snake_case keys.
    await invoke("set_background", {
      background_type: backgroundType,
      background_path: backgroundPath,
    });
  }
}

export async function setBackgroundBlur(blur: number): Promise<void> {
  return invoke("set_background_blur", { blur });
}

export async function importBackgroundAsset(
  filePath: string,
  kind: "image" | "video",
): Promise<string> {
  try {
    return await invoke<string>("import_background_asset", {
      args: { filePath, kind },
    });
  } catch (error) {
    if (!shouldRetryWithLegacyArgs(error)) throw error;
    // Backward compatibility: older backend may expect flat keys.
    return invoke<string>("import_background_asset", {
      filePath,
      kind,
    });
  }
}

export async function migrateLegacyData(removeSource: boolean): Promise<void> {
  return invoke("migrate_legacy_data", { removeSource });
}

export async function startMigrateLegacyData(removeSource: boolean): Promise<void> {
  return invoke("start_migrate_legacy_data", { removeSource });
}

export async function cancelMigrateLegacyData(): Promise<void> {
  return invoke("cancel_migrate_legacy_data");
}

export async function getMigrationProgress(): Promise<MigrationProgress> {
  return invoke<MigrationProgress>("get_migration_progress");
}

export type { MigrationCompletePayload, MigrationProgress };
