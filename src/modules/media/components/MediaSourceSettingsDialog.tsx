import { Settings2 } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type MediaMode = "vod" | "live";

interface MediaSourceSettingsDialogProps {
  open: boolean;
  vodDraft: string;
  liveDraft: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (mode: MediaMode, value: string) => void;
  onClear: (mode: MediaMode) => void;
  onSave: (mode: MediaMode) => void;
}

function SourceEditor({
  label,
  badge,
  value,
  placeholder,
  onChange,
  onClear,
  onSave,
}: {
  label: string;
  badge: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onSave: () => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground/90">{label}</label>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
          {badge}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-[100px] w-full resize-none rounded-xl border border-input bg-muted/30 px-4 py-3 font-mono text-sm outline-none transition-all placeholder:text-muted-foreground/50 focus:bg-background focus:ring-2 focus:ring-primary/50"
        spellCheck={false}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onClear}
          className="rounded-xl px-4 py-2 text-xs font-medium transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          清空地址
        </button>
        <button
          onClick={onSave}
          className="rounded-xl bg-primary px-5 py-2 text-xs font-medium text-primary-foreground shadow-md transition-all hover:scale-105 hover:bg-primary/90 active:scale-95"
        >
          保存
        </button>
      </div>
    </section>
  );
}

export function MediaSourceSettingsDialog({
  open,
  vodDraft,
  liveDraft,
  onOpenChange,
  onDraftChange,
  onClear,
  onSave,
}: MediaSourceSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden rounded-[2rem] border-white/10 bg-background/95 p-0 shadow-2xl backdrop-blur-xl sm:max-w-2xl">
        <DialogHeader className="border-b border-border/50 bg-muted/20 px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Settings2 className="size-5 text-primary" />
            媒体源配置
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-8 overflow-y-auto p-6">
          <SourceEditor
            label="点播源地址 (VOD)"
            badge="单仓模式"
            value={vodDraft}
            placeholder="https://example.com/vod.json"
            onChange={(value) => onDraftChange("vod", value)}
            onClear={() => onClear("vod")}
            onSave={() => onSave("vod")}
          />

          <div className="h-px w-full bg-border/50" />

          <SourceEditor
            label="直播源地址"
            badge="单仓模式"
            value={liveDraft}
            placeholder="https://example.com/live.m3u"
            onChange={(value) => onDraftChange("live", value)}
            onClear={() => onClear("live")}
            onSave={() => onSave("live")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
