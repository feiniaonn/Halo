import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  closeCurrentRuntimeWindow,
  copyRuntimeErrorText,
  type RuntimeErrorRecord,
} from "@/modules/shared/services/runtimeError";

type RuntimeErrorDialogProps = {
  error: RuntimeErrorRecord | null;
  onDismiss: () => void;
  onReload: () => void;
};

function formatOccurredAt(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
}

export function RuntimeErrorDialog({ error, onDismiss, onReload }: RuntimeErrorDialogProps) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "failed">("idle");
  const open = Boolean(error);

  const detailText = useMemo(() => {
    if (!error) return "";
    return [
      `Title: ${error.title}`,
      `Summary: ${error.summary}`,
      `Source: ${error.source}`,
      `Time: ${formatOccurredAt(error.occurredAt)}`,
      "",
      error.detail,
    ].join("\n");
  }, [error]);

  const handleCopy = async () => {
    const copied = await copyRuntimeErrorText(detailText);
    setCopyState(copied ? "ok" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleCloseWindow = async () => {
    await closeCurrentRuntimeWindow().catch(() => void 0);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onDismiss()}>
      <DialogContent className="max-w-2xl border-zinc-800 bg-zinc-950/96 text-zinc-100 shadow-2xl">
        <DialogHeader>
          <DialogTitle>{error?.title ?? "Runtime Error"}</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {error?.summary ?? "Unexpected runtime error"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-3 text-xs text-zinc-300">
              <div><span className="text-zinc-500">Source:</span> {error.source}</div>
              <div><span className="text-zinc-500">Time:</span> {formatOccurredAt(error.occurredAt)}</div>
            </div>
            <div className="max-h-[42vh] overflow-auto rounded-xl border border-zinc-800 bg-black/50 p-3 font-mono text-xs leading-6 text-zinc-200 whitespace-pre-wrap break-words">
              {error.detail}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-xs text-zinc-500">
            {copyState === "ok" ? "Error details copied" : copyState === "failed" ? "Copy failed. Please copy the text manually." : "The error was intercepted. You can continue, reload, or close this window."}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onDismiss}>Continue</Button>
            <Button variant="outline" onClick={handleCopy}>Copy details</Button>
            <Button variant="outline" onClick={onReload}>Reload window</Button>
            <Button variant="destructive" onClick={() => void handleCloseWindow()}>Close window</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
