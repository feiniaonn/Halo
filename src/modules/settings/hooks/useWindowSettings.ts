import { useCallback, useEffect, useRef } from "react";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  setCloseBehavior,
  setLaunchAtLogin,
  setMiniModeSize,
  setMiniRestoreMode,
} from "@/modules/settings/services/settingsService";
import { SETTINGS_MESSAGES } from "@/modules/settings/constants";
import { reportRuntimeError } from "@/modules/shared/services/runtimeError";
import type { AppSettingsResponse, CloseBehavior, MiniRestoreMode } from "@/modules/settings/types/settings.types";

export function useWindowSettings({
  isTauri,
  settings,
  setSettings,
  formatErrorMessage,
  setStorageMessage,
  onMiniRestoreModeChange,
  onMiniModeSizeChange,
}: {
  isTauri: boolean;
  settings: AppSettingsResponse | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettingsResponse | null>>;
  formatErrorMessage: (error: unknown) => string;
  setStorageMessage: React.Dispatch<React.SetStateAction<string | null>>;
  onMiniRestoreModeChange?: (mode: MiniRestoreMode) => void;
  onMiniModeSizeChange?: (width: number, height: number) => void;
}) {
  const hasSyncedAutostart = useRef(false);

  useEffect(() => {
    const syncLaunchAtLogin = async () => {
      try {
        if (!settings || !isTauri || hasSyncedAutostart.current) return;
        const enabled = await isAutostartEnabled();
        if (enabled !== settings.launch_at_login) {
          await setLaunchAtLogin(enabled);
          setSettings((prev) => (prev ? { ...prev, launch_at_login: enabled } : prev));
        }
      } catch {
        // Ignore auto-sync mismatches and avoid noisy startup dialogs.
      } finally {
        hasSyncedAutostart.current = true;
      }
    };

    void syncLaunchAtLogin();
  }, [isTauri, setSettings, settings]);

  const handleLaunchAtLogin = useCallback(async (enabled: boolean) => {
    if (!settings) return;
    try {
      if (isTauri) {
        if (enabled) await enableAutostart();
        else await disableAutostart();
        const actual = await isAutostartEnabled();
        if (actual !== enabled) throw new Error("autostart mismatch");
      }
      await setLaunchAtLogin(enabled);
      setSettings((prev) => (prev ? { ...prev, launch_at_login: enabled } : prev));
    } catch (error) {
      reportRuntimeError({
        title: "Failed to update launch-at-login",
        summary: "Launch-at-login setting could not be updated.",
        error,
        source: "settings.window.launch-at-login",
      });
      console.error(error);
      setStorageMessage(`${SETTINGS_MESSAGES.launchAtLoginFailed}锛?{formatErrorMessage(error)}`);
    }
  }, [formatErrorMessage, isTauri, setSettings, setStorageMessage, settings]);

  const handleCloseBehavior = useCallback(async (behavior: CloseBehavior) => {
    if (!settings) return;
    try {
      await setCloseBehavior(behavior);
      setSettings((prev) => (prev ? { ...prev, close_behavior: behavior } : prev));
    } catch (error) {
      reportRuntimeError({
        title: "Failed to update close behavior",
        summary: "Window close behavior could not be updated.",
        error,
        source: "settings.window.close-behavior",
      });
      console.error(error);
      setStorageMessage(`${SETTINGS_MESSAGES.closeBehaviorFailed}锛?{formatErrorMessage(error)}`);
    }
  }, [formatErrorMessage, setSettings, setStorageMessage, settings]);

  const handleMiniRestoreMode = useCallback(async (mode: MiniRestoreMode) => {
    if (!settings || settings.mini_restore_mode === mode) return;
    try {
      await setMiniRestoreMode(mode);
      setSettings((prev) => (prev ? { ...prev, mini_restore_mode: mode } : prev));
      onMiniRestoreModeChange?.(mode);
    } catch (error) {
      reportRuntimeError({
        title: "Failed to update mini restore mode",
        summary: "Mini-window restore mode could not be updated.",
        error,
        source: "settings.window.mini-restore-mode",
      });
      console.error(error);
      setStorageMessage(`${SETTINGS_MESSAGES.miniRestoreModeFailed}锛?{formatErrorMessage(error)}`);
    }
  }, [formatErrorMessage, onMiniRestoreModeChange, setSettings, setStorageMessage, settings]);

  const handleMiniModeSize = useCallback(async (width: number, height: number) => {
    if (!settings) return;
    try {
      await setMiniModeSize(width, height);
      setSettings((prev) => (prev ? { ...prev, mini_mode_width: width, mini_mode_height: height } : prev));
      onMiniModeSizeChange?.(width, height);
    } catch (error) {
      reportRuntimeError({
        title: "Failed to update mini window size",
        summary: "Mini-window size could not be updated.",
        error,
        source: "settings.window.mini-size",
      });
      console.error(error);
      setStorageMessage(`璁剧疆杩蜂綘绐楀彛澶у皬澶辫触锛?{formatErrorMessage(error)}`);
    }
  }, [formatErrorMessage, setSettings, setStorageMessage, settings]);

  return {
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleMiniRestoreMode,
    handleMiniModeSize,
  };
}

