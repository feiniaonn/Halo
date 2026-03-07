import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useUpdater } from "@/modules/updater/hooks/useUpdater";
import {
  getAppSettings,
  setStorageRoot,
} from "@/modules/settings/services/settingsService";
import { SETTINGS_MESSAGES } from "@/modules/settings/constants";
import { useBackgroundSettings } from "./useBackgroundSettings";
import { useMigrationSettings } from "./useMigrationSettings";
import { useWindowSettings } from "./useWindowSettings";
import type { AppSettingsResponse, MiniRestoreMode } from "@/modules/settings/types/settings.types";
import { formatSettingsError, normalizeBackgroundType } from "@/modules/settings/utils";

export function useSettingsPageController({
  bgType,
  bgFsPath,
  bgBlur,
  onBgChange,
  onBgBlurChange,
  onMiniRestoreModeChange,
}: {
  bgType: "none" | "image" | "video";
  bgFsPath?: string | null;
  bgBlur: number;
  onBgChange?: (type: "none" | "image" | "video", path: string | null) => void;
  onBgBlurChange?: (blur: number) => void;
  onMiniRestoreModeChange?: (mode: MiniRestoreMode) => void;
}) {
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const updater = useUpdater();
  const [settings, setSettings] = useState<AppSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    try {
      const data = await getAppSettings();
      setSettings(data);
    } catch (error) {
      setStorageMessage(`设置加载失败：${formatSettingsError(error)}`);
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  useEffect(() => {
    void load();
  }, [load]);

  const {
    bgNotice,
    setBgNotice,
    bgOptimizeHint,
    bgOptimizeStage,
    imagePreviewSrc,
    videoPreviewSrc,
    handleBackgroundBlurChange,
    handleAllowComponentDownload,
    handlePrepareVideoOptimizer,
    handleClearBackground,
    handleApplyStoredBackground,
    handleChooseBackground,
  } = useBackgroundSettings({
    isTauri,
    settings,
    setSettings,
    bgType,
    bgFsPath,
    bgBlur,
    onBgChange,
    onBgBlurChange,
    setStorageMessage,
  });

  const {
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleMiniRestoreMode,
  } = useWindowSettings({
    isTauri,
    settings,
    setSettings,
    formatErrorMessage: formatSettingsError,
    setStorageMessage,
    onMiniRestoreModeChange,
  });

  const {
    isMigrating,
    removeSource,
    setRemoveSource,
    migrationProgress,
    migrationComplete,
    migrationRemoveSource,
    legacyRoots,
    hasLegacy,
    migrationRunning,
    handleStartMigration,
    handleCancelMigration,
    handleMigrateNow,
  } = useMigrationSettings({
    isTauri,
    settings,
    load,
    formatErrorMessage: formatSettingsError,
    setStorageMessage,
  });

  const handleChooseFolder = useCallback(async () => {
    if (!isTauri) {
      setStorageMessage(SETTINGS_MESSAGES.desktopOnly);
      return;
    }
    try {
      const selected = await open({ directory: true, multiple: false });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path || typeof path !== "string") return;
      await setStorageRoot(path);
      await load();
      setStorageMessage(SETTINGS_MESSAGES.storage.switched);
    } catch (error) {
      setStorageMessage(`${SETTINGS_MESSAGES.storage.switchFailed}：${formatSettingsError(error)}`);
    }
  }, [isTauri, load]);

  const handleRestoreDefaultStorage = useCallback(async () => {
    if (!isTauri) {
      setStorageMessage(SETTINGS_MESSAGES.desktopOnly);
      return;
    }
    try {
      await setStorageRoot(null);
      await load();
      setStorageMessage(SETTINGS_MESSAGES.storage.restored);
    } catch (error) {
      setStorageMessage(`${SETTINGS_MESSAGES.storage.restoreFailed}：${formatSettingsError(error)}`);
    }
  }, [isTauri, load]);

  const handleApplyStoredBackgroundTyped = useCallback(async (type: "image" | "video") => {
    await Promise.resolve(handleApplyStoredBackground(type));
  }, [handleApplyStoredBackground]);

  const normalizedBgType = normalizeBackgroundType(bgType);

  return {
    updater,
    settings,
    loading,
    bgNotice,
    setBgNotice,
    storageMessage,
    setStorageMessage,
    bgOptimizeHint,
    bgOptimizeStage,
    legacyRoots,
    hasLegacy,
    migrationRunning,
    imagePreviewSrc,
    videoPreviewSrc,
    migrationProgress,
    migrationComplete,
    migrationRemoveSource,
    removeSource,
    setRemoveSource,
    isMigrating,
    normalizedBgType,
    handleAllowComponentDownload,
    handlePrepareVideoOptimizer,
    handleBackgroundBlurChange,
    handleClearBackground,
    handleApplyStoredBackground: handleApplyStoredBackgroundTyped,
    handleChooseBackground,
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleMiniRestoreMode,
    handleChooseFolder,
    handleRestoreDefaultStorage,
    handleStartMigration,
    handleCancelMigration,
    handleMigrateNow,
  };
}
