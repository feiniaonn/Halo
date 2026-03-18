import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { HomePage as HomePageStatic } from "@/pages/HomePage";
import { MediaPage as MediaPageStatic } from "@/pages/MediaPage";
import { MiniPlayerPage as MiniPlayerPageStatic } from "@/pages/MiniPlayerPage";
import { MusicPage as MusicPageStatic } from "@/pages/MusicPage";
import { SettingsPage as SettingsPageStatic } from "@/pages/SettingsPage";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { EVENT_SETTINGS_BG_VIDEO_OPTIMIZED, EVENT_WINDOW_FORCE_MINI_MODE } from "@/modules/shared/services/events";
import { getAppSettings, importBackgroundAsset, setBackground } from "@/modules/settings/services/settingsService";
import { initializeMusicHotkeyManager } from "@/modules/music/services/musicHotkeyManager";
import type { MiniRestoreMode } from "@/modules/settings/types/settings.types";

const HomePage = import.meta.env.DEV
  ? HomePageStatic
  : lazy(async () => {
    const mod = await import("@/pages/HomePage");
    return { default: mod.HomePage };
  });
const MediaPage = import.meta.env.DEV
  ? MediaPageStatic
  : lazy(async () => {
    const mod = await import("@/pages/MediaPage");
    return { default: mod.MediaPage };
  });
const MusicPage = import.meta.env.DEV
  ? MusicPageStatic
  : lazy(async () => {
    const mod = await import("@/pages/MusicPage");
    return { default: mod.MusicPage };
  });
const SettingsPage = import.meta.env.DEV
  ? SettingsPageStatic
  : lazy(async () => {
    const mod = await import("@/pages/SettingsPage");
    return { default: mod.SettingsPage };
  });
const MiniPlayerPage = import.meta.env.DEV
  ? MiniPlayerPageStatic
  : lazy(async () => {
    const mod = await import("@/pages/MiniPlayerPage");
    return { default: mod.MiniPlayerPage };
  });

type Page = "dashboard" | "media" | "music" | "settings";
type BackgroundVideoOptimizedPayload = {
  original_path: string;
  optimized_path: string;
};

function PageLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      页面加载中...
    </div>
  );
}

function normalizeMiniRestoreMode(value: string | null | undefined): MiniRestoreMode {
  if (value === "button" || value === "double_click" || value === "both") return value;
  return "both";
}

function normalizeBackgroundBlur(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(36, Math.max(0, Math.round(parsed * 10) / 10));
}

function toAssetSrcPath(fsPath: string): string {
  // WebView2 release builds are more sensitive to backslash paths.
  return fsPath.replace(/\\/g, "/");
}

function looksLikeMiniWindow(width: number, height: number): boolean {
  return width <= 750 && height <= 90;
}

type WindowRect = {
  width: number;
  height: number;
  x: number;
  y: number;
};

type ToggleAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ConnectedAnimationPayload = {
  id: number;
  phase: "expand" | "collapse";
  from: ToggleAnchorRect;
  to: ToggleAnchorRect;
  durationMs: number;
  easing: string;
};

function rectFromCenter(cx: number, cy: number, size: number): ToggleAnchorRect {
  return {
    left: cx - size / 2,
    top: cy - size / 2,
    width: size,
    height: size,
  };
}

