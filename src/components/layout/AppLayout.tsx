import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { FloatingPlayer } from "./FloatingPlayer";
import { TitleBar } from "./TitleBar";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

type Page = "dashboard" | "media" | "music" | "settings";
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
}) {
  const hasCustomBg = bgType !== "none" && !!bgPath;
  const [customBgFailed, setCustomBgFailed] = useState(false);
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCustomBgFailed(false);
  }, [bgType, bgPath]);

  useEffect(() => {
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
  }, [bgType, bgPath]);

  useEffect(() => {
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
  }, [bgType, bgPath, bgFsPath, customBgFailed]);

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
            transform: `translate(${dx * 0.46}px, ${(dy * 0.46) + arc}px) scale(${sx + (1 - sx) * 0.72}, ${sy + (1 - sy) * 0.72})`,
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
            transform: `translate(${dx * 0.58}px, ${(dy * 0.58) + arc}px) scale(${1 + (sx - 1) * 0.55}, ${1 + (sy - 1) * 0.55})`,
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

  const showCustomBg = hasCustomBg && !customBgFailed;
  const shellRadius = isMiniMode ? 14 : 10;
  const normalizedBgBlur = Math.min(36, Math.max(0, Math.round(bgBlur * 10) / 10));
  const backgroundScale = 1.02 + Math.min(0.16, normalizedBgBlur / 220);
  const fogOpacity = Math.min(0.56, 0.2 + normalizedBgBlur * 0.01);
  const shellStyle = {
    borderRadius: `${shellRadius}px`,
    "--halo-bg-blur": `${normalizedBgBlur}px`,
    "--halo-fog-opacity": `${fogOpacity}`,
  } as CSSProperties;

  return (
    <div
      ref={shellRef}
      className={cn(
        "halo-shell relative isolate flex h-full w-full flex-col overflow-hidden",
        "transition-[border-radius,opacity,box-shadow,filter] duration-320 ease-[cubic-bezier(0.22,1,0.36,1)]",
        isMiniMode &&
        "bg-transparent shadow-[0_12px_36px_rgba(0,0,0,0.22)]",
      )}
      style={shellStyle}
      data-bg-active={showCustomBg ? "true" : "false"}
      data-bg-kind={showCustomBg ? bgType : "none"}
    >
      {/* Background Layer */}
      {isMiniMode ? (
        <div className="absolute left-1/2 top-1/2 z-[-3] h-px w-px -translate-x-1/2 -translate-y-1/2 bg-transparent" />
      ) : (
        <>
          <div className="absolute inset-0 z-[-3] bg-background text-foreground transition-colors duration-500" />
          {/* Global Ambient Blobs for subtle Glassmorphism baseline */}
          {!showCustomBg && (
            <>
              <div className="ambient-blob bg-[rgb(14,176,201)]/10 dark:bg-[rgb(14,176,201)]/15 w-[50vw] h-[50vw] left-[-10%] top-[-10%]" />
              <div className="ambient-blob bg-white/40 dark:bg-black/40 w-[40vw] h-[40vw] right-[-5%] top-[20%]" style={{ animationDelay: '-5s' }} />
            </>
          )}
        </>
      )}
      {showCustomBg && (
        <div className="absolute inset-0 z-[-2] overflow-hidden pointer-events-none">
          {bgType === "image" ? (
            <img
              key={bgPath}
              src={bgPath}
              alt="Background"
              className="absolute inset-0 h-full w-full object-cover opacity-82"
              style={{
                filter: `blur(${normalizedBgBlur}px)`,
                transform: `scale(${backgroundScale})`,
              }}
              onLoad={() => {
                window.dispatchEvent(
                  new CustomEvent("halo:bg-load-success", {
                    detail: { kind: "image", path: bgFsPath ?? bgPath },
                  }),
                );
              }}
              onError={(e) => {
                console.error("BG Image load failed:", bgPath, e);
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
              className="absolute inset-0 h-full w-full object-cover opacity-78"
              style={{
                filter: `blur(${normalizedBgBlur}px)`,
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
              onError={(e) => {
                console.error("BG Video load failed:", bgPath, e);
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
          <div
            className={cn(
              "absolute inset-0",
              isMiniMode
                ? bgType === "video"
                  ? "bg-transparent"
                  : "bg-transparent"
                : bgType === "video"
                  ? "bg-background/34"
                  : "bg-background/28",
            )}
            style={{ opacity: isMiniMode ? 1 : fogOpacity }}
          />
        </div>
      )}
      {showCustomBg && !isMiniMode && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[-1]",
            "bg-background/56",
          )}
        />
      )}

      {!isMiniMode && (
        <TitleBar
          isMiniMode={isMiniMode}
          isTransitioning={miniTransitioning}
          onToggleMini={onToggleMini}
        />
      )}
      <SidebarProvider defaultOpen={true} className="flex flex-1 overflow-hidden bg-transparent">
        {!isMiniMode && (
          <AppSidebar
            currentPage={currentPage}
            onNavigate={onNavigate}
            hasUpdate={hasUpdate}
          />
        )}
        <SidebarInset
          className={cn(
            "bg-transparent flex-1 m-0 shadow-none border-none min-w-0 transition-all duration-300",
            "overflow-y-auto overflow-x-hidden", // Primary scroll container
            isMiniMode ? "items-center justify-center p-0" : "px-8 pt-1 pb-3"
          )}
        >
          {!isMiniMode && globalHint && (
            <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {globalHint}
            </div>
          )}
          {children}
        </SidebarInset>
      </SidebarProvider>
      {!isMiniMode && <FloatingPlayer />}
    </div>
  );
}
