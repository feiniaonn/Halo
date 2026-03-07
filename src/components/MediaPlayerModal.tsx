import * as React from "react";

export type MediaPlayerModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children?: React.ReactNode;
};

export function MediaPlayerModal({ open, title = "播放器", onClose, children }: MediaPlayerModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-xl bg-background p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="text-xs text-muted-foreground" onClick={onClose}>关闭</button>
        </div>
        {children}
      </div>
    </div>
  );
}
