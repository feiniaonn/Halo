import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useIslandSizes } from "@/hooks/useIslandSizes";
import { applyCurrentWindowRect } from "@/lib/windowGeometry";
import { resolveMiniIslandLayout, resolveMiniWindowLogicalSize } from "@/modules/island/layout";
import { HomePage as HomePageStatic } from "@/pages/HomePage";
import { MediaPage as MediaPageStatic } from "@/pages/MediaPage";
import { MiniPlayerPage as MiniPlayerPageStatic } from "@/pages/MiniPlayerPage";
import { MusicPage as MusicPageStatic } from "@/pages/MusicPage";
import { SettingsPage as SettingsPageStatic } from "@/pages/SettingsPage";
import { IslandPage as IslandPageStatic } from "@/pages/IslandPage";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { EVENT_SETTINGS_BG_VIDEO_OPTIMIZED, EVENT_WINDOW_FORCE_MINI_MODE } from "@/modules/shared/services/events";
import { getAppSettings, importBackgroundAsset, setBackground } from "@/modules/settings/services/settingsService";
import { initializeMusicHotkeyManager } from "@/modules/music/services/musicHotkeyManager";
import { reportStartupStep } from "@/lib/startupLog";

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

const IslandPage = import.meta.env.DEV
  ? IslandPageStatic
  : lazy(async () => {
    const mod = await import("@/pages/IslandPage");
    return { default: mod.IslandPage };
  });

type Page = "dashboard" | "media" | "music" | "island" | "settings";
type BackgroundVideoOptimizedPayload = {
  original_path: string;
  optimized_path: string;
};

function PageLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="flex w-full max-w-md items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.015] px-5 py-4 text-sm text-muted-foreground shadow-lg backdrop-blur-2xl">
        <div className="halo-skeleton size-11 rounded-[calc(var(--radius-xl)-2px)]" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="halo-skeleton h-3 w-28 rounded-full" />
          <div className="halo-skeleton h-2.5 w-40 rounded-full opacity-80" />
        </div>
      </div>
    </div>
  );
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

