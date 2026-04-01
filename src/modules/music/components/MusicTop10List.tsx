import { cn } from "@/lib/utils";
import type { PlayRecord } from "../types/music.types";
import { CoverImage } from "./CoverImage";

export function MusicTop10List({
  records,
  loading,
}: {
  records: PlayRecord[];
  loading: boolean;
}) {
  return (
    <section className="flex-1 flex flex-col min-h-0 rounded-xl border border-white/5 bg-background/30 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground tracking-wide shrink-0 mb-3">今日播放次数 Top 10</h2>
      <div className="flex-1 overflow-y-auto no-scrollbar pr-1">
        {loading ? (
          <p className="mt-2 text-xs text-muted-foreground">加载中...</p>
        ) : records.length === 0 ? (
          <p className="mt-4 text-[13px] text-muted-foreground/70 text-center py-8 italic">开启新一天的听歌时光吧 ~</p>
        ) : (
          <div className="space-y-1">
            {records.map((item, i) => (
              <div
                key={`${item.artist}-${item.title}`}
                className={cn(
                  "group flex items-center gap-3 rounded-lg p-2 transition-all duration-200",
                  "hover:bg-white/5",
                )}
              >
                <span className="w-5 shrink-0 text-center text-[11px] font-medium text-muted-foreground/70 group-hover:text-muted-foreground">
                  {i + 1}
                </span>
                <CoverImage coverPath={item.cover_path} size="sm" className="w-8 h-8 shadow-sm rounded-md ring-1 ring-white/5 opacity-90 group-hover:opacity-100 transition-opacity" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">{item.title}</p>
                  <p className="truncate text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground">{item.artist}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/50 font-medium group-hover:text-muted-foreground transition-colors px-1">
                  {item.play_count} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}