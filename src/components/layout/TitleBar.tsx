import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";

export function TitleBar({
  isMiniMode,
  isTransitioning,
  onToggleMini,
}: {
  isMiniMode?: boolean;
  isTransitioning?: boolean;
  onToggleMini?: (anchorRect?: { left: number; top: number; width: number; height: number }) => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const windowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const win = getCurrentWindow();
        windowRef.current = win;
        setIsTauri(true);
        setIsMaximized(await win.isMaximized());
        unlisten = await win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      } catch {
        windowRef.current = null;
        setIsTauri(false);
      }
    })();

    return () => {
      windowRef.current = null;
      unlisten?.();
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    const win = windowRef.current;
    if (!isTauri || !win) return;
    await win.minimize();
  }, [isTauri]);

  const handleMaximize = useCallback(async () => {
    const win = windowRef.current;
    if (!isTauri || !win) return;
    if (isMiniMode) return;
    await win.toggleMaximize();
    setIsMaximized(await win.isMaximized());
  }, [isMiniMode, isTauri]);

  const handleClose = useCallback(async () => {
    const win = windowRef.current;
    if (!isTauri || !win) return;
    await win.close();
  }, [isTauri]);

  if (!isTauri) return null;

  return (
    <div className="relative z-50 h-10 flex-none select-none">
      <div className="flex h-full items-center justify-between px-4">
        <div data-tauri-drag-region className="h-full flex-1" />
        <div className="z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => onToggleMini?.(e.currentTarget.getBoundingClientRect())}
            disabled={!!isTransitioning}
            className={cn(
              "mr-2 inline-flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10",
              isTransitioning && "cursor-not-allowed opacity-50",
            )}
            title={isMiniMode ? "退出迷你模式" : "进入迷你模式"}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 12h12" />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleMinimize}
            className="inline-flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <path d="M0 0.5H10" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          {!isMiniMode && (
            <button
              type="button"
              onClick={handleMaximize}
              className="inline-flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="2.5" y="2.5" width="7" height="7" />
                  <path d="M2.5 7.5H0.5V0.5H7.5V2.5" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                  <rect x="1.5" y="1.5" width="7" height="7" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex h-8 w-10 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-red-500 hover:text-white"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1 1L9 9M9 1L1 9" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
