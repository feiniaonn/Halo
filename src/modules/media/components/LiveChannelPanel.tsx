import { AlertCircle, Play, Tv } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { LiveChannel, LiveGroup } from '@/modules/live/types/live.types';

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
    <div className="flex w-full animate-in fade-in duration-300" style={{ height: '100%', overflow: 'hidden' }}>

      {/* ── Left Sidebar ── */}
      <div
        className="flex shrink-0 flex-col border-r bg-muted/20"
        style={{ width: '176px', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
      >
        <div className="py-2 pr-1">
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <span className="size-3 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              加载中...
            </div>
          )}
          {!loading && groups.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">暂无分组</div>
          )}
          {groups.map((group) => {
            const isActive = activeGroup === group.groupName;
            return (
              <button
                key={group.groupName}
                onClick={() => onSelectGroup(group.groupName)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-foreground/70 hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate leading-tight">{group.groupName}</span>
              </button>
            );
          })}
          {/* Breathing room at the bottom */}
          <div style={{ height: '32px' }} />
        </div>
      </div>

      {/* ── Right Content ── */}
      <div
        className="flex-1"
        style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}
      >
        <div className="p-4">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center text-destructive">
              <AlertCircle className="size-10 opacity-60" />
              <p className="text-base font-semibold">{error}</p>
              <p className="text-sm text-muted-foreground">请尝试重新配置直播源地址。</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {currentGroup?.channels.map((channel, index) => (
                <button
                  key={`${channel.name}-${index}`}
                  onClick={() => onOpenChannel(channel)}
                  className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-muted hover:shadow-sm active:scale-95"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <Tv className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="truncate text-[13px] font-medium leading-tight text-foreground">
                      {channel.name}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {channel.urls.length > 1 ? `${channel.urls.length} 条线路` : '直播流'}
                    </div>
                  </div>
                  <Play className="size-3 shrink-0 text-primary opacity-0 transition-all group-hover:opacity-100" />
                </button>
              ))}
              {!loading && !error && !currentGroup?.channels.length && (
                <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <Tv className="mb-3 size-10 opacity-30" />
                  <p className="text-sm font-medium">当前分组暂无频道</p>
                </div>
              )}
            </div>
          )}
          {/* Bottom padding */}
          <div style={{ height: '24px' }} />
        </div>
      </div>

    </div>
  );
}