function App() {
  const prefersReducedMotion = useReducedMotion();
  const [page, setPage] = useState<Page>("dashboard");
  const [activatedPages, setActivatedPages] = useState<Page[]>(["dashboard"]);
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
  const [startupReady, setStartupReady] = useState(false);
  const [nonCriticalReady, setNonCriticalReady] = useState(false);

  const [miniModeWidth, setMiniModeWidth] = useState(700);
  const [miniModeHeight, setMiniModeHeight] = useState(50);
  const [updateCheckHint, setUpdateCheckHint] = useState<string | null>(null);
  const [miniTransitioning, setMiniTransitioning] = useState(false);
  const [miniAnimDirection, setMiniAnimDirection] = useState<"enter" | "exit" | null>(null);
  const [connectedAnimation, setConnectedAnimation] = useState<ConnectedAnimationPayload | null>(null);
  const { sizes: islandSizes } = useIslandSizes();
  const isMiniModeRef = useRef(isMiniMode);
  const restoreStateRef = useRef(restoreState);
  const miniToggleLockRef = useRef(false);
  const miniModeWidthRef = useRef(miniModeWidth);
  const miniModeHeightRef = useRef(miniModeHeight);

  useEffect(() => {
    reportStartupStep("App mounted");
    let startupTimer: number | null = null;
    let nonCriticalTimer: number | null = null;
    const rafId = window.requestAnimationFrame(() => {
      startupTimer = window.setTimeout(() => {
        reportStartupStep("App startupReady=true");
        setStartupReady(true);
      }, 120);
      nonCriticalTimer = window.setTimeout(() => {
        reportStartupStep("App nonCriticalReady=true");
        setNonCriticalReady(true);
      }, 720);
    });

    return () => {
      if (startupTimer !== null) {
        window.clearTimeout(startupTimer);
      }
      if (nonCriticalTimer !== null) {
        window.clearTimeout(nonCriticalTimer);
      }
      window.cancelAnimationFrame(rafId);
    };
  }, []);

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

  const miniIslandLayout = useMemo(
    () => resolveMiniIslandLayout(islandSizes.capsuleWidth, islandSizes.capsuleHeight),
    [islandSizes.capsuleHeight, islandSizes.capsuleWidth],
  );

  const pageVariants = useMemo(
    () => ({
      active: {
        opacity: 1,
        pointerEvents: "auto" as const,
      },
      inactive: {
        opacity: 0,
        pointerEvents: "none" as const,
      },
    }),
    [],
  );

  const pageTransition = useMemo(
    () => ({
      duration: prefersReducedMotion ? 0.01 : 0.12,
      ease: "easeOut" as const,
    }),
    [prefersReducedMotion],
  );

  useEffect(() => {
    isMiniModeRef.current = isMiniMode;
  }, [isMiniMode]);

  useEffect(() => {
    setActivatedPages((current) => (current.includes(page) ? current : [...current, page]));
  }, [page]);

  useEffect(() => {
    restoreStateRef.current = restoreState;
  }, [restoreState]);

  useEffect(() => {
    if (!updateCheckHint) return;
    const timer = window.setTimeout(() => setUpdateCheckHint(null), 8000);
    return () => window.clearTimeout(timer);
  }, [updateCheckHint]);

  useEffect(() => {
    if (!nonCriticalReady) {
      return;
    }

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
        reportStartupStep("App loading app settings");
        const cfg = await getAppSettings();
        const cfgType = (cfg.background_type as "none" | "image" | "video" | undefined) ?? null;
        const cfgPath = cfg.background_path ?? null;
        const cfgImagePath = cfg.background_image_path ?? null;
        const cfgVideoPath = cfg.background_video_path ?? null;
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
        setMiniModeWidth(cfg.mini_mode_width ?? 700);
        setMiniModeHeight(cfg.mini_mode_height ?? 50);

        await setBackground(t, p);

        localStorage.setItem("halo_bg_type", t);
        if (p) localStorage.setItem("halo_bg_path", p);
        else localStorage.removeItem("halo_bg_path");
        localStorage.setItem("halo_bg_blur", String(cfgBlur));
        reportStartupStep("App app settings applied");
      } catch {
        reportStartupStep("App app settings load failed, falling back to localStorage", "warn");
        const legacyType = (localStorage.getItem("halo_bg_type") as "none" | "image" | "video") || "none";
        const legacyPath = localStorage.getItem("halo_bg_path");
        const legacyBlur = normalizeBackgroundBlur(localStorage.getItem("halo_bg_blur"));
        setBgType(legacyType);
        setBgFsPath(legacyPath);
        setBgBlur(legacyBlur);
        setBgRev((prev) => prev + 1);
      }
    })();
  }, [isTauri, nonCriticalReady]);

  useEffect(() => {
    if (!nonCriticalReady || !isTauri) return;
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const requestIdle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback.bind(window)
      : null;
    const cancelIdle = typeof window.cancelIdleCallback === "function"
      ? window.cancelIdleCallback.bind(window)
      : null;

    const start = () => {
      if (cancelled) return;
      reportStartupStep("App initializing music hotkeys");
      void initializeMusicHotkeyManager();
    };

    if (requestIdle) {
      idleId = requestIdle(() => start(), { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(() => start(), 320);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && cancelIdle) {
        cancelIdle(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isTauri, nonCriticalReady]);

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

  const setMiniMode = useCallback(async (
    enable: boolean,
    forceCalibrate = false,
    _anchorRect?: ToggleAnchorRect,
  ) => {
    if (!isTauri) return;
    void _anchorRect;
    if (miniToggleLockRef.current) return;
    const previousMode = isMiniModeRef.current;
    if (enable === previousMode && !(enable && forceCalibrate)) return;
    miniToggleLockRef.current = true;

    try {
      const win = getCurrentWindow();
      const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      const PREPARE_MS = prefersReducedMotion ? 0 : 8;
      const FINISH_MS = prefersReducedMotion ? 0 : 12;
      const readRect = async (): Promise<WindowRect> => {
        const size = await win.innerSize();
        const pos = await win.innerPosition();
        return { width: size.width, height: size.height, x: pos.x, y: pos.y };
      };
      const isMiniRect = (rect: WindowRect, target: WindowRect) =>
        Math.abs(rect.width - target.width) <= 4 &&
        Math.abs(rect.height - target.height) <= 4 &&
        Math.abs(rect.x - target.x) <= 12 &&
        Math.abs(rect.y - target.y) <= 12;
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
        const logicalSize = resolveMiniWindowLogicalSize(
          miniIslandLayout,
          typeof miniModeWidthRef.current === "number" && miniModeWidthRef.current > 0
            ? miniModeWidthRef.current
            : 700,
          typeof miniModeHeightRef.current === "number" && miniModeHeightRef.current > 0
            ? miniModeHeightRef.current
            : 50,
        );
        const logicalWidth = logicalSize.width;
        const logicalHeight = logicalSize.height;
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
        try {
          await applyCurrentWindowRect(rect);
        } catch (error) {
          const wrappedError = new Error(`${stage}: set window bounds failed`);
          (wrappedError as Error & { cause?: unknown }).cause =
            error instanceof Error ? error : new Error(String(error));
          throw wrappedError;
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
        const target = await buildMiniTarget(current);
        const hasValidRestore =
          !!restoreStateRef.current &&
          !isMiniRect(restoreStateRef.current, target);
        if (!hasValidRestore || !previousMode) {
          const nextRestore = isMiniRect(current, target)
            ? await buildFallbackRestore({ x: current.x, y: current.y })
            : current;
          setRestoreState(nextRestore);
          restoreStateRef.current = nextRestore;
        }
        await win.setDecorations(false);
        await win.setAlwaysOnTop(true);
        await win.setResizable(true);
        try {
          await win.setShadow(false);
        } catch {
          void 0;
        }
        setConnectedAnimation(null);
        setIsMiniMode(true);
        isMiniModeRef.current = true;
        await nextFrame();
        await sleep(PREPARE_MS);
        await applyWindowRect(target, "enter-mini");
        await win.setResizable(false);
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
      const current = await readRect();
      const miniTarget = await buildMiniTarget(current);
      if (!restore || isMiniRect(restore, miniTarget)) {
        restore = await buildFallbackRestore();
        setRestoreState(restore);
        restoreStateRef.current = restore;
      }

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
      setConnectedAnimation(null);
      setIsMiniMode(false);
      isMiniModeRef.current = false;
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
  }, [isTauri, miniIslandLayout, prefersReducedMotion]);

  const toggleMiniMode = useCallback((anchorRect?: ToggleAnchorRect) => {
    void setMiniMode(!isMiniModeRef.current, false, anchorRect);
  }, [setMiniMode]);

  useEffect(() => {
    if (!nonCriticalReady || !isTauri) return;
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
  }, [isTauri, setMiniMode, nonCriticalReady]);

  useEffect(() => {
    if (!nonCriticalReady || !isTauri) return;
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
  }, [isTauri, bgType, nonCriticalReady]);

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
    if (!startupReady || !isTauri) return;
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
  }, [isTauri, startupReady]);

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
        startupReady={nonCriticalReady}
      >
        <Suspense fallback={<PageLoadingFallback />}>
          {isMiniMode ? (
            <MiniPlayerPage
              onToggleMini={toggleMiniMode}
              isTransitioning={miniTransitioning}

              bgType={bgType}
              bgPath={bgSrcWithRev}
              bgBlur={bgBlur}
            />
          ) : (
            startupReady ? (
              <div className="relative h-full w-full halo-page-stage">
              <motion.div
                initial={false}
                animate={page === "dashboard" ? "active" : "inactive"}
                variants={pageVariants}
                transition={pageTransition}
                className="absolute inset-0 overflow-y-auto overflow-x-hidden will-change-transform"
              >
                {activatedPages.includes("dashboard") ? <HomePage /> : null}
              </motion.div>
              <motion.div
                initial={false}
                animate={page === "media" ? "active" : "inactive"}
                variants={pageVariants}
                transition={pageTransition}
                className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
              >
                {activatedPages.includes("media") ? <MediaPage /> : null}
              </motion.div>
              <motion.div
                initial={false}
                animate={page === "music" ? "active" : "inactive"}
                variants={pageVariants}
                transition={pageTransition}
                className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
              >
                {activatedPages.includes("music") ? <MusicPage /> : null}
              </motion.div>
                              <motion.div
                  initial={false}
                  animate={page === "island" ? "active" : "inactive"}
                  variants={pageVariants}
                  transition={pageTransition}
                  className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
                >
                  {activatedPages.includes("island") ? (
                    <IslandPage
                      onSaveMiniModeSize={async (w, h) => {
                        try {
                          const { setMiniModeSize } = await import("@/modules/settings/services/settingsService");
                          await setMiniModeSize(w, h);
                        } catch (e) { console.error(e); }
                      }}
                    />
                  ) : null}
                </motion.div>
                <motion.div
                initial={false}
                animate={page === "settings" ? "active" : "inactive"}
                variants={pageVariants}
                transition={pageTransition}
                className="absolute inset-0 flex flex-col overflow-y-auto overflow-x-hidden will-change-transform"
              >
                {activatedPages.includes("settings") ? (
                  <SettingsPage
                    bgType={bgType}
                    bgFsPath={bgFsPath}
                    bgBlur={bgBlur}
                    onBgChange={updateBackground}
                    onBgBlurChange={updateBackgroundBlur}
                  />
                ) : null}
              </motion.div>
              </div>
            ) : (
              <PageLoadingFallback />
            )
          )}
        </Suspense>
      </AppLayout>
    </TooltipProvider>
  );
}

export default App;
