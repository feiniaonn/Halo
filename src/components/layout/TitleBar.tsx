import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToggleAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function TitleBarButton({
  className,
  onClick,
  title,
  children,
  disabled,
}: {
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-8 w-9 items-center justify-center rounded-md transition-colors",
        "text-muted-foreground/70 hover:bg-muted hover:text-foreground active:scale-95",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  isMiniMode,
  isTransitioning,
  onToggleMini,
}: {
  isMiniMode?: boolean;
  isTransitioning?: boolean;
  onToggleMini?: (anchorRect?: ToggleAnchorRect) => void;
}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const windowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void (async () => {
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
    if (!isTauri || !win || isMiniMode) return;
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
    <div data-tauri-drag-region className="relative z-50 flex h-12 flex-none items-center justify-between px-4 select-none">
      <div className="flex items-center gap-3 pointer-events-none" />

      <div className="z-10 flex items-center gap-1">
        <TitleBarButton
          onClick={(event) => onToggleMini?.(event.currentTarget.getBoundingClientRect())}
          disabled={!!isTransitioning}
          title={isMiniMode ? "退出迷你模式" : "进入迷你模式"}
          className="mr-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="6" width="16" height="12" rx="3" />
            <path d="M8 12h8" />
          </svg>
        </TitleBarButton>

        <TitleBarButton onClick={handleMinimize} title="最小化">
          <Minus className="size-4" strokeWidth={2} />
        </TitleBarButton>

        {!isMiniMode && (
          <TitleBarButton onClick={handleMaximize} title={isMaximized ? "还原" : "最大化"}>
            {isMaximized ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M5 16V7a2 2 0 0 1 2-2h9" />
              </svg>
            ) : (
              <Square className="size-4" strokeWidth={2} />
            )}
          </TitleBarButton>
        )}

        <TitleBarButton
          onClick={handleClose}
          title="关闭"
          className="hover:bg-red-500/20 hover:text-red-400"
        >
          <X className="size-4" strokeWidth={2} />
        </TitleBarButton>
      </div>
    </div>
  );
}
