import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import {
  buildVodPlaybackDiagnosticsTimeline,
  summarizeVodPlaybackDiagnosticsReport,
  type VodPlaybackDiagnosticsReport,
} from "@/modules/media/services/vodPlaybackDiagnosticsView";

function formatDurationLabel(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "未知";
  }
  return `${Math.max(0, Math.round(durationMs))} ms`;
}

function buildMetaRows(report: VodPlaybackDiagnosticsReport | null): Array<{ label: string; value: string }> {
  if (!report) {
    return [];
  }

  return [
    { label: "线路", value: report.routeName },
    { label: "剧集", value: report.episodeName },
    ...(report.resolvedBy ? [{ label: "来源", value: report.resolvedBy }] : []),
    ...(report.finalUrl ? [{ label: "地址", value: report.finalUrl }] : []),
    ...(report.reason ? [{ label: "原因", value: report.reason }] : []),
  ].filter((row) => row.value.trim().length > 0);
}

export function VodPlaybackDiagnosticsPanel(props: {
  report: VodPlaybackDiagnosticsReport | null;
  loading: boolean;
}) {
  const { report, loading } = props;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (report?.status === "error") {
      setOpen(true);
    }
  }, [report?.status, report?.updatedAt]);

  const timeline = useMemo(
    () => buildVodPlaybackDiagnosticsTimeline(report?.diagnostics),
    [report?.diagnostics],
  );
  const summary = useMemo(
    () => summarizeVodPlaybackDiagnosticsReport(report),
    [report],
  );
  const metaRows = useMemo(
    () => buildMetaRows(report),
    [report],
  );

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex max-w-[min(28rem,calc(100%-2rem))] flex-col items-end gap-2">
      <button
        type="button"
        className={cn(
          "pointer-events-auto rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur transition-colors",
          report?.status === "error"
            ? "border-red-400/30 bg-red-500/20 text-red-50 hover:bg-red-500/30"
            : "border-sky-300/30 bg-sky-500/15 text-sky-50 hover:bg-sky-500/25",
        )}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "隐藏诊断" : "播放诊断"}
        {report ? ` · ${timeline.length} 步` : ""}
      </button>

      {open && (
        <div className="pointer-events-auto max-h-[min(32rem,70vh)] w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur">
          <div className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">播放解析诊断</p>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {loading ? "当前正在解析，面板会随着链路推进刷新。" : "展示最近一次解析链的预算、耗时和失败原因。"}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  report?.status === "error"
                    ? "bg-red-500/20 text-red-100"
                    : loading
                      ? "bg-amber-500/20 text-amber-100"
                      : "bg-emerald-500/20 text-emerald-100",
                )}
              >
                {report?.status === "error" ? "失败" : loading ? "进行中" : "成功"}
              </span>
            </div>

            {report ? (
              <div className="mt-3 grid gap-2 text-[11px] text-zinc-300">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                    总耗时 {formatDurationLabel(summary.totalElapsedMs)}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5">
                    更新时间 {new Date(report.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="grid gap-1.5">
                  {metaRows.map((row) => (
                    <div key={`${row.label}:${row.value}`} className="grid grid-cols-[3rem,1fr] gap-2">
                      <span className="text-zinc-500">{row.label}</span>
                      <span className="break-all text-zinc-200">{row.value}</span>
                    </div>
                  ))}
                  {!report.reason && summary.lastReason && (
                    <div className="grid grid-cols-[3rem,1fr] gap-2">
                      <span className="text-zinc-500">原因</span>
                      <span className="break-all text-zinc-200">{summary.lastReason}</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-[11px] text-zinc-500">尚无可展示的解析链。</p>
            )}
          </div>

          <div className="max-h-[22rem] space-y-3 overflow-y-auto px-4 py-3">
            {timeline.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-3 py-4 text-[11px] text-zinc-500">
                {loading ? "等待当前解析链写入步骤..." : "最近一次播放没有记录到解析诊断步骤。"}
              </div>
            ) : (
              timeline.map((item) => (
                <div
                  key={`${item.index}-${item.stage}-${item.status}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/75">
                      {item.index + 1}. {item.stageLabel}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        item.status === "success"
                          ? "bg-emerald-500/20 text-emerald-100"
                          : item.status === "error"
                            ? "bg-red-500/20 text-red-100"
                            : item.status === "miss"
                              ? "bg-amber-500/20 text-amber-100"
                              : "bg-zinc-500/20 text-zinc-200",
                      )}
                    >
                      {item.statusLabel}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      耗时 {formatDurationLabel(item.elapsedMs)}
                    </span>
                    {item.budgetMs !== null && (
                      <span className="text-[10px] text-zinc-500">
                        预算 {formatDurationLabel(item.budgetMs)}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 break-all text-[11px] text-zinc-100">{item.summary}</p>

                  {Object.keys(item.fields).length > 0 && (
                    <div className="mt-2 grid gap-1 text-[10px] text-zinc-400">
                      {Object.entries(item.fields).map(([key, value]) => (
                        <div key={`${item.index}-${key}`} className="grid grid-cols-[4rem,1fr] gap-2">
                          <span className="text-zinc-500">{key}</span>
                          <span className="break-all">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {item.detail !== item.summary && (
                    <p className="mt-2 break-all text-[10px] text-zinc-500">{item.detail}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
