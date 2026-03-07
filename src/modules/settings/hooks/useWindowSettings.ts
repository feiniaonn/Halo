import { useCallback, useEffect, useRef } from "react";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { setCloseBehavior, setLaunchAtLogin, setMiniRestoreMode } from "@/modules/settings/services/settingsService";
import type { CloseBehavior, MiniRestoreMode } from "@/modules/settings/types/settings.types";
import type { AppSettingsResponse } from "@/modules/settings/types/settings.types";
import { SETTINGS_MESSAGES } from "@/modules/settings/constants";

export function useWindowSettings({
  isTauri,
  settings,
  setSettings,
  formatErrorMessage,
  setStorageMessage,
  onMiniRestoreModeChange,
}: {
  isTauri: boolean;
  settings: AppSettingsResponse | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettingsResponse | null>>;
  formatErrorMessage: (error: unknown) => string;
  setStorageMessage: React.Dispatch<React.SetStateAction<string | null>>;
  onMiniRestoreModeChange?: (mode: MiniRestoreMode) => void;
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
        hasSyncedAutostart.current = true;
      } catch {
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
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.launchAtLoginFailed}：${formatErrorMessage(e)}`);
    }
  }, [formatErrorMessage, isTauri, setSettings, setStorageMessage, settings]);

  const handleCloseBehavior = useCallback(async (behavior: CloseBehavior) => {
    if (!settings) return;
    try {
      await setCloseBehavior(behavior);
      setSettings((prev) => (prev ? { ...prev, close_behavior: behavior } : prev));
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.closeBehaviorFailed}：${formatErrorMessage(e)}`);
    }
  }, [formatErrorMessage, setSettings, setStorageMessage, settings]);

  const handleMiniRestoreMode = useCallback(async (mode: MiniRestoreMode) => {
    if (!settings || settings.mini_restore_mode === mode) return;
    try {
      await setMiniRestoreMode(mode);
      setSettings((prev) => (prev ? { ...prev, mini_restore_mode: mode } : prev));
      onMiniRestoreModeChange?.(mode);
    } catch (e) {
      console.error(e);
      setStorageMessage(`${SETTINGS_MESSAGES.miniRestoreModeFailed}：${formatErrorMessage(e)}`);
    }
  }, [formatErrorMessage, onMiniRestoreModeChange, setSettings, setStorageMessage, settings]);

  return {
    handleLaunchAtLogin,
    handleCloseBehavior,
    handleMiniRestoreMode,
  };
}
