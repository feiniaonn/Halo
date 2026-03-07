import { usePlayHistory, useTop10 } from "../hooks/usePlayHistory";
import { cn } from "@/lib/utils";
import { CoverImage } from "./CoverImage";

export function MusicPlayHistory() {
  const { data: history, loading: historyLoading } = usePlayHistory(50);
  const { data: top10, loading: top10Loading } = useTop10();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold">播放次数 Top 10</h2>
        {top10Loading ? (
          <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
        ) : top10.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            暂无数据，听够歌曲时长一半或超过一分半会自动记录
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {top10.map((item, i) => (
              <div
                key={`${item.artist}-${item.title}`}
                className={cn(
                  "glass-card flex items-center gap-4 rounded-xl p-3",
                  "transition-all duration-200 hover:shadow-md",
                )}
              >
                <span className="w-6 shrink-0 text-center text-sm font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <CoverImage coverPath={item.cover_path} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.artist}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/20 px-2 py-1 text-sm font-medium">
                  {item.play_count} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">播放记录</h2>
        {historyLoading ? (
          <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
        ) : history.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">暂无记录</p>
        ) : (
          <div className="mt-4 space-y-2">
            {history.map((item) => (
              <div
                key={`${item.artist}-${item.title}-${item.last_played}`}
                className={cn(
                  "glass-card flex items-center gap-4 rounded-xl p-3",
                  "transition-all duration-200 hover:shadow-md",
                )}
              >
                <CoverImage coverPath={item.cover_path} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.artist}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {item.play_count} 次
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
