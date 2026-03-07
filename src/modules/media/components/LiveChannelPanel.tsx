import { AlertCircle, Play, Tv } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LiveChannel, LiveGroup } from "@/modules/live/types/live.types";

interface LiveChannelPanelProps {
  groups: LiveGroup[];
  activeGroup: string;
  currentGroup?: LiveGroup;
  loading: boolean;
  error: string | null;
  onSelectGroup: (groupName: string) => void;
  onOpenChannel: (channel: LiveChannel) => void;
}

export function LiveChannelPanel({
  groups,
  activeGroup,
  currentGroup,
  loading,
  error,
  onSelectGroup,
  onOpenChannel,
}: LiveChannelPanelProps) {
  return (
    <div className="flex h-full flex-1 animate-in fade-in duration-500 overflow-hidden">
      <div className="custom-scrollbar mr-6 flex w-56 flex-shrink-0 flex-col overflow-y-auto border-r border-white/10 pr-4">
        {groups.map((group) => (
          <button
            key={group.groupName}
            onClick={() => onSelectGroup(group.groupName)}
            className={cn(
              "mb-2 w-full rounded-xl px-4 py-3 text-left font-medium transition-all",
              activeGroup === group.groupName
                ? "scale-105 bg-primary text-primary-foreground shadow-md"
                : "bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white",
            )}
          >
            <span className="block w-full truncate">{group.groupName}</span>
          </button>
        ))}

        {groups.length === 0 && !loading && (
          <div className="mt-4 px-4 text-sm text-zinc-500">暂无分组</div>
        )}
        {loading && (
          <div className="mt-4 flex items-center gap-2 px-4 text-sm text-zinc-500">
            <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            加载中...
          </div>
        )}
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto pb-10">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 p-12 text-center animate-in zoom-in-95 duration-300">
            <AlertCircle className="mb-4 size-12 text-red-400" />
            <p className="font-medium text-red-400">{error}</p>
            <p className="mt-2 text-xs text-red-400/70">请尝试重新配置直播源地址。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {currentGroup?.channels.map((channel, index) => (
              <Card
                key={`${channel.name}-${index}`}
                onClick={() => onOpenChannel(channel)}
                className="glass-card group relative flex cursor-pointer items-center justify-between overflow-hidden border-none p-4 transition-transform duration-400 hover:-translate-y-1"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-foreground/70 transition-colors group-hover:bg-primary/20 group-hover:text-primary">
                    <Tv className="size-5" />
                  </div>
                  <div className="overflow-hidden text-left">
                    <div className="truncate text-sm font-semibold text-white/90 transition-colors group-hover:text-white">
                      {channel.name}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] uppercase text-muted-foreground">
                      {channel.urls.length > 1 ? `已含 ${channel.urls.length} 条备用线路` : "直播流"}
                    </div>
                  </div>
                </div>
                <Play className="ml-2 size-5 shrink-0 -translate-x-2 opacity-0 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] transition-all group-hover:translate-x-0 group-hover:opacity-100 group-hover:text-primary" />
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