function normalizeAnchorRect(
  anchor: ToggleAnchorRect | undefined,
  viewportWidth: number,
  viewportHeight: number,
): ToggleAnchorRect {
  const fallback = rectFromCenter(viewportWidth / 2, Math.max(18, viewportHeight * 0.08), 26);
  if (!anchor) return fallback;
  const centerX = Math.min(Math.max(anchor.left + anchor.width / 2, 0), viewportWidth);
  const centerY = Math.min(Math.max(anchor.top + anchor.height / 2, 0), viewportHeight);
  return rectFromCenter(centerX, centerY, Math.max(22, Math.min(anchor.width, anchor.height, 34)));
}

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [hasUpdate, setHasUpdate] = useState(false);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [restoreState, setRestoreState] = useState<{
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);

  const [bgType, setBgType] = useState<"none" | "image" | "video">("none");
  const [bgFsPath, setBgFsPath] = useState<string | null>(null);
  const [bgBlur, setBgBlur] = useState<number>(12);
  const [bgRev, setBgRev] = useState(0);
  const [miniRestoreMode, setMiniRestoreMode] = useState<MiniRestoreMode>("both");
  const [miniModeWidth, setMiniModeWidth] = useState(700);
  const [miniModeHeight, setMiniModeHeight] = useState(50);
  const [updateCheckHint, setUpdateCheckHint] = useState<string | null>(null);
  const [miniTransitioning, setMiniTransitioning] = useState(false);
  const [miniAnimDirection, setMiniAnimDirection] = useState<"enter" | "exit" | null>(null);
  const [connectedAnimation, setConnectedAnimation] = useState<ConnectedAnimationPayload | null>(null);
  const isMiniModeRef = useRef(isMiniMode);
  const restoreStateRef = useRef(restoreState);
  const miniToggleLockRef = useRef(false);
  const miniModeWidthRef = useRef(miniModeWidth);
  const miniModeHeightRef = useRef(miniModeHeight);

  useEffect(() => {
    miniModeWidthRef.current = miniModeWidth;
    miniModeHeightRef.current = miniModeHeight;
  }, [miniModeWidth, miniModeHeight]);

  const bgSrc = useMemo(() => {
    if (!isTauri) return null;
    if (!bgFsPath) return null;
    try {
      return convertFileSrc(toAssetSrcPath(bgFsPath));
    } catch (e) {
      console.error("Failed to convert background path:", bgFsPath, e);
      try {
        return convertFileSrc(bgFsPath);
      } catch {
        // ignored
      }
      return null;
    }
  }, [bgFsPath, isTauri]);

  const bgSrcWithRev = useMemo(() => {
    if (!bgSrc) return null;
    const joiner = bgSrc.includes("?") ? "&" : "?";
    return `${bgSrc}${joiner}v=${bgRev}`;
  }, [bgSrc, bgRev]);

  useEffect(() => {
    isMiniModeRef.current = isMiniMode;
  }, [isMiniMode]);

  useEffect(() => {
    restoreStateRef.current = restoreState;
  }, [restoreState]);

  useEffect(() => {
    if (!updateCheckHint) return;
    const timer = window.setTimeout(() => setUpdateCheckHint(null), 8000);
    return () => window.clearTimeout(timer);
  }, [updateCheckHint]);

  useEffect(() => {
    if (!isTauri) {
      const legacyType = (localStorage.getItem("halo_bg_type") as "none" | "image" | "video") || "none";
      const legacyPath = localStorage.getItem("halo_bg_path");
      const legacyBlur = normalizeBackgroundBlur(localStorage.getItem("halo_bg_blur"));
      setBgType(legacyType);
      setBgFsPath(legacyPath);
      setBgBlur(legacyBlur);
      return;
    }

    void (async () => {
      try {
        const cfg = await getAppSettings();
        const cfgType = (cfg.background_type as "none" | "image" | "video" | undefined) ?? null;
        const cfgPath = cfg.background_path ?? null;
        const cfgImagePath = cfg.background_image_path ?? null;
        const cfgVideoPath = cfg.background_video_path ?? null;
        const cfgMiniRestoreMode = normalizeMiniRestoreMode(cfg.mini_restore_mode);
        const cfgBlur = normalizeBackgroundBlur(cfg.background_blur ?? localStorage.getItem("halo_bg_blur"));
        let t: "none" | "image" | "video" = "none";
        let p: string | null = null;

        if (cfgType && (cfgType === "image" || cfgType === "video") && cfgPath) {
          t = cfgType;
          p = cfgPath;
        } else if (cfgVideoPath) {
          t = "video";
          p = cfgVideoPath;
        } else if (cfgImagePath) {
          t = "image";
          p = cfgImagePath;
        } else {
          const legacyType = (localStorage.getItem("halo_bg_type") as "none" | "image" | "video") || "none";
          const legacyPath = localStorage.getItem("halo_bg_path");
          if (legacyPath && (legacyType === "image" || legacyType === "video")) {
            try {
              p = await importBackgroundAsset(legacyPath, legacyType);
              t = legacyType;
            } catch {
              localStorage.removeItem("halo_bg_type");
              localStorage.removeItem("halo_bg_path");
            }
          }
        }

        setBgType(t);
        setBgFsPath(p);
        setBgBlur(cfgBlur);
        setBgRev((prev) => prev + 1);
        setMiniRestoreMode(cfgMiniRestoreMode);
        setMiniModeWidth(cfg.mini_mode_width ?? 700);
        setMiniModeHeight(cfg.mini_mode_height ?? 50);

        await setBackground(t, p);

        localStorage.setItem("halo_bg_type", t);
        if (p) localStorage.setItem("halo_bg_path", p);
        else localStorage.removeItem("halo_bg_path");
        localStorage.setItem("halo_bg_blur", String(cfgBlur));
      } catch {
        const legacyType = (localStorage.getItem("halo_bg_type") as "none" | "image" | "video") || "none";
        const legacyPath = localStorage.getItem("halo_bg_path");
        const legacyBlur = normalizeBackgroundBlur(localStorage.getItem("halo_bg_blur"));
        setBgType(legacyType);
        setBgFsPath(legacyPath);
        setBgBlur(legacyBlur);
        setBgRev((prev) => prev + 1);
        setMiniRestoreMode("both");
      }
    })();
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    void initializeMusicHotkeyManager();
  }, [isTauri]);

  const updateBackground = (type: "none" | "image" | "video", fsPath: string | null) => {
    setBgType(type);
    setBgFsPath(fsPath);
    setBgRev((prev) => prev + 1);

    localStorage.setItem("halo_bg_type", type);
    if (fsPath) localStorage.setItem("halo_bg_path", fsPath);
    else localStorage.removeItem("halo_bg_path");

    if (isTauri) {
      void setBackground(type, fsPath);
    }
  };

  const updateBackgroundBlur = (value: number) => {
    const normalized = normalizeBackgroundBlur(value);
    setBgBlur(normalized);
    localStorage.setItem("halo_bg_blur", String(normalized));
  };

  const playConnectedAnimation = useCallback(
    async (
      phase: "expand" | "collapse",
      from: ToggleAnchorRect,
      to: ToggleAnchorRect,
      durationMs: number,
      easing: string,
    ) => {
      const id = Date.now() + Math.random();
      setConnectedAnimation({ id, phase, from, to, durationMs, easing });
      await new Promise((resolve) => window.setTimeout(resolve, durationMs + 24));
      setConnectedAnimation((prev) => (prev?.id === id ? null : prev));
    },
    [],
  );

  const setMiniMode = useCallback(async (
    enable: boolean,
    forceCalibrate = false,
    anchorRect?: ToggleAnchorRect,
  ) => {
    if (!isTauri) return;
    if (miniToggleLockRef.current) return;
    const previousMode = isMiniModeRef.current;
    if (enable === previousMode && !(enable && forceCalibrate)) return;
    miniToggleLockRef.current = true;

    try {
      const win = getCurrentWindow();
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const ENABLE_CONNECTED_ANIMATION = true;
      const CONNECTED_MS = 280;
      const PREPARE_MS = 60;
      const FINISH_MS = 80;
      const readRect = async (): Promise<WindowRect> => {
        const size = await win.innerSize();
        const pos = await win.innerPosition();
        return { width: size.width, height: size.height, x: pos.x, y: pos.y };
      };
      const buildFallbackRestore = async (
        pos?: { x: number; y: number },
      ): Promise<WindowRect> => {
        const monitor = await currentMonitor();
        const mSize = monitor?.size;
        const mPos = monitor?.position;
        const width = mSize
          ? Math.round(Math.min(Math.max(mSize.width * 0.78, 980), 1240))
          : 1200;
        const height = mSize
          ? Math.round(Math.min(Math.max(mSize.height * 0.78, 620), 780))
          : 700;
        const x = mSize
          ? (mPos?.x ?? 0) + Math.round((mSize.width - width) / 2)
          : (pos?.x ?? 90);
        const y = mSize
          ? (mPos?.y ?? 0) + Math.round((mSize.height - height) / 2)
          : (pos?.y ?? 70);
        return { width, height, x, y };
      };
      const buildMiniTarget = async (from: WindowRect): Promise<WindowRect> => {
        const monitor = await currentMonitor();
        const mSize = monitor?.size;
        const mPos = monitor?.position;
        const scaleFactor = monitor?.scaleFactor ?? await win.scaleFactor();
        const logicalWidth =
          typeof miniModeWidthRef.current === "number" && miniModeWidthRef.current > 0
            ? miniModeWidthRef.current
            : 700;
        const logicalHeight =
          typeof miniModeHeightRef.current === "number" && miniModeHeightRef.current > 0
            ? miniModeHeightRef.current
            : 50;
        const width = Math.max(1, Math.round(logicalWidth * scaleFactor));
        const height = Math.max(1, Math.round(logicalHeight * scaleFactor));
        const x = mSize
          ? (mPos?.x ?? 0) + Math.round((mSize.width - width) / 2)
          : from.x;
        const y = mSize
          ? (mPos?.y ?? 0) + Math.round(Math.max(8, mSize.height * 0.012))
          : Math.max(8, from.y);
        return { width, height, x, y };
      };
      const applyWindowRect = async (rect: WindowRect, stage: "enter-mini" | "exit-mini") => {
        const [sizeResult, posResult] = await Promise.allSettled([
          win.setSize(new PhysicalSize(rect.width, rect.height)),
          win.setPosition(new PhysicalPosition(rect.x, rect.y)),
        ]);
        if (sizeResult.status === "rejected") {
          throw new Error(`${stage}: setSize failed: ${String(sizeResult.reason)}`);
        }
        if (posResult.status === "rejected") {
          throw new Error(`${stage}: setPosition failed: ${String(posResult.reason)}`);
        }
      };

      setMiniAnimDirection(enable ? "enter" : "exit");
      setMiniTransitioning(true);

      if (enable) {
        try {
          if (await win.isMaximized()) {
            await win.unmaximize();
            await sleep(16);
          }
        } catch {
          void 0;
        }
        const current = await readRect();
        const hasValidRestore =
          !!restoreStateRef.current &&
          !looksLikeMiniWindow(restoreStateRef.current.width, restoreStateRef.current.height);
        if (!hasValidRestore || !previousMode) {
          const nextRestore = looksLikeMiniWindow(current.width, current.height)
            ? await buildFallbackRestore({ x: current.x, y: current.y })
            : current;
          setRestoreState(nextRestore);
          restoreStateRef.current = nextRestore;
        }

        const sourceViewport = { width: window.innerWidth, height: window.innerHeight };
        const sourceRect: ToggleAnchorRect = {
          left: 0,
          top: 0,
          width: sourceViewport.width,
          height: sourceViewport.height,
        };
        const collapseTo = normalizeAnchorRect(
          anchorRect,
          sourceViewport.width,
          sourceViewport.height,
        );
        if (ENABLE_CONNECTED_ANIMATION) {
          await playConnectedAnimation(
            "collapse",
            sourceRect,
            collapseTo,
            CONNECTED_MS,
            "cubic-bezier(0.19, 1, 0.22, 1)",
          );
        }

        const target = await buildMiniTarget(current);
        await win.setDecorations(false);
        await win.setAlwaysOnTop(true);
        await win.setResizable(true);
        try {
          await win.setShadow(false);
        } catch {
          void 0;
        }
        await sleep(PREPARE_MS);
        await applyWindowRect(target, "enter-mini");
        await win.setResizable(false);
        setIsMiniMode(true);
        isMiniModeRef.current = true;
        try {
          await win.setSkipTaskbar(true);
        } catch {
          void 0;
        }
        await sleep(FINISH_MS);
        setMiniTransitioning(false);
        setMiniAnimDirection(null);
        return;
      }

      let restore = restoreStateRef.current;
      if (!restore || looksLikeMiniWindow(restore.width, restore.height)) {
        restore = await buildFallbackRestore();
        setRestoreState(restore);
        restoreStateRef.current = restore;
      }

      const miniViewport = {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
      };
      const miniAnchor = normalizeAnchorRect(anchorRect, miniViewport.width, miniViewport.height);
      const miniAnchorCenter = {
        x: (miniAnchor.left + miniAnchor.width / 2) / miniViewport.width,
        y: (miniAnchor.top + miniAnchor.height / 2) / miniViewport.height,
      };

      try {
        await win.unminimize();
      } catch {
        void 0;
      }
      try {
        await win.show();
      } catch {
        void 0;
      }
      await win.setDecorations(false);
      await win.setResizable(true);
      try {
        await win.setSkipTaskbar(false);
      } catch {
        void 0;
      }
      await sleep(PREPARE_MS);
      await applyWindowRect(restore, "exit-mini");
      await win.setAlwaysOnTop(false);
      setIsMiniMode(false);
      isMiniModeRef.current = false;
      await sleep(16);

      const expandViewport = { width: window.innerWidth, height: window.innerHeight };
      const expandSource = rectFromCenter(
        miniAnchorCenter.x * expandViewport.width,
        miniAnchorCenter.y * expandViewport.height,
        24,
      );
      const expandTarget: ToggleAnchorRect = {
        left: 0,
        top: 0,
        width: expandViewport.width,
        height: expandViewport.height,
      };
      if (ENABLE_CONNECTED_ANIMATION) {
        await playConnectedAnimation(
          "expand",
          expandSource,
          expandTarget,
          CONNECTED_MS,
          "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        );
      }
      await sleep(FINISH_MS);
      setMiniTransitioning(false);
      setMiniAnimDirection(null);
    } catch (e) {
      setIsMiniMode(previousMode);
      isMiniModeRef.current = previousMode;
      setConnectedAnimation(null);
      setMiniTransitioning(false);
      setMiniAnimDirection(null);
      console.error("Mini mode toggle failed:", e);
      try {
        await message(`切换迷你模式失败: ${String(e)}`, { kind: "error" });
      } catch {
        void 0;
      }
    } finally {
      miniToggleLockRef.current = false;
    }
  }, [isTauri, playConnectedAnimation]);

  const toggleMiniMode = useCallback((anchorRect?: ToggleAnchorRect) => {
    void setMiniMode(!isMiniModeRef.current, false, anchorRect);
  }, [setMiniMode]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    void listen(EVENT_WINDOW_FORCE_MINI_MODE, () => {
      void setMiniMode(true, true, undefined);
    }).then((off) => {
      unlisten = off;
    }).catch(() => {
      void 0;
    });

    return () => {
      unlisten?.();
    };
  }, [isTauri, setMiniMode]);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;

    void listen<BackgroundVideoOptimizedPayload>(
      EVENT_SETTINGS_BG_VIDEO_OPTIMIZED,
      ({ payload }) => {
        if (!payload?.original_path || !payload?.optimized_path) return;
        // Only apply optimized path when the current background is video and matches the source path.
        setBgFsPath((prev) => {
          if (bgType !== "video") return prev;
          if (prev !== payload.original_path) return prev;
          localStorage.setItem("halo_bg_path", payload.optimized_path);
          setBgRev((v) => v + 1);
          return payload.optimized_path;
        });
      },
    ).then((off) => {
      unlisten = off;
    }).catch(() => {
      void 0;
    });

    return () => {
      unlisten?.();
    };
  }, [isTauri, bgType]);

  useEffect(() => {
    if (!isTauri) return;
    setHasUpdate(false);
    setUpdateCheckHint(null);
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const onAvailable = (event: Event) => {
      const payload = (event as CustomEvent<{ version?: string | null }>).detail;
      setHasUpdate(true);
      setUpdateCheckHint(
        payload?.version
          ? `发现新版本 ${payload.version}，可在设置页执行下载与安装。`
          : "发现新版本，可在设置页执行下载与安装。",
      );
    };
    const onUpToDate = () => {
      setHasUpdate(false);
      setUpdateCheckHint("当前已是最新版本。");
    };
    const onCheckFailed = (event: Event) => {
      const payload = (event as CustomEvent<{ message?: string }>).detail;
      setUpdateCheckHint(`更新检查失败：${payload?.message ?? "未知错误"}`);
    };

    window.addEventListener("halo:update-available", onAvailable as EventListener);
    window.addEventListener("halo:update-up-to-date", onUpToDate as EventListener);
    window.addEventListener("halo:update-check-failed", onCheckFailed as EventListener);
    return () => {
      window.removeEventListener("halo:update-available", onAvailable as EventListener);
      window.removeEventListener("halo:update-up-to-date", onUpToDate as EventListener);
      window.removeEventListener("halo:update-check-failed", onCheckFailed as EventListener);
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    void win.show().then(async () => {
      try {
        await win.unminimize();
        await win.setFocus();
      } catch {
        void 0;
      }
    }).catch(() => {
      void 0;
    });
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    void win.setDecorations(false).then(async () => {
      try {
        await win.setShadow(false);
      } catch {
        void 0;
      }
    }).catch(() => {
      void 0;
    });
  }, [isTauri]);

  useEffect(() => {
    const root = document.documentElement;
    const useMiniBackdrop =
      isMiniMode || (miniTransitioning && miniAnimDirection === "enter");
    root.classList.toggle("halo-mini-mode", useMiniBackdrop);
    return () => {
      root.classList.remove("halo-mini-mode");
    };
  }, [isMiniMode, miniTransitioning, miniAnimDirection]);

  return (
    <TooltipProvider delayDuration={200}>
      <AppLayout
        currentPage={page}
        onNavigate={setPage}
        hasUpdate={hasUpdate}
        globalHint={updateCheckHint}
        bgType={bgType}
        bgPath={bgSrcWithRev}
        bgFsPath={bgFsPath}
        bgBlur={bgBlur}
        isMiniMode={isMiniMode}
        miniTransitioning={miniTransitioning}
        connectedAnimation={connectedAnimation}
        onToggleMini={toggleMiniMode}
      >
        <Suspense fallback={<PageLoadingFallback />}>
          {isMiniMode ? (
            <MiniPlayerPage
              onToggleMini={toggleMiniMode}
              isTransitioning={miniTransitioning}
              miniRestoreMode={miniRestoreMode}
              bgType={bgType}
              bgPath={bgSrcWithRev}
              bgBlur={bgBlur}
            />
          ) : (
            <>
              <div className={page === "dashboard" ? "h-full" : "hidden"}><HomePage onNavigate={setPage} /></div>
              <div className={page === "media" ? "flex flex-col h-full" : "hidden"}><MediaPage /></div>
              <div className={page === "music" ? "flex flex-col h-full" : "hidden"}><MusicPage /></div>
              <div className={page === "settings" ? "flex flex-col h-full" : "hidden"}>
                <SettingsPage
                  bgType={bgType}
                  bgFsPath={bgFsPath}
                  bgBlur={bgBlur}
                  miniRestoreMode={miniRestoreMode}
                  miniModeWidth={miniModeWidth}
                  miniModeHeight={miniModeHeight}
                  onBgChange={updateBackground}
                  onBgBlurChange={updateBackgroundBlur}
                  onMiniRestoreModeChange={setMiniRestoreMode}
                  onMiniModeWidthChange={setMiniModeWidth}
                  onMiniModeHeightChange={setMiniModeHeight}
                />
              </div>
            </>
          )}
        </Suspense>
      </AppLayout>
    </TooltipProvider>
  );
}

export default App;
