import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  importBackgroundAsset,
  prepareVideoOptimizer,
  setAllowComponentDownload,
  setBackground,
  setBackgroundBlur,
} from "@/modules/settings/services/settingsService";
import { SETTINGS_MESSAGES } from "@/modules/settings/constants";
import type { AppSettingsResponse } from "@/modules/settings/types/settings.types";
import { formatSettingsError, pickStoredBackgroundPath } from "@/modules/settings/utils";

type BackgroundType = "none" | "image" | "video";

type BgNotice = {
  kind: "success" | "error";
  title: string;
  detail: string;
  fileName?: string;
  path?: string;
};

const MIN_BACKGROUND_BLUR = 0;
const MAX_BACKGROUND_BLUR = 36;

function normalizeBlur(blur: number): number {
  const clamped = Math.min(MAX_BACKGROUND_BLUR, Math.max(MIN_BACKGROUND_BLUR, blur));
  return Math.round(clamped * 10) / 10;
}

function toPreviewSrc(path: string | null, isTauri: boolean): string | null {
  if (!path) return null;
  if (!isTauri) return path;
  try {
    return convertFileSrc(path.replace(/\\/g, "/"));
  } catch {
    return null;
  }
}

export function useBackgroundSettings({
  isTauri,
  settings,
  setSettings,
  bgType,
  bgFsPath,
  bgBlur,
  onBgChange,
  onBgBlurChange,
  setStorageMessage,
}: {
  isTauri: boolean;
  settings: AppSettingsResponse | null;
  setSettings: Dispatch<SetStateAction<AppSettingsResponse | null>>;
  bgType: BackgroundType;
  bgFsPath: string | null | undefined;
  bgBlur: number;
  onBgChange?: (type: BackgroundType, path: string | null) => void;
  onBgBlurChange?: (blur: number) => void;
  setStorageMessage: Dispatch<SetStateAction<string | null>>;
}) {
  const [bgNotice, setBgNotice] = useState<BgNotice | null>(null);
  const [bgOptimizeHint, setBgOptimizeHint] = useState<string | null>(null);
  const [bgOptimizeStage, setBgOptimizeStage] = useState<string | null>(null);
  const blurCommitTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (blurCommitTimerRef.current !== null) {
      window.clearTimeout(blurCommitTimerRef.current);
    }
  }, []);

  const imagePreviewSrc = useMemo(() => {
    const active = bgType === "image" ? bgFsPath ?? null : null;
    const saved = pickStoredBackgroundPath(settings, "image");
    return toPreviewSrc(active ?? saved, isTauri);
  }, [bgFsPath, bgType, isTauri, settings]);

  const videoPreviewSrc = useMemo(() => {
    const active = bgType === "video" ? bgFsPath ?? null : null;
    const saved = pickStoredBackgroundPath(settings, "video");
    return toPreviewSrc(active ?? saved, isTauri);
  }, [bgFsPath, bgType, isTauri, settings]);

  const applyBackground = useCallback(async (type: BackgroundType, path: string | null) => {
    await setBackground(type, path);
    onBgChange?.(type, path);
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        background_type: type,
        background_path: path,
      };
    });
  }, [onBgChange, setSettings]);

  const handleAllowComponentDownload = useCallback(async (enabled: boolean) => {
    try {
      await setAllowComponentDownload(enabled);
      setSettings((prev) => (prev ? { ...prev, allow_component_download: enabled } : prev));
      setBgOptimizeHint(
        enabled
          ? SETTINGS_MESSAGES.background.optimizeHint.enabled
          : SETTINGS_MESSAGES.background.optimizeHint.disabled,
      );
    } catch (error) {
      setStorageMessage(`${SETTINGS_MESSAGES.background.optimizeHint.settingFailed}：${formatSettingsError(error)}`);
    }
  }, [setSettings, setStorageMessage]);

  const handlePrepareVideoOptimizer = useCallback(async () => {
    try {
      setBgOptimizeStage("download_start");
      const ok = await prepareVideoOptimizer();
      setBgOptimizeHint(ok ? "视频优化组件已就绪。" : SETTINGS_MESSAGES.background.optimizeHint.prepareFailed);
    } catch (error) {
      setBgOptimizeHint(`${SETTINGS_MESSAGES.background.optimizeHint.prepareFailed}：${formatSettingsError(error)}`);
    } finally {
      setBgOptimizeStage(null);
    }
  }, []);

  const handleBackgroundBlurChange = useCallback((nextBlur: number) => {
    const normalized = normalizeBlur(nextBlur);
    if (normalized === bgBlur) return;

    onBgBlurChange?.(normalized);
    setSettings((prev) => (prev ? { ...prev, background_blur: normalized } : prev));

    if (!isTauri) return;

    if (blurCommitTimerRef.current !== null) {
      window.clearTimeout(blurCommitTimerRef.current);
    }
    blurCommitTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          await setBackgroundBlur(normalized);
        } catch (error) {
          setStorageMessage(`${SETTINGS_MESSAGES.background.applyFailed}：${formatSettingsError(error)}`);
        }
      })();
    }, 180);
  }, [bgBlur, isTauri, onBgBlurChange, setSettings, setStorageMessage]);

  const handleClearBackground = useCallback(() => {
    void (async () => {
      try {
        await applyBackground("none", null);
        setStorageMessage(SETTINGS_MESSAGES.background.restoredDefault);
      } catch (error) {
        setStorageMessage(`${SETTINGS_MESSAGES.background.applyFailed}：${formatSettingsError(error)}`);
      }
    })();
  }, [applyBackground, setStorageMessage]);

  const handleApplyStoredBackground = useCallback((type: "image" | "video") => {
    void (async () => {
      const stored = pickStoredBackgroundPath(settings, type);
      if (!stored) {
        setStorageMessage(type === "image" ? SETTINGS_MESSAGES.background.notSavedYet.image : SETTINGS_MESSAGES.background.notSavedYet.video);
        return;
      }
      try {
        await applyBackground(type, stored);
        setStorageMessage(type === "image" ? SETTINGS_MESSAGES.background.switchedSaved.image : SETTINGS_MESSAGES.background.switchedSaved.video);
      } catch (error) {
        setStorageMessage(`${SETTINGS_MESSAGES.background.switchFailed}：${formatSettingsError(error)}`);
      }
    })();
  }, [applyBackground, setStorageMessage, settings]);

  const handleChooseBackground = useCallback((type: "image" | "video") => {
    void (async () => {
      if (!isTauri) {
        setStorageMessage(SETTINGS_MESSAGES.desktopOnly);
        return;
      }

      let selected: string | string[] | null = null;
      try {
        selected = await open({
          multiple: false,
          filters: type === "image"
            ? [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }]
            : [{ name: "Video", extensions: ["mp4", "m4v", "mov", "webm"] }],
        });
      } catch (error) {
        setStorageMessage(`${SETTINGS_MESSAGES.background.setupFailed}：${formatSettingsError(error)}`);
        return;
      }

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath || typeof filePath !== "string") return;

      try {
        const importedPath = await importBackgroundAsset(filePath, type);
        await applyBackground(type, importedPath);
        setSettings((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            background_type: type,
            background_path: importedPath,
            background_image_path: type === "image" ? importedPath : prev.background_image_path,
            background_video_path: type === "video" ? importedPath : prev.background_video_path,
          };
        });

        setBgNotice({
          kind: "success",
          title: "背景设置成功",
          detail: type === "image" ? "图片背景已应用" : "视频背景已应用",
          fileName: filePath.split(/[/\\]/).pop(),
          path: importedPath,
        });
      } catch (error) {
        setBgNotice({
          kind: "error",
          title: "背景设置失败",
          detail: formatSettingsError(error),
          fileName: filePath.split(/[/\\]/).pop(),
          path: filePath,
        });
        setStorageMessage(`${SETTINGS_MESSAGES.background.setupFailed}：${formatSettingsError(error)}`);
      }
    })();
  }, [applyBackground, isTauri, setSettings, setStorageMessage]);

  return {
    bgNotice,
    setBgNotice,
    bgOptimizeHint,
    bgOptimizeStage,
    imagePreviewSrc,
    videoPreviewSrc,
    handleAllowComponentDownload,
    handlePrepareVideoOptimizer,
    handleBackgroundBlurChange,
    handleClearBackground,
    handleApplyStoredBackground,
    handleChooseBackground,
  };
}
