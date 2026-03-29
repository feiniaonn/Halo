import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { reportStartupStep } from "@/lib/startupLog";
import { FloatingPlayer } from "./FloatingPlayer";
import { TitleBar } from "./TitleBar";
import { AppSidebar } from "./AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

type Page = "dashboard" | "media" | "music" | "island" | "settings";
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

export function AppLayout({
  children,
  currentPage = "dashboard",
  onNavigate,
  hasUpdate,
  globalHint,
  bgType = "none",
  bgPath,
  bgFsPath,
  bgBlur = 12,
  isMiniMode,
  miniTransitioning,
  connectedAnimation,
  onToggleMini,
  startupReady = true,
}: {
  children: ReactNode;
  currentPage?: Page;
  onNavigate?: (page: Page) => void;
  hasUpdate?: boolean;
  globalHint?: string | null;
  bgType?: "none" | "image" | "video";
  bgPath?: string | null;
  bgFsPath?: string | null;
  bgBlur?: number;
  isMiniMode?: boolean;
  miniTransitioning?: boolean;
  connectedAnimation?: ConnectedAnimationPayload | null;
  onToggleMini?: (anchorRect?: ToggleAnchorRect) => void;
  startupReady?: boolean;
}) {
  const hasCustomBg = bgType !== "none" && !!bgPath;
  const [customBgFailed, setCustomBgFailed] = useState(false);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    reportStartupStep(`AppLayout mounted page=${currentPage}`);
  }, [currentPage]);

  useEffect(() => {
    const resetTimer = window.requestAnimationFrame(() => {
      setCustomBgFailed(false);
    });
    return () => window.cancelAnimationFrame(resetTimer);
  }, [bgType, bgPath]);

  useEffect(() => {
    if (!startupReady) return;
    if (bgType !== "video" || !bgPath) return;
    const el = bgVideoRef.current;
    if (!el) return;
    try {
      el.load();
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => void 0);
      }
    } catch {
      void 0;
    }
  }, [bgType, bgPath, startupReady]);

  useEffect(() => {
    if (!startupReady) return;
    if (bgType !== "video" || !bgPath || customBgFailed) return;
    const el = bgVideoRef.current;
    if (!el) return;

    const timer = window.setTimeout(() => {
      if (el.readyState < 2) {
        setCustomBgFailed(true);
        window.dispatchEvent(
          new CustomEvent("halo:bg-load-error", {
            detail: { kind: "video", path: bgFsPath ?? bgPath, reason: "timeout" },
          }),
        );
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [bgType, bgPath, bgFsPath, customBgFailed, startupReady]);

  useEffect(() => {
    if (!connectedAnimation) return;
    const el = shellRef.current;
    if (!el) return;

    const fromCx = connectedAnimation.from.left + connectedAnimation.from.width / 2;
    const fromCy = connectedAnimation.from.top + connectedAnimation.from.height / 2;
    const toCx = connectedAnimation.to.left + connectedAnimation.to.width / 2;
    const toCy = connectedAnimation.to.top + connectedAnimation.to.height / 2;
    const dx = fromCx - toCx;
    const dy = fromCy - toCy;
    const sx = Math.max(0.05, connectedAnimation.from.width / Math.max(1, connectedAnimation.to.width));
    const sy = Math.max(0.05, connectedAnimation.from.height / Math.max(1, connectedAnimation.to.height));
    const arc = -Math.max(14, Math.min(48, Math.abs(dy) * 0.35 + 12));

    const keyframes =
      connectedAnimation.phase === "expand"
        ? [
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
              opacity: 0,
              boxShadow: "0 0 0 rgba(0,0,0,0)",
              offset: 0,
            },
            {
              transform: `translate(${dx * 0.46}px, ${dy * 0.46 + arc}px) scale(${sx + (1 - sx) * 0.72}, ${sy + (1 - sy) * 0.72})`,
              opacity: 1,
              boxShadow: "0 12px 28px rgba(0,0,0,0.18)",
              offset: 0.68,
            },
            {
              transform: "translate(0px, 0px) scale(1, 1)",
              opacity: 1,
              boxShadow: "0 16px 34px rgba(0,0,0,0.22)",
              offset: 1,
            },
          ]
        : [
            {
              transform: "translate(0px, 0px) scale(1, 1)",
              opacity: 1,
              boxShadow: "0 14px 30px rgba(0,0,0,0.2)",
              offset: 0,
            },
            {
              transform: `translate(${dx * 0.58}px, ${dy * 0.58 + arc}px) scale(${1 + (sx - 1) * 0.55}, ${1 + (sy - 1) * 0.55})`,
              opacity: 1,
              boxShadow: "0 10px 22px rgba(0,0,0,0.16)",
              offset: 0.72,
            },
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
              opacity: 0,
              boxShadow: "0 0 0 rgba(0,0,0,0)",
              offset: 1,
            },
          ];

    el.style.transformOrigin = "50% 50%";
    el.style.willChange = "transform, opacity, box-shadow";
    const animation = el.animate(keyframes, {
      duration: connectedAnimation.durationMs,
      easing: connectedAnimation.easing,
      fill: "both",
    });

    return () => {
      animation.cancel();
      el.style.willChange = "";
    };
  }, [connectedAnimation]);

  const showCustomBg = startupReady && hasCustomBg && !customBgFailed;
  const shellRadius = isMiniMode ? 32 : 22;
  const normalizedBgBlur = Math.min(36, Math.max(0, Math.round(bgBlur * 10) / 10));
  const backgroundScale = 1.03 + Math.min(0.18, normalizedBgBlur / 220);
  const fogOpacity = Math.min(0.6, 0.28 + normalizedBgBlur * 0.01);
  const shellStyle = {
    borderRadius: `${shellRadius}px`,
    "--halo-bg-blur": `${normalizedBgBlur}px`,
    "--halo-fog-opacity": `${fogOpacity}`,
  } as CSSProperties;

  if (isMiniMode) {
    return (
      <div
        className="halo-mini-root relative h-full w-full overflow-hidden bg-transparent select-none"
        style={{ borderRadius: `${shellRadius}px` }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        "halo-shell relative isolate flex h-full w-full flex-col overflow-hidden text-foreground",
        "transition-[border-radius,opacity,box-shadow,filter] duration-320 ease-[cubic-bezier(0.22,1,0.36,1)]",
      )}
      style={shellStyle}
      data-bg-active={showCustomBg ? "true" : "false"}
      data-bg-kind={showCustomBg ? bgType : "none"}
    >
      <div className="pointer-events-none absolute inset-0 z-[-4] bg-background" />

      {showCustomBg && (
        <div className="pointer-events-none absolute inset-0 z-[-2] overflow-hidden">
          {bgType === "image" ? (
            <img
              key={bgPath}
              src={bgPath}
              alt="Background"
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                filter: `blur(${normalizedBgBlur}px) saturate(1.2) brightness(0.9)`,
                transform: `scale(${backgroundScale})`,
              }}
              onLoad={() => {
                window.dispatchEvent(
                  new CustomEvent("halo:bg-load-success", {
                    detail: { kind: "image", path: bgFsPath ?? bgPath },
                  }),
                );
              }}
              onError={() => {
                setCustomBgFailed(true);
                window.dispatchEvent(
                  new CustomEvent("halo:bg-load-error", {
                    detail: { kind: "image", path: bgFsPath ?? bgPath },
                  }),
                );
              }}
            />
          ) : (
            <video
              key={bgPath}
              ref={bgVideoRef}
              src={bgPath}
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                filter: `blur(${normalizedBgBlur}px) saturate(1.2) brightness(0.9)`,
                transform: `scale(${backgroundScale})`,
              }}
              onLoadedData={() => {
                setCustomBgFailed(false);
                window.dispatchEvent(
                  new CustomEvent("halo:bg-load-success", {
                    detail: { kind: "video", path: bgFsPath ?? bgPath },
                  }),
                );
              }}
              onError={() => {
                setCustomBgFailed(true);
                window.dispatchEvent(
                  new CustomEvent("halo:bg-load-error", {
                    detail: { kind: "video", path: bgFsPath ?? bgPath },
                  }),
                );
              }}
              aria-hidden="true"
            />
          )}

          <div className="absolute inset-0 bg-background/5" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[-1] h-px bg-[linear-gradient(90deg,transparent,rgba(0,0,0,0.1),transparent)]" />

      <TitleBar isMiniMode={isMiniMode} isTransitioning={miniTransitioning} onToggleMini={onToggleMini} />

      <SidebarProvider defaultOpen className="relative flex flex-1 overflow-hidden bg-transparent">
        <AppSidebar currentPage={currentPage} onNavigate={onNavigate} hasUpdate={hasUpdate} />

        <SidebarInset
          className={cn(
            "relative my-3 mr-3 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-xl)]",
            showCustomBg
              ? "bg-transparent px-5 pt-4 pb-4 md:px-6 shadow-[0_8px_40px_rgba(0,0,0,0.06)]"
              : "bg-background/20 px-5 pt-4 pb-4 md:px-6 shadow-[0_8px_40px_rgba(0,0,0,0.06)] backdrop-blur-3xl border border-border/20",
          )}
        >
          {globalHint && (
            <div className="relative z-10 mb-4 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm tracking-wide text-amber-200">
              <span className="size-1.5 rounded-full bg-amber-400" />
              {globalHint}
            </div>
          )}

          <div className="relative z-10 h-full">{children}</div>
        </SidebarInset>
      </SidebarProvider>

      {startupReady ? <FloatingPlayer /> : null}
    </div>
  );
}
